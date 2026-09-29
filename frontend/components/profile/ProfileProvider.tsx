'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { directory, type Person } from '@/lib/data';
import { readJson, storageKeys, writeJson } from '@/lib/storage';
import { useWorkspace } from '@/components/workspace/WorkspaceProvider';

/**
 * Per-person editable profiles.
 *
 * This started as a single profile, which was already wrong: the settings form
 * kept its copy in local state, so a name edited in Settings never reached the
 * sidebar or the topbar. Adding a persona switcher made that untenable -- one
 * shared profile would have leaked Alex's edits onto Priya -- so this is a map
 * keyed by person id.
 *
 * Only the editable fields are persisted. `id`, `role`, `employeeCode` and
 * `online` are not user-editable, and writing them would only invite tampering
 * with values the app treats as authoritative.
 */
type EditableProfile = Pick<
  Person,
  'name' | 'email' | 'jobTitle' | 'department' | 'phone' | 'bio' | 'avatarUrl'
>;

type ProfileMap = Record<string, EditableProfile>;

type ProfileValue = {
  /** True once stored profiles have been read and applied. */
  ready: boolean;
  /** The full map, so resolvers can read it without re-parsing storage. */
  profiles: ProfileMap;
  setProfile: (patch: Partial<EditableProfile>) => void;
  clearAvatar: () => void;
};

const ProfileContext = createContext<ProfileValue | null>(null);

function editableOf(person: Person): EditableProfile {
  return {
    name: person.name,
    email: person.email,
    jobTitle: person.jobTitle ?? '',
    department: person.department ?? '',
    phone: person.phone,
    bio: person.bio,
    avatarUrl: person.avatarUrl,
  };
}

function applyPatch(person: Person, patch: Partial<EditableProfile>): Person {
  return {
    ...person,
    name: patch.name ?? person.name,
    email: patch.email ?? person.email,
    jobTitle: patch.jobTitle ?? person.jobTitle,
    department: patch.department ?? person.department,
    phone: patch.phone ?? person.phone,
    bio: patch.bio ?? person.bio,
    avatarUrl: patch.avatarUrl === undefined ? person.avatarUrl : patch.avatarUrl,
  };
}

function overlay(base: Person, stored: ProfileMap): Person {
  const patch = stored[base.id];
  return patch ? applyPatch(base, patch) : base;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  // Empty on the server and on the first client paint, then restored. Reading
  // storage during render would make the two disagree.
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [ready, setReady] = useState(false);
  const { activeUserId } = useWorkspace();

  useEffect(() => {
    setProfiles(readJson<ProfileMap>(storageKeys.profiles) ?? {});
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeJson(storageKeys.profiles, profiles);
  }, [ready, profiles]);

  const setProfile = useCallback(
    (patch: Partial<EditableProfile>) => {
      setProfiles((current) => {
        const base = directory.find((person) => person.id === activeUserId);
        const previous = current[activeUserId] ?? (base ? editableOf(base) : undefined);
        if (!previous) return current;

        return { ...current, [activeUserId]: { ...previous, ...patch } };
      });
    },
    [activeUserId],
  );

  const clearAvatar = useCallback(() => {
    setProfiles((current) => {
      const entry = current[activeUserId];
      if (!entry) return current;

      // Deleting the key beats storing `undefined`, which survives a round trip
      // through JSON as an absent property anyway.
      const next = { ...entry };
      delete next.avatarUrl;
      return { ...current, [activeUserId]: next };
    });
  }, [activeUserId]);

  const value = useMemo(
    () => ({ ready, profiles, setProfile, clearAvatar }),
    [ready, profiles, setProfile, clearAvatar],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile must be used inside <ProfileProvider>');
  return context;
}

/**
 * The person to render for `person`, with any local edits folded in.
 *
 * Edits are looked up by id, so the signed-in user sees their own changes
 * anywhere they appear and colleagues are never affected. Use this for a single
 * person; inside a list use `useDirectory` instead, because hooks cannot be
 * called in a loop.
 */
export function useResolvedPerson(person: Person | null | undefined): Person | null {
  const { ready, profiles } = useProfile();

  // Before the restore there is nothing to overlay, and returning the fixture
  // keeps the first paint identical to the server's.
  if (!person || !ready) return person ?? null;
  return overlay(person, profiles);
}

/** The directory with local edits applied. */
export function useDirectory(): Person[] {
  const { ready, profiles } = useProfile();

  return useMemo(
    () => (ready ? directory.map((person) => overlay(person, profiles)) : directory),
    [ready, profiles],
  );
}

/** The signed-in person, with local edits applied. */
export function useActivePerson(): Person {
  const { activeUser } = useWorkspace();
  return useResolvedPerson(activeUser) ?? activeUser;
}
