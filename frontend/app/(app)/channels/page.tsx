'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Hash } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import { relativeTime } from '@/lib/format';
import { channels as seedChannels, teams as seedTeams, type Channel, type Team } from '@/lib/data';

/**
 * Channels, grouped by team.
 *
 * Both the team list and the channel list come from the API, with the fixtures
 * as the seed. Channels are fetched per team rather than with one unfiltered
 * request, because the API requires a `teamId` -- an unfiltered listing would
 * return channels from teams the caller is not in, and that guard is worth more
 * than the round trip.
 *
 * The team list has to arrive before the channel fan-out can start, so this is
 * two dependent fetches rather than one. The seed covers the gap: the page
 * renders its real shape immediately and the numbers update under it.
 */
export default function ChannelsPage() {
  const teams = useApiData<Team[]>(
    'teams',
    (signal) => api.teams(signal).then((r) => r.teams),
    seedTeams,
  );

  const [teamIds, setTeamIds] = useState<string[] | null>(null);

  useEffect(() => {
    setTeamIds(teams.data.map((team) => team.id));
  }, [teams.data]);

  const groupedChannels = useApiData<Channel[]>(
    'channels:all',
    (signal) => api.channelsForTeams(teamIds ?? [], signal),
    // Empty until the team ids are known, so there is nothing to seed from the
    // API side. The fixture list below is the actual seed.
    [],
  );

  /*
   * Seeded from the fixtures directly rather than passed in, because a fallback
   * should need no round trip. Only a non-empty live response replaces it, so a
   * caller who genuinely belongs to no teams keeps a readable page rather than
   * an empty grid.
   */
  const [channels, setChannels] = useState<Channel[]>(seedChannels);

  useEffect(() => {
    if (groupedChannels.data.length > 0) setChannels(groupedChannels.data);
  }, [groupedChannels.data]);

  const byTeam = useMemo(
    () =>
      teams.data
        .map((team) => ({
          team,
          items: channels.filter((channel) => channel.teamId === team.id),
        }))
        .filter((group) => group.items.length > 0),
    [teams.data, channels],
  );

  return (
    <div className="grid-2">
      {byTeam.map(({ team, items }) => (
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
              {/* The API returns null for a channel with no messages yet, which
                  `relativeTime` cannot take. Rendered as nothing rather than
                  passing null into a date formatter. */}
              <small style={{ color: 'var(--muted)' }}>
                {channel.lastAt ? relativeTime(channel.lastAt) : ''}
              </small>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
