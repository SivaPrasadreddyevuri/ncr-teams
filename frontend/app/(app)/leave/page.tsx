import { LeaveRequestForm } from '@/components/leave/LeaveRequestForm';
import { MyLeaveRequests } from '@/components/leave/MyLeaveRequests';

/**
 * Leave, for everyone.
 *
 * Split from `/hr` on purpose: requesting time off is something any employee
 * does, while `/hr` is the approval queue and is gated behind the HR role. The
 * form and the requester's own history are the only two things here, and both
 * read the shared workspace store, so a request submitted on this page appears
 * in the HR queue immediately.
 */
export default function LeavePage() {
  return (
    <div className="grid-2">
      <LeaveRequestForm />
      <MyLeaveRequests />
    </div>
  );
}
