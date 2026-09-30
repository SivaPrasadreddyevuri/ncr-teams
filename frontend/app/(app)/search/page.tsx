import Link from 'next/link';
import {
  Search as SearchIcon,
  User,
  FileText,
  MessageCircle,
  Users,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react';
import { api, type SearchResult } from '@/lib/api';
import {
  calendarEvents,
  channels,
  directory,
  files,
  messages,
  personById,
  teams,
} from '@/lib/data';
import { formatBytes, formatDate, formatTime, relativeTime } from '@/lib/format';

type Scope = 'all' | 'people' | 'messages' | 'files' | 'events' | 'teams';

/**
 * A result as the page renders it, whether it came from the API or the fixture
 * fallback. The two sources are normalised into this rather than the page
 * branching on which one it got.
 */
type Result = SearchResult & { key: string };

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
 * Only used by the fixture fallback below. The live path ranks in Postgres with
 * `ts_rank_cd` and trigram similarity, which can match a stem or a substring --
 * neither of which a string comparison can do.
 */
function score(haystack: string, needle: string): number {
  const value = haystack.toLowerCase();
  if (value === needle) return 100;
  if (value.startsWith(needle)) return 80;
  if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(value)) return 60;
  if (value.includes(needle)) return 40;
  return 0;
}

/**
 * Search the fixture data, for when the API is unreachable.
 *
 * This is the same code the page ran before it had an API, kept for the
 * deployment where the backend is down -- a viewer sees a working, if cruder,
 * search rather than an error page.
 *
 * It is the *only* consumer of `score`, and the reason it is a separate function
 * is that being the only consumer is the point: there is no way for the live path
 * to quietly start using it.
 *
 * Note what this cannot do that the API can: it has no `websearch` operators, no
 * stemming, and no knowledge of which channels the viewer is a member of. That
 * last one is why it is a fallback and not the default -- it searches every
 * message in the fixture, including ones the API would refuse.
 */
function fixtureSearch(term: string): Result[] {
  const needle = term.toLowerCase();
  const results: Result[] = [];

  for (const person of directory) {
    // Name and job title both count, so "designer" finds the designer.
    const rank = Math.max(score(person.name, needle), score(person.jobTitle ?? '', needle) * 0.7);
    if (rank > 0) {
      results.push({
        key: `p-${person.id}`,
        id: person.id,
        scope: 'people',
        title: person.name,
        detail: person.jobTitle ?? 'Team member',
        context: person.department ?? 'Directory',
        href: '/hr',
        snippet: null,
        stamp: null,
        rank,
      });
    }
  }

  for (const message of messages) {
    const rank = score(message.body, needle);
    if (rank > 0) {
      const channel = channels.find((c) => c.id === message.channelId);
      results.push({
        key: `m-${message.id}`,
        id: message.id,
        scope: 'messages',
        title: message.body,
        detail: personById(message.authorId)?.name ?? 'Unknown',
        context: channel ? `${channel.teamName} / #${channel.name}` : 'Message',
        href: '/chat',
        snippet: null,
        stamp: message.createdAt,
        rank,
      });
    }
  }

  for (const file of files) {
    const rank = Math.max(score(file.name, needle), score(file.team, needle) * 0.5);
    if (rank > 0) {
      results.push({
        key: `f-${file.id}`,
        id: file.id,
        scope: 'files',
        title: file.name,
        detail: file.folder ? 'Folder' : formatBytes(file.size),
        context: file.team,
        href: '/files',
        snippet: null,
        stamp: file.createdAt,
        rank,
      });
    }
  }

  for (const event of calendarEvents) {
    const rank = Math.max(score(event.title, needle), score(event.location, needle) * 0.6);
    if (rank > 0) {
      results.push({
        key: `e-${event.id}`,
        id: event.id,
        scope: 'events',
        title: event.title,
        detail: `${formatTime(event.startsAt)} · ${event.location}`,
        context: formatDate(event.startsAt),
        href: '/calendar',
        snippet: null,
        stamp: event.startsAt,
        rank,
      });
    }
  }

  for (const team of teams) {
    const rank = Math.max(score(team.name, needle), score(team.description, needle) * 0.6);
    if (rank > 0) {
      results.push({
        key: `t-${team.id}`,
        id: team.id,
        scope: 'teams',
        title: team.name,
        detail: team.description,
        context: `${team.memberCount} members · ${team.channelCount} channels`,
        href: '/teams',
        snippet: null,
        stamp: null,
        rank,
      });
    }
  }

  for (const channel of channels) {
    const rank = score(channel.name, needle);
    if (rank > 0) {
      results.push({
        key: `c-${channel.id}`,
        id: channel.id,
        scope: 'files',
        title: `#${channel.name}`,
        detail: channel.lastMessage,
        context: channel.teamName,
        href: '/chat',
        snippet: null,
        stamp: channel.lastAt,
        rank,
      });
    }
  }

  return results;
}

/** Splits `text` around every case-insensitive occurrence of `term`. */
function highlight(text: string, term: string) {
  if (!term) return text;
  const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return text.split(pattern).map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? <mark key={index}>{part}</mark> : part,
  );
}

/**
 * Renders a server-side snippet, which already contains the matched words wrapped
 * in `<mark>` by `ts_headline`.
 *
 * The text is split on the markers and rendered as elements rather than passed to
 * `dangerouslySetInnerHTML`. A snippet contains user-authored message text, and
 * this page has no sanitisation step, so the safe route is the only one that can
 * be correct -- including for the markers themselves, which are the only HTML the
 * server is trusted to emit.
 */
function renderSnippet(snippet: string) {
  return snippet.split(/(<mark>|<\/mark>)/).map((part, index) => {
    if (part === '<mark>') return null;
    if (part === '</mark>') return <mark key={index} />;
    return part;
  });
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const term = (params.q ?? '').trim();
  const scope: Scope = SCOPES.some((s) => s.id === params.scope) ? (params.scope as Scope) : 'all';

  /**
   * A server component, so the API is called here rather than through
   * `useApiData`.
   *
   * That is a deliberate departure from the other screens, and it buys two things
   * the client hook cannot: the results are in the HTML, so a search URL is
   * shareable and works with JavaScript off, and the ranking happens before
   * anything is sent.
   *
   * The cost is that the localStorage cache tier of the usual fallback chain is
   * not available -- a server has no localStorage. So a down API falls back to
   * the fixtures rather than to a cached response, which is worse but not empty.
   */
  let ranked: Result[] = [];
  let counts: Array<{ id: Scope; label: string; icon: LucideIcon; total: number }> = [];
  let stale = false;

  if (term) {
    try {
      const response = await api.search({ q: term, scope, limit: 50 });

      ranked = response.results.map((result) => ({ ...result, key: `${result.scope}-${result.id}` }));

      // The counts come from the same ranked set as the results, which is the only
      // way a chip's number can be trusted. The fallback below recomputes them
      // from its own list, for the same reason.
      counts = SCOPES.map((entry) => ({
        ...entry,
        total:
          entry.id === 'all'
            ? Object.values(response.counts).reduce((sum, n) => sum + n, 0)
            : response.counts[entry.id],
      }));
    } catch {
      // A down API should look like a worse search, not like a broken page.
      stale = true;
      const found = fixtureSearch(term);
      ranked = found.filter((r) => scope === 'all' || r.scope === scope);
      counts = SCOPES.map((entry) => ({
        ...entry,
        total:
          entry.id === 'all'
            ? found.length
            : found.filter((r) => r.scope === entry.id).length,
      }));
    }
  }


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
            {stale && (
              <>
                {' '}
                <span className="search-stale" title="The API was unreachable, so these are demo results rather than live ones.">
                  showing demo data
                </span>
              </>
            )}
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
                      {/* A message snippet from the database, already marked up
                          server-side, because only ts_headline knows which words
                          the tsquery actually matched. It is rendered as elements
                          rather than injected. */}
                      {result.snippet ? (
                        <span className="result-detail">{renderSnippet(result.snippet)}</span>
                      ) : (
                        <span className="result-detail">
                          {result.detail && highlight(result.detail, term)}
                        </span>
                      )}
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
