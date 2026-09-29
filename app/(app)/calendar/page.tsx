import { CalendarWeek } from '@/components/calendar/CalendarWeek';
import { calendarEvents, currentUser, directory } from '@/lib/data';

export default function CalendarPage() {
  return (
    <CalendarWeek
      initialEvents={calendarEvents}
      people={directory}
      currentUserId={currentUser.id}
    />
  );
}
