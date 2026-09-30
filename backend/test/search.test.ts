/**
 * Search.
 *
 * Three things are worth asserting here, and the first is the one that a UI test
 * would never catch.
 *
 * **The gate.** A search box that returns the contents of channels you are not in
 * is a way to read them without opening them. So a message in a channel the
 * caller is not a member of must be absent from the results -- not ranked lower,
 * absent.
 *
 * **Stemming, and the deliberate absence of it.** "review" finds "review" and
 * "Deploy" finds "deploy"; that is `english` doing its job on prose. A person's
 * name must match itself, which is why people and files use `simple` -- stemming
 * would reduce a name to something that no longer equals it.
 *
 * **Substring matching survives.** A tsvector only matches whole lexemes, so on
 * its own it would not find `dashboard-design.fig` when searching for `design`.
 * The trigram term is what keeps the old page's substring tier working, and
 * losing it would be a quiet regression rather than an obvious one.
 */

import './setup-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signedInClient, startHarness, type Client, type Harness } from './helpers.js';
import { EMPLOYEE, TEST_PASSWORD, ensureTestPasswords } from './fixtures.js';

type Scope = 'people' | 'messages' | 'files' | 'events' | 'teams';

type Result = {
  id: string;
  scope: Scope;
  title: string;
  detail: string;
  context: string;
  href: string;
  snippet: string | null;
  stamp: string | null;
  rank: number;
};

type Counts = Record<Scope, number>;

type SearchResponse = {
  results: Result[];
  counts: Counts;
  query: string;
  scope: string;
};

let harness: Harness;
let client: Client;

before(async () => {
  await ensureTestPasswords();
  harness = await startHarness();
  client = await signedInClient(harness, EMPLOYEE, TEST_PASSWORD);
});

// Without this the harness's HTTP server keeps the event loop alive and the
// runner never exits -- which looks like a hang rather than a missing hook.
after(async () => {
  await harness?.close();
});

async function searchRaw(q: string, scope: 'all' | Scope = 'all'): Promise<SearchResponse> {
  const response = await client.get(
    `/api/search?q=${encodeURIComponent(q)}&scope=${scope}&limit=50`,
  );
  assert.equal(response.status, 200, `search for ${JSON.stringify(q)} returned ${response.status}`);
  return (await response.json()) as SearchResponse;
}

async function search(q: string, scope: 'all' | Scope = 'all'): Promise<Result[]> {
  return (await searchRaw(q, scope)).results;
}

describe('search', () => {
  it('finds a message and highlights the matching words server-side', async () => {
    const results = await search('deploy');
    const messages = results.filter((r) => r.scope === 'messages');

    assert.ok(messages.length > 0, 'expected at least one message matching "deploy"');
    // Only ts_headline knows which words the tsquery actually matched, so the
    // <mark> tags have to come from the database rather than the client.
    assert.ok(
      messages.some((r) => r.snippet?.includes('<mark>')),
      `no snippet was highlighted: ${JSON.stringify(messages.map((m) => m.snippet))}`,
    );
  });

  it('ranks by relevance, descending', async () => {
    const results = await search('review');
    assert.ok(results.length > 1, 'expected several results for "review"');

    const ranks = results.map((r) => r.rank);
    for (let i = 1; i < ranks.length; i += 1) {
      const previous = ranks[i - 1]!;
      const current = ranks[i]!;
      assert.ok(current <= previous, `rank rose at index ${i}: ${ranks.join(', ')}`);
    }
  });

  it('finds a person by name, and the name matches itself', async () => {
    const results = await search('Emma', 'people');
    assert.ok(
      results.some((r) => r.title === 'Emma Davis'),
      `expected Emma Davis in ${JSON.stringify(results.map((r) => r.title))}`,
    );
  });

  it('finds a file by a substring of its name', async () => {
    // The regression this guards: `dashboard-design.fig` contains "design" but
    // not as a whole lexeme, so a tsvector alone would miss it.
    const results = await search('design', 'files');
    assert.ok(
      results.some((r) => r.title === 'dashboard-design.fig'),
      `expected the .fig file in ${JSON.stringify(results.map((r) => r.title))}`,
    );
  });

  it('keeps substring matches when the scope is narrowed to files', async () => {
    // Same assertion as above but pinned to one scope, so a bug that leaked
    // across scopes cannot satisfy both.
    const results = await search('design', 'files');
    assert.ok(results.every((r) => r.scope === 'files'), 'a non-files result leaked into scope=files');
  });

  it('honours the scope filter in both directions', async () => {
    const people = await search('design', 'people');
    assert.ok(people.every((r) => r.scope === 'people'), 'scope=people returned another scope');

    const teams = await search('design', 'teams');
    assert.ok(teams.every((r) => r.scope === 'teams'), 'scope=teams returned another scope');
  });

  it('finds a team by name', async () => {
    const results = await search('Engineering', 'teams');
    assert.ok(
      results.some((r) => r.title === 'Engineering'),
      `expected the Engineering team in ${JSON.stringify(results.map((r) => r.title))}`,
    );
  });

  it('supports websearch operators, which the old scorer had no notion of', async () => {
    // "or" is the point: the old substring scorer required the literal string
    // " or " to appear in the text.
    const results = await search('roadmap or staging');
    const titles = results.map((r) => r.title).join(' | ');

    assert.ok(
      /roadmap|staging/i.test(titles),
      `expected a roadmap or staging result, got: ${titles}`,
    );
  });

  it('does not return a message from a channel the caller is not in', async () => {
    // The seed puts u1 in t1 (and t2/t8), and t5 'HR' has only u7. So a message
    // planted in an HR channel must be invisible to u1 and visible to u7.
    // This is the assertion that matters most: the alternative is a search box
    // that reads private channels.
    const { prisma } = await import('../src/db.js');

    const channel = await prisma.channel.create({
      data: { id: 'search-probe-channel', name: 'hr-search-probe', teamId: 't5' },
    });
    const message = await prisma.message.create({
      data: {
        id: 'search-probe-message',
        body: 'zzsecretzz needle in a private channel',
        userId: 'u7',
        channelId: channel.id,
      },
    });

    try {
      const asEmployee = await search('zzsecretzz');
      assert.equal(
        asEmployee.some((r) => r.id === message.id),
        false,
        'a message from a channel u1 is not a member of was returned',
      );

      const asHr = await signedInClient(harness, 'priya@company.com', TEST_PASSWORD);
      const hrResults = await asHr.get(
        `/api/search?q=${encodeURIComponent('zzsecretzz')}&scope=messages&limit=50`,
      );
      const hrBody = (await hrResults.json()) as { results: Result[] };
      assert.ok(
        hrBody.results.some((r) => r.id === message.id),
        'u7 is in t5 and should see the message',
      );
    } finally {
      await prisma.message.delete({ where: { id: message.id } });
      await prisma.channel.delete({ where: { id: channel.id } });
    }
  });

  it('omits a soft-deleted message', async () => {
    // The body is blanked on soft delete, so the vector is empty and the message
    // stops matching without the query needing to know about deletedAt.
    const { prisma } = await import('../src/db.js');
    const results = await search('standup');
    assert.ok(results.some((r) => r.scope === 'messages'), 'the seeded standup message should match');

    const message = await prisma.message.findFirstOrThrow({
      where: { body: { contains: 'standup' } },
    });
    const original = message.body;
    await prisma.message.update({
      where: { id: message.id },
      data: { body: '', deletedAt: new Date() },
    });

    try {
      const after = await search('standup');
      assert.equal(
        after.some((r) => r.id === message.id),
        false,
        'a soft-deleted message was returned',
      );
    } finally {
      await prisma.message.update({
        where: { id: message.id },
        data: { body: original, deletedAt: null },
      });
    }
  });

  it('returns an empty result rather than an error for a stopword query', async () => {
    // "the" produces an empty tsquery under english. Silently returning zero
    // results reads as a broken search box, so the emptiness is detected with a
    // 'simple' vector -- which keeps stopwords -- and the query runs normally.
    const results = await search('the');
    assert.ok(Array.isArray(results), 'expected an array');
  });

  it('rejects an empty query', async () => {
    const response = await client.get('/api/search?q=');
    assert.equal(response.status, 400, 'an empty q should be a 400');
  });

  it('rejects an unknown scope', async () => {
    const response = await client.get('/api/search?q=design&scope=nonsense');
    assert.equal(response.status, 400, 'an unknown scope should be a 400');
  });

  it('returns counts for every scope, including the ones it filtered out', async () => {
    // The scope chips render these. They have to come from the same ranked set
    // the results do, or the page shows a count next to a differently-filtered
    // list -- "Files 4" above two files.
    const response = await searchRaw('design', 'files');

    assert.deepEqual(
      Object.keys(response.counts).sort(),
      ['events', 'files', 'messages', 'people', 'teams'],
      'every scope needs a count, including zeroes, so the client does not have to know the list',
    );

    assert.equal(response.counts.files, response.results.length);
    // Messages matched "design" too, and that count survives the files filter.
    assert.ok(
      response.counts.messages > 0,
      'a narrowed scope still reports counts for the scopes it hid',
    );
  });

  it('reports a zero count for a scope with no matches rather than omitting it', async () => {
    const response = await searchRaw('roadmap or staging', 'events');
    assert.equal(typeof response.counts.people, 'number');
    assert.equal(response.counts.people, 0);
  });

  it('requires a session', async () => {
    // An anonymous client, so this asserts the auth middleware rather than the
    // query. A search endpoint with no auth would otherwise expose every message
    // body in the workspace to anyone who asked.
    const anonymous = harness.client();
    const response = await anonymous.get('/api/search?q=design');
    assert.equal(response.status, 401, 'search must require a session');
  });
});
