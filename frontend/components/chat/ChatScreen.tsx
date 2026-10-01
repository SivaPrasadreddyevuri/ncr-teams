'use client';

import { useEffect, useState } from 'react';
import { ChatClient } from '@/components/chat/ChatClient';
import { useActivePerson, useDirectory } from '@/components/profile/ProfileProvider';
import { api, type Channel } from '@/lib/api';
import { useApiData } from '@/lib/useApiData';
import {
  channels as seedChannels,
  directory,
  messages as seedMessages,
  type ChatMessage,
} from '@/lib/data';

/**
 * The chat screen's data.
 *
 * The route file used to hand `ChatClient` the fixtures directly, so the sidebar,
 * the member list and the unread badges were invented while the thread beside them
 * was live -- which is worse than being uniformly fake, because it looks like one
 * screen works.
 *
 * Two dependent fetches, not one. `channelsForTeams` requires a `teamId`, and the
 * API refuses an unfiltered listing on purpose: an unfiltered one would return
 * channels from teams the caller is not in. So the team list has to arrive before
 * the channel fan-out can start.
 *
 * The fixtures stay as the seed, which is what `useApiData` is for. A visitor who
 * reaches `/chat` before signing in still gets a populated thread.
 */
export function ChatScreen() {
  const teams = useApiData(
    'teams',
    (signal) => api.teams(signal).then((r) => r.teams),
    [],
  );

  const [teamIds, setTeamIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (teams.data.length > 0) setTeamIds(teams.data.map((team) => team.id));
  }, [teams.data]);

  const fetched = useApiData<Channel[]>(
    'chat:channels',
    (signal) => api.channelsForTeams(teamIds ?? [], signal),
    [],
  );

  /**
   * Only a non-empty live response replaces the seed.
   *
   * A caller who genuinely belongs to no teams keeps a readable channel list
   * rather than an empty sidebar with no explanation -- the same rule the channels
   * screen uses, and for the same reason.
   */
  const [channels, setChannels] = useState<Channel[]>(seedChannels);
  useEffect(() => {
    if (fetched.data.length > 0) setChannels(fetched.data);
  }, [fetched.data]);

  /**
   * Messages seeded from the fixtures, handed over once.
   *
   * `ChatClient` owns the live message list and replaces it per channel as it
   * navigates, so this is only the starting value -- the shape the screen renders
   * before the first request resolves.
   */
  const [messages, setMessages] = useState<ChatMessage[]>(seedMessages);
  useEffect(() => {
    setMessages(seedMessages);
  }, []);

  // The directory, not the fixture. `ChatClient` takes people as a prop, and
  // ProfileProvider is already the live one -- with the local profile overlay on
  // top, so an edit in Settings still shows here.
  const people = useDirectory();
  const me = useActivePerson();

  return (
    <ChatClient
      channels={channels}
      initialMessages={messages}
      people={people.length > 0 ? people : directory}
      currentUserId={me.id}
    />
  );
}
