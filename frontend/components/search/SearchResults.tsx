/**
 * Search results.
 *
 * Split out of app/(app)/search/page.tsx because Next only permits a page module
 * to export a fixed set of names -- metadata, default, generateStaticParams and a
 * handful of config exports -- and a named component export is a build error
 * rather than a lint warning.
 *
 * It is a client component because the endpoint needs the session cookie. See the
 * note on `request` in `lib/api.ts`: a server component calling it does not fail,
 * it hangs, and the build reports it as a slow page.
 */
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Suspense, useMemo, type FormEvent } from 'react';
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
import { useApiData } from '@/lib/useApiData';
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

/**
 * The results list.
 *
 * A client component, which is not a stylistic choice. The endpoint needs the
 * session cookie, and a server component cannot send it -- see the note on
 * `request` in `lib/api.ts`. An earlier version of this page was a server
 * component awaiting `api.search`, which looked fine because `searchParams`
 * forced it dynamic and the build never executed it. In production it would have
 * hung rather than failed.
 *
 * The URL stays the source of truth for the query, so a search is still shareable
 * and still works as a plain link. What is lost is results-in-the-HTML: they
 * arrive after hydration, the same as every other live screen here.
 */
export function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const term = (params.get('q') ?? '').trim();
  const rawScope = params.get('scope');
  const scope: Scope = SCOPES.some((s) => s.id === rawScope) ? (rawScope as Scope) : 'all';

  /**
   * The fixture fallback.
   *
   * Passed to `useApiData` as the seed value rather than fetched separately, so
   * the down-API path is the same code path as the normal one -- there is no
   * second rendering branch to keep in step with the first.
   *
   * `useApiData` cannot be called conditionally, so it is called unconditionally
   * and given an empty query when there is no term. The endpoint would 400 on an
   * empty `q`, so the fetcher short-circuits to [] instead.
   */
  const fallback = useMemo(() => {
    const found = term ? fixtureSearch(term) : [];
    return {
      results: found.filter((r) => scope === 'all' || r.scope === scope),
      counts: Object.fromEntries(
        SCOPES.filter((entry) => entry.id !== 'all').map((entry) => [
          entry.id,
          found.filter((r) => r.scope === entry.id).length,
        ]),
      ),
    };
  }, [term, scope]);

  const { data, stale } = useApiData<{ results: Result[]; counts: Partial<Record<Scope, number>> }>(
    // The query is part of the cache key. Leaving it out would show one search's
    // results for another term, which is the kind of bug that looks like the API
    // being wrong rather than the cache.
    `search:${scope}:${term}`,
    (signal) => {
      if (!term) return Promise.resolve({ results: [], counts: {} });
      return api
        .search({ q: term, scope, limit: 50 }, signal)
        .then((r) => ({ results: r.results.map((x) => ({ ...x, key: `${x.scope}-${x.id}` })), counts: r.counts }));
    },
    fallback,
  );

  const ranked = data.results;
  const counts = SCOPES.map((entry) => ({
    ...entry,
    total:
      entry.id === 'all'
        ? SCOPES.filter((s) => s.id !== 'all').reduce((sum, s) => sum + (data.counts[s.id] ?? 0), 0)
        : data.counts[entry.id] ?? 0,
  }));

  /** Re-runs the search in the same tab, without the history entry a Link makes. */
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget as HTMLFormElement).get('q');
    const next = new URLSearchParams();
    const query = String(value ?? '').trim();
    if (query) next.set('q', query);
    // The scope is preserved across a new query. Dropping it would silently widen
    // a search the user had narrowed to files.
    if (scope !== 'all') next.set('scope', scope);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`);
  };


  return (
    <div className="search-page">
      {/* onSubmit rather than a plain GET form, so the scope survives and the
          history is not filled with every keystroke's navigation. */}
      <form className="search-page-bar" onSubmit={submit} role="search">
        <SearchIcon size={19} />
        <input
          name="q"
          defaultValue={term}
          key={term}
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
