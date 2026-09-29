import { MeetingsView } from '@/components/meetings/MeetingsView';

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await searchParams;
  return <MeetingsView initialRoomId={room} />;
}
