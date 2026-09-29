import Link from 'next/link';
import { Hash } from 'lucide-react';
import { channels, teams } from '@/lib/data';
import { relativeTime } from '@/lib/format';

export default function ChannelsPage() {
  const byTeam = teams.map((team) => ({
    team,
    items: channels.filter((channel) => channel.teamId === team.id),
  }));

  return (
    <div className="grid-2">
      {byTeam
        .filter((group) => group.items.length > 0)
        .map(({ team, items }) => (
          <div className="section-card" key={team.id}>
            <div className="section-head">
              <h2>{team.name}</h2>
              <Link className="text-btn" href="/chat">
                Open chat
              </Link>
            </div>

            {items.map((channel) => (
              <Link
                className="meeting-row"
                href="/chat"
                key={channel.id}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Hash size={16} />
                <div className="meeting-info">
                  <strong>
                    {channel.name}
                    {channel.unread > 0 && (
                      <span className="unread" style={{ marginLeft: 8 }}>
                        {channel.unread}
                      </span>
                    )}
                  </strong>
                  <small>{channel.lastMessage}</small>
                </div>
                <small style={{ color: 'var(--muted)' }}>{relativeTime(channel.lastAt)}</small>
              </Link>
            ))}
          </div>
        ))}
    </div>
  );
}
