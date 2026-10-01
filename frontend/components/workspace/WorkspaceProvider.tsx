'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  attendance as attendanceSeed,
  currentUser,
  directory,
  files as fileSeed,
  leaveRequests as leaveSeed,
  type AttendanceRecord,
  type FileRow,
  type LeaveRequest,
  type Person,
} from '@/lib/data';
import { api } from '@/lib/api';
import { readJson, storageKeys, writeJson } from '@/lib/storage';
import { localDayKey } from '@/lib/format';

/**
 * The single client-side store for everything that has to outlive a component.
 *
 * Before this existed, attendance, leave requests and files were each a local
 * `useState` seeded from `lib/data.ts`. That made three of the app's workflows
 * impossible rather than merely unsaved: an employee could not submit a leave
 * request that HR would then be able to see, because they were two different
 * people on two different routes holding two different copies of the same
 * array. It also meant the signed-in user was fixed to `currentUser` in a
 * *server* layout, so there was no way to demonstrate a second role.
 *
 * Persistence follows the same rule as everywhere else in this app: render the
 * fixture seed so the server HTML and the first client paint agree, then restore
 * from storage in an effect. Writing before that restore would overwrite stored
 * data with the seed, so every write is gated on `ready`.
 */
type WorkspaceState = {
  activeUserId: string;
  leaveRequests: LeaveRequest[];
  attendance: AttendanceRecord[];
  files: FileRow[];
};

type Session = { activeUserId: string };

type WorkspaceValue = WorkspaceState & {
  /** False until the stored state has been read and applied. */
  ready: boolean;
  /** The signed-in person, resolved from the directory. */
  activeUser: Person;
  /** Everyone, in directory order. Use `useDirectory` for the profile overlay. */
  people: Person[];

  signIn: (userId: string) => void;
  signOut: () => void;

  addLeave: (request: LeaveRequest) => void;
  decideLeave: (id: string, status: LeaveRequest['status'], decidedById: string) => void;

  punchIn: () => void;
  punchOut: () => void;

  /**
   * Why the last punch could not be saved, or null.
   *
   * A punch still updates the screen when the API is unreachable -- the local rule
   * below computes it -- but that record is not persisted anywhere. Without this the
   * board would show a check-in that exists only in one tab, which is worse than
   * showing nothing.
   */
  attendanceError: string | null;

  addFiles: (rows: FileRow[]) => void;
  removeFile: (id: string) => void;
  toggleFileStar: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/** Minutes past midnight that count as a late arrival. */
const LATE_AFTER_MINUTES = 9 * 60 + 30;
/** Minutes past midnight that start counting as overtime. */
const OVERTIME_AFTER_MINUTES = 17 * 60;

const seedState: WorkspaceState = {
  activeUserId: currentUser.id,
  leaveRequests: leaveSeed,
  attendance: attendanceSeed,
  files: fileSeed,
};

function minutesOfDay(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(seedState);
  const [ready, setReady] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  useEffect(() => {
    const session = readJson<Session>(storageKeys.session);
    const restored = {
      activeUserId: session?.activeUserId ?? currentUser.id,
      leaveRequests: readJson<LeaveRequest[]>(storageKeys.leave) ?? leaveSeed,
      attendance: readJson<AttendanceRecord[]>(storageKeys.attendance) ?? attendanceSeed,
      files: readJson<FileRow[]>(storageKeys.files) ?? fileSeed,
    };
    setState(restored);
    setReady(true);

    /**
     * Replace the signed-in person's records with the API's.
     *
     * Merged rather than replaced wholesale, and that is not a nicety. The persona
     * picker lets a viewer switch to another seeded person, and that switch is a
     * demo affordance with no corresponding session -- the API only ever returns the
     * real cookie holder's rows. Replacing the array would empty the history the
     * moment someone switched persona, which is most of what the board shows.
     *
     * So the session user's rows are overwritten from the server and everyone
     * else's are left alone. `sessionUserId` is resolved once, before the fetch, so
     * a persona switch mid-flight cannot merge the wrong person's records.
     */
    const sessionUserId = restored.activeUserId;
    let cancelled = false;

    void api
      .attendance({ days: 90 })
      .then((response) => {
        if (cancelled) return;

        const others = restored.attendance.filter((row) => row.userId !== sessionUserId);
        const mine = response.records.filter((row) => row.userId === sessionUserId);

        setState((current) => ({
          ...current,
          attendance: [...mine, ...others],
        }));
      })
      .catch(() => {
        // The fixtures are already in state. A down API must not clear the board,
        // and the `stale` idea is not surfaced here on purpose: attendance is
        // written by the user rather than read for information, so a stale history
        // is less alarming than a stale feed. The punch error below is the signal
        // that matters.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Nothing may be written before the restore above, or the seed would
    // clobber whatever is already stored.
    if (!ready) return;

    writeJson(storageKeys.session, { activeUserId: state.activeUserId } satisfies Session);
    writeJson(storageKeys.leave, state.leaveRequests);
    writeJson(storageKeys.attendance, state.attendance);
    writeJson(storageKeys.files, state.files);
  }, [ready, state]);

  const signIn = useCallback((userId: string) => {
    setState((current) => ({ ...current, activeUserId: userId }));
  }, []);

  const signOut = useCallback(() => {
    // Data is deliberately kept: signing out and back in as the same person
    // should not silently discard their leave requests or uploads.
    setState((current) => ({ ...current, activeUserId: currentUser.id }));
  }, []);

  const addLeave = useCallback((request: LeaveRequest) => {
    setState((current) => ({ ...current, leaveRequests: [request, ...current.leaveRequests] }));
  }, []);

  const decideLeave = useCallback(
    (id: string, status: LeaveRequest['status'], decidedById: string) => {
      setState((current) => ({
        ...current,
        leaveRequests: current.leaveRequests.map((row) =>
          row.id === id
            ? { ...row, status, decidedById, decidedAt: new Date().toISOString() }
            : row,
        ),
      }));
    },
    [],
  );

  /**
   * Applies the local rule to today's row.
   *
   * This is the fallback, not the primary path -- the server owns the thresholds now
   * and its record replaces this one when the request succeeds. It stays because a
   * punch is the one interaction a user will retry until something visible happens,
   * and refusing it because the API is down is a worse product than a record that
   * is briefly local.
   */
  const applyLocalRule = useCallback((action: 'in' | 'out') => {
    const date = localDayKey(new Date());
    const at = new Date().toISOString();

    setState((current) => {
      const existing = current.attendance.find(
        (record) => record.userId === current.activeUserId && record.date === date,
      );

      // Update in place rather than deleting and recreating. The previous
      // implementation rebuilt the row, which discarded `overtimeMinutes` and
      // moved the record to the top of the history.
      const next: AttendanceRecord =
        action === 'in'
          ? existing
            ? {
                ...existing,
                checkIn: at,
                checkOut: null,
                overtimeMinutes: 0,
                status: minutesOfDay(at) > LATE_AFTER_MINUTES ? 'LATE' : 'PRESENT',
              }
            : {
                id: `at-${current.activeUserId}-${date}`,
                userId: current.activeUserId,
                date,
                checkIn: at,
                checkOut: null,
                status: minutesOfDay(at) > LATE_AFTER_MINUTES ? 'LATE' : 'PRESENT',
                overtimeMinutes: 0,
              }
          : // Nothing to check out of: not checked in today.
            !existing?.checkIn
            ? existing ?? ({} as AttendanceRecord)
            : {
                ...existing,
                checkOut: at,
                overtimeMinutes: Math.max(0, minutesOfDay(at) - OVERTIME_AFTER_MINUTES),
              };

      if (action === 'out' && !existing?.checkIn) return current;

      return {
        ...current,
        attendance: [
          ...current.attendance.filter(
            (record) => !(record.userId === next.userId && record.date === next.date),
          ),
          next,
        ],
      };
    });
  }, []);

  /**
   * Sends a punch and adopts the server's record.
   *
   * Optimistic, then reconciled rather than rolled back: the local row goes in
   * immediately so the button responds, then the server's version replaces it. The
   * server's status is the one that wins, because it applied the threshold in the
   * app timezone rather than the browser's -- which is a different answer whenever
   * the two zones disagree about the day.
   *
   * A failure leaves the local row in place and surfaces `attendanceError`, so the
   * record on screen is visibly unpersisted rather than silently lost.
   */
  const sendPunch = useCallback((action: 'in' | 'out') => {
    applyLocalRule(action);
    setAttendanceError(null);

    void api
      .punch(action)
      .then(({ record }) => {
        setState((current) => ({
          ...current,
          attendance: [
            ...current.attendance.filter(
              (row) => !(row.userId === record.userId && row.date === record.date),
            ),
            record,
          ],
        }));
      })
      .catch((error: unknown) => {
        setAttendanceError(
          action === 'in'
            ? 'Could not save your check-in. The time shown is only on this device.'
            : 'Could not save your check-out. The time shown is only on this device.',
        );
        void error;
      });
  }, [applyLocalRule]);

  const punchIn = useCallback(() => sendPunch('in'), [sendPunch]);
  const punchOut = useCallback(() => sendPunch('out'), [sendPunch]);


  const addFiles = useCallback((rows: FileRow[]) => {
    if (rows.length === 0) return;
    setState((current) => ({ ...current, files: [...rows, ...current.files] }));
  }, []);

  const removeFile = useCallback((id: string) => {
    setState((current) => ({ ...current, files: current.files.filter((row) => row.id !== id) }));
  }, []);

  const toggleFileStar = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      files: current.files.map((row) => (row.id === id ? { ...row, starred: !row.starred } : row)),
    }));
  }, []);

  const activeUser = useMemo(
    () => directory.find((person) => person.id === state.activeUserId) ?? currentUser,
    [state.activeUserId],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      ...state,
      ready,
      activeUser,
      people: directory,
      signIn,
      signOut,
          addLeave,
          decideLeave,
          punchIn,
          punchOut,
          attendanceError,
          addFiles,
          removeFile,
          toggleFileStar,
        }),
        [
      state,
      ready,
      activeUser,
      signIn,
      signOut,
      addLeave,
      decideLeave,
      punchIn,
      punchOut,
      addFiles,
      removeFile,
      toggleFileStar,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return context;
}
