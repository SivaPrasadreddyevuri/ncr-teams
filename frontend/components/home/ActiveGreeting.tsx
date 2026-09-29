'use client';

import { useEffect, useState } from 'react';
import { useActivePerson } from '@/components/profile/ProfileProvider';
import { appHour } from '@/lib/format';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The greeting line.
 *
 * It used to be rendered by a server component from `new Date()`, which froze
 * "Good morning" into the prerendered HTML -- a build at 23:00 shipped
 * "Good evening" to everyone until the next deploy, next to a live clock showing
 * the opposite. It is client-rendered behind a mount gate instead, so the first
 * paint matches the server's placeholder and the real value arrives after it.
 */
export function ActiveGreeting() {
  const me = useActivePerson();
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    setHour(appHour(new Date()));
  }, []);

  const firstName = me.name.split(' ')[0];

  return (
    <h2>
      {hour === null ? (
        <span className="greeting-placeholder">&nbsp;</span>
      ) : (
        `${greeting(hour)}, ${firstName}`
      )}
    </h2>
  );
}
