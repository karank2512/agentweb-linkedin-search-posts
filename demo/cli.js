#!/usr/bin/env node
// Demo CLI. Runs the proposed flow against the LOCAL MOCK only and prints results plus the trace ledger.
// Every output line is prefixed [SYNTHETIC]. Nothing here contacts LinkedIn or AgentWeb.
//
//   node demo/cli.js                    mock has the proposed search_posts → search, rank, ledger
//   node demo/cli.js --search-missing   mock matches today: search_posts → ACTION_NOT_FOUND → watchlist filter fallback

import { pathToFileURL } from 'node:url';
import { createMockServer } from './mock-server.js';
import { createClient } from '../src/client.js';
import { TraceLedger } from '../src/ledger.js';
import { probeSearchPosts } from '../src/probe.js';
import { searchPosts } from '../src/search.js';
import { watchlistFilter } from '../src/sources/watchlist.js';
import { UnsupportedActionError } from '../src/errors.js';
import { explain } from '../src/rank.js';

export const DEMO_NOW = new Date('2026-11-24T00:00:00.000Z');
export const DEMO_QUERY = { keywords: 'hiring', sort: 'latest', date_posted: 'past_month', count: 5 };
export const DEMO_WATCHLIST = ['ACoAASYNTH0001', 'ACoAASYNTH0002', 'ACoAASYNTH0003'];

/**
 * @param {{searchMissing?: boolean, billingStyle?: 'top'|'block'}} o
 * @returns {Promise<{summary: object, lines: string[]}>}
 */
export async function runDemo(o = {}) {
  const mock = createMockServer({ searchMissing: Boolean(o.searchMissing), billingStyle: o.billingStyle ?? 'top', now: () => DEMO_NOW });
  const baseUrl = await mock.listen(0);
  const lines = [];
  const say = (s = '') => lines.push(`[SYNTHETIC] ${s}`);
  const ledger = new TraceLedger();
  const client = createClient({ baseUrl, apiKey: 'aw_mock_key_not_real', fetch: globalThis.fetch, ledger });
  const summary = { synthetic: true, mode: o.searchMissing ? 'search_missing (as today)' : 'search_present (mock)' };
  try {
    say(`Local mock at ${baseUrl}. Synthetic fixtures only. No LinkedIn or AgentWeb call is made.`);
    const map = await (await fetch(`${baseUrl}/api/sites/linkedin.com`)).json();
    const probe = probeSearchPosts(map);
    summary.probe = probe;
    say(`Probe of mock map ${probe.map_version}: search_posts is ${probe.status.toUpperCase()}`);
    say('');

    const search = await searchPosts({ client, params: DEMO_QUERY, maxPages: 5, maxCredits: 10, now: DEMO_NOW, walkId: 'demo-search' });
    if (search.error instanceof UnsupportedActionError) {
      summary.search = { error: search.error.code, type: search.error.name, trace_id: search.error.traceId, support_id: search.error.supportId };
      say(`search_posts → ${search.error.name} (${search.error.code}), trace ${search.error.traceId}, receipt ${search.error.supportId}, credits ${search.error.billing?.credits ?? 'n/r'}`);
      say('Falling back to the WATCHLIST FILTER (existing list_profile_posts(_next); this is not search).');
      say('');
      const wl = await watchlistFilter({ client, profileIds: DEMO_WATCHLIST, keywords: 'hiring', count: 3, pagesPerProfile: 2, maxCredits: 10, now: DEMO_NOW, walkId: 'demo-watchlist' });
      summary.watchlist = {
        coverage: wl.coverage, not_search: wl.not_search, scanned: wl.scanned, matched: wl.posts.length, duplicates_removed: wl.duplicates_removed,
        per_profile: wl.per_profile, cost_estimate: wl.cost_estimate,
        ranked: wl.ranked.map((r) => ({ urn: r.post.urn, author: r.post.author.name, score: r.score, label: r.label, flags: r.post.flags })),
      };
      say(`coverage: ${wl.coverage}. ${wl.coverage_note}`);
      say(`scanned ${wl.scanned} posts, ${wl.posts.length} matched "hiring", ${wl.duplicates_removed} duplicate(s) removed`);
      for (const r of wl.ranked) say(`  ${String(r.score).padStart(5)}  ${r.label.padEnd(13)} ${r.post.author.name ?? '(no author)'}: ${r.post.text.slice(0, 70)}${r.post.flags.length ? `  [${r.post.flags.join(',')}]` : ''}`);
      say(`cost: up to ${wl.cost_estimate.watchlist_max_credits} credits for this watchlist (${wl.cost_estimate.label})`);
    } else {
      summary.search = {
        query: search.query, complete: search.complete, stopReason: search.stopReason, pages: search.pages.map((p) => ({ page: p.page, action: p.action, rows: p.rows, hasNext: p.nextToken !== null })),
        duplicates_removed: search.duplicates_removed, warnings: search.warnings,
        ranked: search.ranked.map((r) => ({ urn: r.post.urn, author: r.post.author.name, permalink: r.post.permalink, permalink_constructed: r.post.permalink_constructed, posted_at: r.post.posted_at?.iso ?? null, score: r.score, label: r.label, why: explain(r), flags: r.post.flags, repost_of: r.post.repost ? (r.post.repost.original.urn ?? (r.post.repost.original.missing ? 'missing' : 'unknown')) : null })),
      };
      say(`search_posts (MOCK) keywords=${JSON.stringify(search.query.keywords)} sort=${search.query.sort} date_posted=${search.query.date_posted} count=${search.query.count}`);
      say(`pages: ${search.pages.length}, stop: ${search.stopReason}, posts: ${search.posts.length}, duplicates removed: ${search.duplicates_removed}`);
      say('Ranked by deterministic hiring-intent score (synthetic text):');
      for (const r of search.ranked) {
        say(`  ${String(r.score).padStart(5)}  ${r.label.padEnd(13)} ${r.post.author.name}: ${r.post.text.slice(0, 70) || '(no text)'}`);
        say(`         why: ${explain(r)}`);
        say(`         link: ${r.post.permalink}${r.post.permalink_constructed ? ' (constructed from URN, format unconfirmed)' : ''}; posted ≈ ${r.post.posted_at?.iso ?? 'unknown'} (approximate)${r.post.flags.length ? `; flags: ${r.post.flags.join(',')}` : ''}`);
      }
    }
    say('');
    say('Trace ledger (one line per execute call; values as reported by the mock):');
    for (const l of ledger.toLines()) say(`  ${l}`);
    const t = ledger.totals();
    summary.ledger = { totals: t, entries: ledger.entries.map(({ meta, ...e }) => e) };
    say(`totals: ${t.calls} calls, ${t.ok} ok, ${t.failed} failed, ${t.credits_reported} credit(s) reported by the mock, receipts: ${t.receipt_ids.length}`);
    return { summary, lines };
  } finally {
    await mock.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { lines } = await runDemo({ searchMissing: process.argv.includes('--search-missing'), billingStyle: process.argv.includes('--billing-block') ? 'block' : 'top' });
  console.log(lines.join('\n'));
}
