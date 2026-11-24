#!/usr/bin/env node
// Conformance kit runner for the PROPOSED linkedin.com search_posts(_next).
//
// Default target: the LOCAL MOCK (started in-process, synthetic data). No flags needed.
//   node conformance/run.js
//   node conformance/run.js --search-missing                      mock as AgentWeb is today → A0 blocked
//   node conformance/run.js --mock-faults unboundCursor,loopingToken,duplicateRows   prove the kit catches faults
//   node conformance/run.js --base-url http://127.0.0.1:8787      a mock you started yourself
//
// LIVE MODE — NEVER RUN in this build; documented here only. It would make real, billed calls on the
// connected LinkedIn account of whoever owns the key. It requires ALL of:
//   --live --base-url https://mcp.agentweb.us --i-accept-live-calls-and-charges  and env AGENTWEB_API_KEY
// (https only; any other host also needs --allow-nonstandard-live-host). --max-pages N caps the walk (default 4).
// Even then it exits early with A0 "blocked" until AgentWeb ships search_posts.

import { pathToFileURL } from 'node:url';
import { runConformance } from './checks.js';
import { createMockServer } from '../demo/mock-server.js';

export function parseArgs(argv) {
  const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    live: argv.includes('--live'),
    acceptLive: argv.includes('--i-accept-live-calls-and-charges'),
    baseUrl: get('--base-url'),
    keywords: get('--keywords'),
    searchMissing: argv.includes('--search-missing'),
    faults: (get('--mock-faults') ?? '').split(',').filter(Boolean),
    json: argv.includes('--json'),
    maxPages: get('--max-pages') !== undefined ? Number(get('--max-pages')) : undefined,
    allowNonstandardLiveHost: argv.includes('--allow-nonstandard-live-host'),
  };
}

/** Decide the target. Throws if live mode is requested without every safeguard. */
export function resolveTarget(a, env) {
  if (a.maxPages !== undefined && !(Number.isInteger(a.maxPages) && a.maxPages >= 2 && a.maxPages <= 50)) throw new Error('--max-pages must be an integer from 2 to 50');
  if (a.live) {
    if (!a.baseUrl) throw new Error('live mode needs an explicit --base-url');
    if (!a.acceptLive) throw new Error('live mode needs --i-accept-live-calls-and-charges');
    if (!env.AGENTWEB_API_KEY) throw new Error('live mode needs env AGENTWEB_API_KEY');
    let u;
    try { u = new URL(a.baseUrl); } catch { throw new Error('live mode needs a valid --base-url'); }
    if (u.protocol !== 'https:') throw new Error('live mode refuses a non-https --base-url (the key would travel in clear text)');
    if (u.hostname !== 'mcp.agentweb.us' && !a.allowNonstandardLiveHost) throw new Error('live mode only targets https://mcp.agentweb.us unless --allow-nonstandard-live-host is also given');
    return { kind: 'live', baseUrl: a.baseUrl, apiKey: env.AGENTWEB_API_KEY };
  }
  if (a.baseUrl && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(a.baseUrl)) {
    throw new Error('without --live, --base-url must be a local mock (http://127.0.0.1:<port> or http://localhost:<port>)');
  }
  return { kind: a.baseUrl ? 'local-url' : 'in-process-mock', baseUrl: a.baseUrl, apiKey: 'aw_mock_key_not_real' };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  let target;
  try { target = resolveTarget(a, process.env); } catch (e) { console.error(`refused: ${e.message}`); process.exit(64); }
  let mock = null;
  if (target.kind === 'in-process-mock') {
    mock = createMockServer({ searchMissing: a.searchMissing, faults: Object.fromEntries(a.faults.map((f) => [f, true])) });
    target.baseUrl = await mock.listen(0);
  }
  const label = target.kind === 'live' ? 'LIVE' : `[SYNTHETIC] MOCK${a.searchMissing ? ' (search_posts missing, as today)' : ''}${a.faults.length ? ` with faults: ${a.faults.join(',')}` : ''}`;
  try {
    const out = await runConformance({ baseUrl: target.baseUrl, apiKey: target.apiKey, fetch: globalThis.fetch, keywords: a.keywords, maxPages: a.maxPages, live: target.kind === 'live' });
    if (a.json) console.log(JSON.stringify({ target: label, ...out }, null, 2));
    else {
      console.log(`Conformance: linkedin.com search_posts(_next) (PROPOSED) against ${label} at ${target.baseUrl}`);
      for (const r of out.results) console.log(`${r.status.toUpperCase().padEnd(12)} ${r.id.padEnd(3)} ${r.requirement}${r.detail ? `  — ${r.detail}` : ''}`);
      const t = out.totals;
      console.log(`TOTAL ${t.total}: ${t.pass} pass, ${t.fail} fail, ${t.blocked} blocked, ${t.inconclusive} inconclusive`);
    }
    process.exitCode = out.totals.fail ? 1 : out.totals.blocked ? 3 : 0;
  } finally {
    if (mock) await mock.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
