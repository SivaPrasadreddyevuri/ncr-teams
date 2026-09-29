import Link from 'next/link';
import {
  Search as SearchIcon,
  X,
  User,
  FileText,
  MessageCircle,
  Users,
  Hash,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import {
  calendarEvents,
  channels,
  directory,
  files,
  messages,
  personById,
  teams,
} from '@/lib/data';
import { formatBytes, formatDate, formatTime, parseDayKey, relativeTime } from '@/lib/format';

type Scope = 'all' | 'people' | 'messages' | 'files' | 'events' | 'teams';

type Result = {
  key: string;
  scope: Exclude<Scope, 'all'>;
  title: string;
  detail: string;
  context: string;
  href: string;
  /** Drives the recency tiebreak. Null for entities with no timestamp. */
  stamp: string | null;
};

const SCOPES: Array<{ id: Scope; label: string; icon: LucideIcon }> = [
  { id: 'all', label: 'All', icon: SearchIcon },
  { id: 'people', label: 'People', icon: User },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'events', label: 'Events', icon: CalendarDays },
  { id: 'teams', label: 'Teams', icon: Users },
];

const SCOPE_ICON: Record<Exclude<Scope, 'all'>, LucideIcon> = {
  people: User,
  messages: MessageCircle,
  files: FileText,
  events: CalendarDays,
  teams: Users,
};

/**
 * Score a candidate string against the query.
 *
 * Exact match beats a prefix, which beats a word-boundary hit, which beats a
 * loose substring. Without this, a search for "design" ranks a file called
 * `redesign-notes.md` above a channel actually called "design".
 */
function score(haystack: string, needle: string): number {
  const value = haystack.toLowerCase();
  if (value === needle) return 100;
  if (value.startsWith(needle)) return 80;
  if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(value)) return 60;
  if (value.includes(needle)) return 40;
  return 0;
}

/** Splits `text` around every case-insensitive occurrence of `term`. */
function highlight(text: string, term: string) {
  if (!term) return text;
  const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return text.split(pattern).map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? <mark key={index}>{part}</mark> : part,
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const term = (params.q ?? '').trim();
  const needle = term.toLowerCase();
  const scope: Scope = SCOPES.some((s) => s.id === params.scope) ? (params.scope as Scope) : 'all';

  const results: Result[] = [];

  if (needle) {
    for (const person of directory) {
      // Name and job title both count, so "designer" finds the designer.
      const rank = Math.max(score(person.name, needle), score(person.jobTitle ?? '', needle) * 0.7);
      if (rank > 0) {
        results.push({
          key: `p-${person.id}`,
          scope: 'people',
          title: person.name,
          detail: person.jobTitle ?? 'Team member',
          context: person.department ?? 'Directory',
          href: '/hr',
          stamp: null,
        });
      }
    }

    for (const message of messages) {
      const rank = score(message.body, needle);
      if (rank > 0) {
        const channel = channels.find((c) => c.id === message.channelId);
        results.push({
          key: `m-${message.id}`,
          scope: 'messages',
          title: message.body,
          detail: personById(message.authorId)?.name ?? 'Unknown',
          context: channel ? `${channel.teamName} / #${channel.name}` : 'Message',
          href: '/chat',
          stamp: message.createdAt,
        });
      }
    }

    for (const file of files) {
      const rank = Math.max(score(file.name, needle), score(file.team, needle) * 0.5);
      if (rank > 0) {
        results.push({
          key: `f-${file.id}`,
          scope: 'files',
          title: file.name,
          detail: file.folder ? 'Folder' : formatBytes(file.size),
          context: file.team,
          href: '/files',
          stamp: file.createdAt,
        });
      }
    }

    for (const event of calendarEvents) {
      const rank = Math.max(
        score(event.title, needle),
        score(event.location, needle) * 0.6,
      );
      if (rank > 0) {
        results.push({
          key: `e-${event.id}`,
          scope: 'events',
          title: event.title,
          detail: `${formatTime(event.startsAt)} \u00b7 ${event.location}`,
          context: formatDate(event.startsAt),
          href: '/calendar',
          stamp: event.startsAt,
        });
      }
    }

    for (const team of teams) {
      const rank = Math.max(score(team.name, needle), score(team.description, needle) * 0.6);
      if (rank > 0) {
        results.push({
          key: `t-${team.id}`,
          scope: 'teams',
          title: team.name,
          detail: team.description,
          context: `${team.memberCount} members \u00b7 ${team.channelCount} channels`,
          href: '/teams',
          stamp: null,
        });
      }
    }

    for (const channel of channels) {
      const rank = score(channel.name, needle);
      if (rank > 0) {
        results.push({
          key: `c-${channel.id}`,
          scope: 'files',
          title: `#${channel.name}`,
          detail: channel.lastMessage,
          context: channel.teamName,
          href: '/chat',
          stamp: channel.lastAt,
        });
      }
    }
  }

  // Rank by match quality, then break ties on recency so fresh hits float up.
  const ranked = results
    .filter((r) => scope === 'all' || r.scope === scope)
    .map((r) => ({
      result: r,
      rank: Math.max(score(r.title, needle), score(r.detail, needle) * 0.5),
      time: r.stamp ? new Date(r.stamp).getTime() || 0 : 0,
    }))
    .sort((a, b) => b.rank - a.rank || b.time - a.time)
    .map((entry) => entry.result);

  const counts = SCOPES.map((entry) => ({
    ...entry,
    total: entry.id === 'all' ? results.length : results.filter((r) => r.scope === entry.id).length,
  }));

  return (
    <div className="search-page">
      <form className="search-page-bar" action="/search">
        <SearchIcon size={19} />
        <input
          name="q"
          defaultValue={term}
          placeholder="Search people, messages, files and events"
          autoFocus
        />
        {scope !== 'all' && <input type="hidden" name="scope" value={scope} />}
      </form>

      <div className="scope-chips" role="tablist" aria-label="Filter results by type">
        {counts.map((entry) => (
          <Link
            key={entry.id}
            href={`/search?q=${encodeURIComponent(term)}&scope=${entry.id}`}
            className={scope === entry.id ? 'scope-chip active' : 'scope-chip'}
            role="tab"
            aria-selected={scope === entry.id}
            scroll={false}
          >
            <entry.icon size={14} />
            {entry.label}
            {entry.total > 0 && <span className="scope-count">{entry.total}</span>}
          </Link>
        ))}
      </div>

      {!term ? (
        <div className="panel search-idle">
          <span className="empty-icon">
            <SearchIcon size={22} />
          </span>
          <h2>Search the workspace</h2>
          <p>Find people, channels, messages, files, events and teams.</p>
          <ul className="search-suggestions">
            {['design', 'roadmap', 'api', 'standup'].map((hint) => (
              <li key={hint}>
                <Link href={`/search?q=${hint}`}>
                  <SearchIcon size={12} /> {hint}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : ranked.length === 0 ? (
        <div className="panel search-idle">
          <span className="empty-icon">
            <SearchIcon size={22} />
          </span>
          <h2>No results for &ldquo;{term}&rdquo;</h2>
          <p>Check the spelling, or try a broader keyword.</p>
          <ul className="search-suggestions">
            {['design', 'roadmap', 'api', 'standup'].map((hint) => (
              <li key={hint}>
                <Link href={`/search?q=${hint}`}>
                  <SearchIcon size={12} /> {hint}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p className="search-count">
            {ranked.length} result{ranked.length === 1 ? '' : 's'} for <strong>&ldquo;{term}&rdquo;</strong>
          </p>

          <ul className="result-list">
            {ranked.map((result) => {
              const Icon = SCOPE_ICON[result.scope];
              return (
                <li key={result.key}>
                  <Link className="result" href={result.href}>
                    <span className="result-icon">
                      <Icon size={16} />
                    </span>

                    <span className="result-body">
                      <span className="result-title">{highlight(result.title, term)}</span>
                      <span className="result-detail">
                        {result.detail && highlight(result.detail, term)}
                      </span>
                      <span className="result-context">{result.context}</span>
                    </span>

                    {result.stamp && (
                      <span className="result-time">{relativeTime(result.stamp)}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
