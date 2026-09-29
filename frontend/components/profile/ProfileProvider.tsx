'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { currentUser, directory, type Person } from '@/lib/data';
import { readJson, storageKeys, writeJson } from '@/lib/storage';

/**
 * The signed-in person's editable profile.
 *
 * This exists because `lib/data.ts` is a static module: every screen imported
 * `currentUser` directly, so editing your name or photo in Settings could never
 * reach the sidebar, the topbar or anywhere else. Holding the profile in
 * context makes the settings form and the rest of the app read one value.
 *
 * Only the editable fields are persisted. `id`, `role`, `employeeCode` and
 * `online` are deliberately left out: they are not user-editable, and writing
 * them to storage would only invite tampering with values the app treats as
 * authoritative.
 */
type EditableProfile = Pick<
  Person,
  'name' | 'email' | 'jobTitle' | 'department' | 'phone' | 'bio' | 'avatarUrl'
>;

type ProfileContextValue = {
  profile: Person;
  /** True once the stored profile has been read and applied. */
  ready: boolean;
  setProfile: (patch: Partial<EditableProfile>) => void;
  clearAvatar: () => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

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

function toPerson(previous: Person, patch: Partial<EditableProfile>): Person {
  return {
    ...previous,
    name: patch.name ?? previous.name,
    email: patch.email ?? previous.email,
    jobTitle: patch.jobTitle ?? previous.jobTitle,
    department: patch.department ?? previous.department,
    phone: patch.phone ?? previous.phone,
    bio: patch.bio ?? previous.bio,
    avatarUrl: patch.avatarUrl === undefined ? previous.avatarUrl : patch.avatarUrl,
  };
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  // The server and the first client paint both render `currentUser`, and the
  // stored profile is applied afterwards in an effect. Reading localStorage
  // during render would make the two disagree.
  const [profile, setProfileState] = useState<Person>(currentUser);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readJson<Partial<EditableProfile>>(storageKeys.profile);
    if (stored) setProfileState((current) => toPerson(current, stored));
    setReady(true);
  }, []);

  const setProfile = useCallback((patch: Partial<EditableProfile>) => {
    setProfileState((current) => {
      const next = toPerson(current, patch);
      writeJson(storageKeys.profile, editableOf(next));
      return next;
    });
  }, []);

  const clearAvatar = useCallback(() => {
    setProfileState((current) => {
      const next = { ...current };
      // Deleting the key is explicit rather than storing `undefined`, so a
      // later parse cannot resurrect a stale value from a null.
      delete next.avatarUrl;
      writeJson(storageKeys.profile, editableOf(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ profile, ready, setProfile, clearAvatar }),
    [profile, ready, setProfile, clearAvatar],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile must be used inside <ProfileProvider>');
  return context;
}

/**
 * The person to display for `person`, with local edits folded in.
 *
 * Only the signed-in user is ever overridable. Colleagues fall through to the
 * static dataset untouched, because there is no UI to edit them and letting the
 * store drift from the fixture would be worse than the duplication.
 *
 * Use this for a single person. Inside a list, use `useDirectory` instead --
 * hooks cannot be called in a loop.
 */
export function useResolvedPerson(person: Person | null | undefined): Person | null {
  const { profile } = useProfile();
  if (!person) return null;
  return person.id === currentUser.id ? profile : person;
}

/**
 * The directory with the signed-in user's local edits applied.
 *
 * A server-rendered list cannot call this, because it has no access to browser
 * storage. Those lists still show the uploaded photo -- `PersonAvatar` is a
 * client component and reads the store itself -- but their *name* labels come
 * from the fixture. That asymmetry is deliberate rather than an oversight.
 */
export function useDirectory(): Person[] {
  const { profile } = useProfile();

  return useMemo(
    () => directory.map((person) => (person.id === currentUser.id ? profile : person)),
    [profile],
  );
}
