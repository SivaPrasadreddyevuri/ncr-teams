import { ChatClient } from '@/components/chat/ChatClient';
import { channels, directory, messages, currentUser } from '@/lib/data';

export default function ChatPage() {
  return (
    <ChatClient
      channels={channels}
      initialMessages={messages}
      people={directory}
      currentUserId={currentUser.id}
    />
  );
}
