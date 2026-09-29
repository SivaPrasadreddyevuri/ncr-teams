import { SectionCard } from '@/components/SectionCard';
import { PersonAvatar } from '@/components/profile/PersonAvatar';
import { currentUser, departments, directory } from '@/lib/data';
import { LeaveTable } from '@/components/hr/LeaveTable';

export default function HrPage() {
  return (
    <>
      <LeaveTable currentUserId={currentUser.id} />

      <div className="grid-2" style={{ marginTop: 14 }}>
        <SectionCard title="Departments">
          {departments.map((department) => (
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
            {directory.map((person) => (
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
    </>
  );
}
