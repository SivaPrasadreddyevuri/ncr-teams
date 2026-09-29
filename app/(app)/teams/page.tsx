import { TeamsGrid } from '@/components/teams/TeamsGrid';
import { currentUser, teams } from '@/lib/data';

export default function TeamsPage() {
  return <TeamsGrid initialTeams={teams} currentUserId={currentUser.id} />;
}
