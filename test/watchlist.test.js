import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileKeywordFilter, estimateCost, watchlistFilter } from '../src/sources/watchlist.js';
import { createClient } from '../src/client.js';
import { TraceLedger } from '../src/ledger.js';
import { createMockServer } from '../demo/mock-server.js';
import { FIXED_NOW } from './helpers.js';

const IDS = ['ACoAASYNTH0001', 'ACoAASYNTH0002', 'ACoAASYNTH0003'];

async function withMock(opts, fn) {
  const m = createMockServer({ searchMissing: true, now: () => FIXED_NOW, ...opts });
  const baseUrl = await m.listen(0);
  const ledger = new TraceLedger();
  try { return await fn(createClient({ baseUrl, apiKey: 'aw_t', fetch, ledger }), ledger, m); } finally { await m.close(); }
}

test('keyword filter: AND by default, quoted phrases, OR groups, NOT and -term exclusions, case-insensitive', () => {
  const f = compileKeywordFilter('"we are hiring" nurse OR midwife -agency NOT recruiter');
  assert.equal(f('We are hiring a NURSE'), true);
  assert.equal(f('hiring a nurse'), false);
  assert.equal(f('Midwife wanted'), true);
  assert.equal(f('midwife via agency'), false);
  assert.equal(f('midwife, contact recruiter'), false);
  assert.equal(compileKeywordFilter('')('anything'), true);
});

test('composes the EXISTING actions list_profile_posts(_next) only; coverage is "watchlist", never search', async () => {
  await withMock({}, async (client, ledger) => {
    const r = await watchlistFilter({ client, profileIds: IDS, keywords: 'hiring', count: 3, pagesPerProfile: 2, now: FIXED_NOW, walkId: 'wl' });
    assert.equal(r.coverage, 'watchlist');
    assert.equal(r.not_search, true);
    assert.notEqual(r.coverage, 'global');
    assert.match(r.coverage_note, /cannot appear/);
    const actions = new Set(ledger.entries.map((e) => e.action));
    assert.deepEqual([...actions].sort(), ['list_profile_posts', 'list_profile_posts_next']);
    assert.ok(r.posts.every((p) => /hiring/i.test(`${p.text} ${p.repost?.original.text ?? ''}`)));
    assert.equal(r.duplicates_removed, 1); // synthetic fixture repeats one URN
    assert.ok(r.posts.some((p) => p.flags.includes('no_urn')));
    assert.ok(r.ranked[0].label === 'likely_hiring');
  });
});

test('cost estimate is labelled as an estimate from the docs', () => {
  const c = estimateCost({ profiles: 20, pagesPerProfile: 2, searchPages: 3 });
  assert.equal(c.watchlist_max_credits, 40);
  assert.equal(c.proposed_search_credits, 3);
  assert.match(c.label, /estimate/);
  assert.match(c.assumption_search, /unconfirmed/);
});

test('rejects profile ids that are not ACoAA-form', async () => {
  await assert.rejects(watchlistFilter({ client: {}, profileIds: ['john-smith'], keywords: 'x' }), /ACoAA/);
});

test('INSUFFICIENT_CREDITS mid-fallback: stops, keeps partial results, lists profiles not reached', async () => {
  await withMock({ startingBalance: 2 }, async (client) => {
    const r = await watchlistFilter({ client, profileIds: IDS, keywords: 'hiring', count: 3, pagesPerProfile: 2, now: FIXED_NOW });
    assert.equal(r.stopped_early, 'INSUFFICIENT_CREDITS');
    assert.equal(r.per_profile.length, 2);
    assert.equal(r.per_profile[1].error.code, 'INSUFFICIENT_CREDITS');
    assert.deepEqual(r.profiles_not_reached, ['ACoAASYNTH0003']);
    assert.ok(r.scanned > 0);
  });
});

test('client-side credit budget across the whole watchlist', async () => {
  await withMock({}, async (client, ledger) => {
    const r = await watchlistFilter({ client, profileIds: IDS, keywords: 'hiring', count: 3, pagesPerProfile: 2, maxCredits: 3 });
    assert.equal(r.stopped_early, 'budget');
    assert.equal(ledger.entries.length, 3);
  });
});
