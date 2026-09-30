'use client';

import { useEffect, useState } from 'react';
import { SectionCard } from '@/components/SectionCard';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { RoleGate } from '@/components/workspace/RoleGate';
import { LeaveTable } from '@/components/hr/LeaveTable';
import { api } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { departments as seedDepartments, directory as seedDirectory } from '@/lib/data';
import type { Department, Person } from '@/lib/api';

/**
 * HR tools.
 *
 * Departments and the directory come from the API, with the fixtures as the
 * seed. Both are two tiny reads and both are read-only, so this screen is the
 * least risky one to move and a good check that the pattern works before it is
 * used on something busier.
 *
 * `LeaveTable` still reads the fixtures: the leave endpoints do not exist yet,
 * so wiring it would be pointing it at a route that 404s.
 */
export default function HrPage() {
  const departments = useApiData<Department[]>(
    'departments',
    (signal) => api.departments(signal).then((r) => r.departments),
    // The fixture rows carry a `members` count and a `head` name, which is the
    // same shape the API returns, so they are a valid seed.
    seedDepartments as Department[],
  );

  const people = useApiData<Person[]>(
    'users',
    (signal) => api.users(signal).then((r) => r.users),
    seedDirectory,
  );

  // Local state so the grid is driven by whichever source won, and so a refresh
  // replaces the list rather than leaving a stale copy in `useState` forever.
  const [rows, setRows] = useState<Department[]>(seedDepartments as Department[]);
  const [members, setMembers] = useState<Person[]>(seedDirectory);

  useEffect(() => setRows(departments.data), [departments.data]);
  useEffect(() => setMembers(people.data), [people.data]);

  return (
    <RoleGate roles={['HR_ADMIN']} what="HR tools">
      <LeaveTable />

      <div className="grid-2" style={{ marginTop: 14 }}>
        <SectionCard title="Departments">
          {rows.map((department) => (
            <div className="meeting-row" key={department.id}>
              <div className="meeting-info">
                <strong>{department.name}</strong>
                <small>{department.description}</small>
              </div>
              <small style={{ color: 'var(--muted)' }}>{department.head}</small>
            </div>
          ))}
        </SectionCard>

        <SectionCard title="Directory">
          <div className="members">
            {members.map((person) => (
              <div className="member" key={person.id}>
                <PersonAvatar person={person} size="sm" online={person.online} />
                <div>
                  <strong>{person.name}</strong>
                  <small>
                    {person.jobTitle ?? 'Team member'} &bull; {person.email}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </RoleGate>
  );
}
