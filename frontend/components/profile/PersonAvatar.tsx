'use client';

import { Avatar, type AvatarSize } from '@/components/Avatar';
import type { Person } from '@/lib/data';
import { initials } from '@/lib/format';
import { useResolvedPerson } from './ProfileProvider';

/**
 * An avatar for a person, which shows the signed-in user's uploaded photo and
 * everyone else's initials.
 *
 * This is the indirection that lets a photo reach the sidebar, the topbar, chat,
 * meetings, attendance, HR, calls and the calendar without any of those screens
 * knowing where the image came from. Those screens hold a `Person` from the
 * static dataset; only this component reads the local profile.
 *
 * It is a client component so a *server* component can render it -- `hr/page.tsx`
 * and `calls/page.tsx` both list people without being able to read storage.
 */
export function PersonAvatar({
  person,
  name,
  size,
  online,
}: {
  /** Optional because several call sites look a person up and may find nothing. */
  person?: Person | null;
  /** Used when there is no person object, matching the old `?? '?'` fallback. */
  name?: string;
  size?: AvatarSize;
  online?: boolean;
}) {
  const resolved = useResolvedPerson(person);

  return (
    <Avatar
      initials={initials(resolved?.name ?? name ?? '?')}
      src={resolved?.avatarUrl}
      size={size}
      online={online ?? resolved?.online}
    />
  );
}
