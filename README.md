This does not search LinkedIn. No live call was made.

# Proposed `search_posts` for AgentWeb's linkedin.com map

This project is an engineering proposal for adding keyword search of LinkedIn **posts** (aimed at hiring posts) to AgentWeb's linkedin.com action map. It is built against AgentWeb's documented `POST /api/execute` contract. It contains:

- **A proposed action contract.** `search_posts` / `search_posts_next` mirror the existing `list_profile_posts(_next)`, with flat params, a query-bound cursor and the proposed output row (`contract/`).
- **A black-box conformance kit.** 26 checks speak only `POST /api/execute`. Requirements that are this project's own proposals score *inconclusive*, not *fail*, on a real target (`conformance/`).
- **An execute client.** It parses the documented REST and MCP envelopes, has typed errors for the documented codes, sends a per-page `Idempotency-Key`, and keeps a receipt/trace ledger (`src/client.js`, `src/ledger.js`).
- **Safe pagination and normalisation.** It guards against loops, version drift and partial failure, and keeps a credit budget. Reposts are preserved, posts are deduped, and every permalink carries its source label (`src/`).
- **A deterministic, explainable hiring-intent scorer** with a synthetic evaluation set (`src/rank.js`, `eval/`).
- **A watchlist filter** built only from actions that exist today. It reads listed profiles; it is not search (`src/sources/watchlist.js`).
- **A local mock AgentWeb server and a terminal demo** (`demo/`), and 117 tests.

**The live gap, stated plainly.** AgentWeb's public linkedin.com map has no posts-search action today (47 actions, 24 Nov 2026), and this project has no live AgentWeb adapter. The content-search capture inside AgentWeb's executor is the piece still to be built. Given the executor or mapper interface, or a redacted example handler, it can be written to fit and checked with this kit. Everything here runs locally against the mock and synthetic data.

Plain ESM JavaScript with JSDoc. Zero dependencies, nothing to install. Node ≥ 22; developed on Node v25.6.0.

## Quick start

```sh
npm test                   # 117 unit and end-to-end tests
npm run demo               # terminal demo: mock with the proposed action → search, rank, ledger ([SYNTHETIC] output)
npm run demo:today         # mock as AgentWeb is today: ACTION_NOT_FOUND → watchlist filter
npm run conformance        # conformance kit against an in-process mock
npm run eval               # hiring-intent precision/recall on synthetic text
```

## Results (local mock, synthetic data)

On Node 25.6.0:
- **Tests:** `npm test` runs 117 tests; all pass.
- **Conformance, proposed action present:** `npm run conformance` passes 26 of 26 checks.
- **Conformance, action missing:** `node conformance/run.js --search-missing` blocks all 26 checks at `ACTION_NOT_FOUND`. This mock represents today's declared state; no live call verified it.
- **Fault injection:** `node conformance/run.js --mock-faults unboundCursor,loopingToken,duplicateRows` fails exactly the cursor, loop and duplicate checks (6 of 26).
- **Live guard:** a live or non-local target without every safeguard is refused before any request (exit 64).
- **Hiring-intent scorer** (`npm run eval`, synthetic text only):
  - all 158 posts: 96.6% precision, 81.2% recall;
  - 14 held-out posts: 85.7% precision, 85.7% recall.

  These figures are optimistic; see the limitations below.

## What runs and what does not

| Runs here (locally, synthetic data) | Does not run here |
|---|---|
| 117 unit and end-to-end tests (`node --test`) | Any call to AgentWeb (`mcp.agentweb.us`) or LinkedIn |
| Mock AgentWeb server speaking the documented REST and MCP envelopes | Real LinkedIn post search. This build has no live AgentWeb adapter, and AgentWeb's public linkedin.com map (47 actions, 24 Nov 2026) has no posts-search action. Keyword post search does exist elsewhere: LinkedIn's own Posts tab, and third-party APIs that document it. None of those is used here |
| Demo CLI in both states: the proposed action present (mock), and missing as it is today | The conformance kit's live mode (implemented, guarded, **never run**) |
| Conformance kit against the mock: correct, missing and deliberately faulty variants | Confirming any field name, parameter value, price or permalink format with AgentWeb |
| Hiring-intent evaluation on 158 synthetic posts | Any accuracy claim about real LinkedIn posts |

## Boundary

**AgentWeb-owned missing piece: the LinkedIn content-search adapter inside the executor, plus confirmation of the proposed map entry.**

| Layer | Owner | State in this build |
|---|---|---|
| LinkedIn content-search capture: session use, request and raw parse | AgentWeb (not public) | **Not built, and not guessed at.** No LinkedIn endpoint is touched. In the mock it is replaced by a synthetic corpus; `unavailableSource` stands in for the real one and fails with a message naming the gap |
| Proposed map entry `search_posts` / `search_posts_next` | Proposal for AgentWeb to confirm or change | `contract/search_posts.map-entry.json` and the validator `src/contract.js` |
| Behaviour expected of the executor: flat-param validation, a cursor bound to its query, termination, row shape, error envelopes | Proposal | `src/reference-handler.js` (runs inside the mock only) and the conformance kit `conformance/` |
| Execute client: REST + MCP envelopes, typed errors, Idempotency-Key, `fresh`/cached | This build | `src/client.js`. HTTP is injected |
| Trace ledger, safe pagination, budget guard | This build | `src/ledger.js`, `src/paginate.js` |
| Normalise to a typed Post, permalinks, reposts, dedupe | This build | `src/normalize.js` |
| Hiring-intent scorer (deterministic, explainable) | This build | `src/rank.js`, evaluated in `eval/` |
| Watchlist filter over EXISTING `list_profile_posts(_next)` | This build | `src/sources/watchlist.js`. Coverage `"watchlist"`; it is not search |
| Capability probe; MCP tool **definition and handler** `linkedin_search_posts` | This build | `src/probe.js`, `src/mcp-tool.js`. This is not an MCP server: there is no transport or runtime. An MCP host (such as AgentWeb's) would register the definition and call the handler. Today the handler returns an unsupported result |

## How to run

```sh
node --test "test/*.test.js"          # all tests (npm test does the same)
node demo/cli.js                      # mock with the proposed action: search → rank → ledger
node demo/cli.js --search-missing     # mock as AgentWeb is today: ACTION_NOT_FOUND → watchlist filter
node conformance/run.js               # conformance kit against an in-process mock (default)
node conformance/run.js --search-missing
node conformance/run.js --mock-faults unboundCursor,loopingToken,duplicateRows   # shows the kit catching faults
node eval/run.js                      # precision / recall / confusion table, synthetic text only
node demo/mock-server.js --port 8787  # standalone mock; then: node conformance/run.js --base-url http://127.0.0.1:8787
```

Every demo output line starts with `[SYNTHETIC]`. Fixtures carry `"synthetic": true`.

**Conformance live mode (never run).** It needs all of the following:
- `--live`;
- an explicit `--base-url` that is `https://mcp.agentweb.us` (`https:` is mandatory; any other host also needs `--allow-nonstandard-live-host`);
- `--i-accept-live-calls-and-charges`;
- `AGENTWEB_API_KEY` in the environment.

Without `--live`, any non-local `--base-url` is refused before a request is sent. Live mode would make billed calls on the key owner's connected LinkedIn account. Until AgentWeb ships the action it would only report `A0 blocked` (one request).

**What a live run would cost (estimate).** With the live page cap of 4 (`--max-pages` changes it), a full run makes **25 requests**, of which about **11–13** would be newly billed: on a strict adapter 12 succeed, 1 of them an idempotent replay. That assumes rejected calls are free, as documented, and the documented "~1 credit per completed action". A lenient adapter that accepts the two proposed-strictness probes (P2, P9) would bill about 13. The count was measured against the mock. The real charge per search page is unconfirmed, and no live run has been approved.

**Live-target scoring.** Some requirements are this kit's own proposal (an unknown param rejected, a `query` echo, `pagination_token` rejected on `search_posts`). For these, a 200 from a real adapter scores **inconclusive**, not fail. Two other cases also score inconclusive on a live target:
- pages that overlap on a moving feed;
- reaching the page cap with a fresh token.

An account or access condition on the first call (401, 429, `AUTH_REQUIRED`, `INSUFFICIENT_CREDITS` and similar) is reported as **blocked**.

## The proposed contract, in short

`search_posts`: `keywords` (required, passed through unchanged), `sort` (`relevance` | `latest`), `date_posted` (`any` | `past_24h` | `past_week` | `past_month`) and `count` (1–100, default 10).

`search_posts_next`: the same params plus `pagination_token`. The token must come from the same keywords, sort and date_posted, or the call is `INVALID_PARAMS`.

All params are flat scalars, as `ExecuteRequest` requires.

Output: `{query, posts, next_token}`.
- Rows mirror `list_profile_posts`. Its fields, as listed publicly on 24 Nov 2026, are text, age, reactions, comments, reposts, author, author_headline, author_url, header, activity_urn, thread_urn, thread_id, reshared_author and reshared_text.
- Rows add `permalink`, `posted_at_approx` and `permalink_source` (requested optional).
- `reshared_activity_urn` is requested as optional.
- The enum values and `query` echo are our proposal. The real values depend on what LinkedIn's Posts tab offers.

## Design notes

- **Envelopes.** The client parses every shape below:
  - the OpenAPI REST success (`ok`, `result`, `credits_charged`/`charged`, `charge_unit`, `balance_remaining` which may be null, `support_id`);
  - the prose-doc REST success with a `billing` block;
  - the REST failure (`ok:false`, `error`, `trace_id`, `support_id`);
  - the MCP envelope (`success`, `data`, `map_version`, `billing`, `trace_id`);
  - the plain `{error:"…"}` body documented for 401, 403 and 429.

  Credits are only what the server reports; a missing charge stays `null`.
- **Errors.**
  - Every code in the documented table has a typed class. So do `USAGE_CAP_EXCEEDED`, `PARAM_UNRESOLVED`, `PAGE_CHANGED` and the delegation codes, which are documented elsewhere in the same docs.
  - Unknown codes become `AgentWebError`.
  - `ACTION_NOT_FOUND` becomes `UnsupportedActionError` naming `linkedin.com/search_posts`.
  - `error.auth`, `error.credits` and `error.delegation` are kept.
  - `Retry-After` is copied only when the server sends it.
- **Idempotency.** There is one `Idempotency-Key` per page (`<walkId>:<action>:p<n>`), and a retry of the same page reuses it. Reusing a key with a different body throws before any request. The MCP `execute` tool schema has no idempotency or `fresh` field, so on that lane the client warns instead.
- **Client safety.** The client refuses any non-loopback `baseUrl`, including `https://mcp.agentweb.us`, unless `allowLive: true` is passed. With no `baseUrl` it targets an inert `http://localhost`.
- **MCP tool (definition plus handler only).** There is no MCP server or transport in this build. `max_pages` is clamped to 1–10 in the handler, and the credit budget defaults to that page count. The description says each page is *expected* to bill as one action, which is an estimate: per-page billing is unconfirmed. There is no `idempotentHint`, because repeat calls can bill again. This wraps the proposed action; it is not a native AgentWeb feature.
- **Pagination guards.** The walk is stopped and flagged on any of these:
  - max pages reached;
  - a repeated token (loop);
  - consecutive empty pages that still carry a token;
  - a credit budget, using the documented "~1 credit per completed action" only as an estimate when a charge is unreported;
  - a `Retry-After` longer than `maxRetryWaitMs` (default 30 s), which is not waited out;
  - a next page that cannot be built from the server's token. The rows already fetched and paid for are kept.

  A map_version change mid-walk is flagged, and optionally stops the walk. Failure on page N returns the rows so far, the ledger and the error.
- **Normalisation.**
  - **Permalink:** the share URL with tracking parameters removed. Failing that, it is built from the activity URN (`/feed/update/<urn>/`) and flagged `permalink_constructed`, because that format is not confirmed.
  - **Permalink source:** the proposed row also carries `permalink_source` (`share_url` | `constructed_from_urn`), so a constructed link stays labelled end to end. In the demo most links are constructed, and each is printed with "(constructed from URN, format unconfirmed)".
  - **Age:** relative age becomes an approximate timestamp, flagged `approximate` with its granularity.
  - **Reposts:** both the repost and the original are kept and linked. A missing original is flagged.
- **Dedupe.**
  - Identical URNs, or identical non-constructed share URLs, are kept once.
  - Different URN types on the same thread are flagged, not merged, because that mapping is not public.
  - Rows without a URN are kept and flagged.
- **Scorer.** It uses fixed patterns with weights and returns an explanation for every score. Hard negatives cover job seekers ("open to work", "looking for a job", laid off, "who's hiring?"). Soft negatives cover bait, agency volume, new-job announcements, commentary and filled roles. There are no industry, location or seniority terms; a test checks this.

## Known limitations

- The real LinkedIn content-search behaviour is unknown. That covers:
  - whether Boolean operators and quotes are honoured;
  - the actual sort and date values;
  - result ordering;
  - duplicates across pages;
  - the stable permalink format.
- The mock's "search" is a local keyword filter over synthetic rows. It shows the proposed contract, not LinkedIn's behaviour.
- The nesting of `list_profile_posts` output (a top-level `next_token` or one per row) is not public. The client accepts both, and the mock uses per-row tokens as an assumption.
- The scorer evaluation is on synthetic text written by the same author as the scorer, so it is optimistic.
  - **Held-out:** 14 posts, scoring 85.7% precision and 85.7% recall.
  - **Known misses:** agency posts with strong hiring phrasing can still score `likely_hiring`, and implicit hiring ("our bakery needs a baker") is often missed.
- The watchlist filter only sees posts by profiles you already list. It cannot discover new authors.
- Cost figures are estimates from the docs' "~1 credit per completed action". Whether one search page would bill as one action is unconfirmed.
- The saved OpenAPI copy is truncated before the `ExecuteResult` schema, so `notes` is read from `result.notes` or the top level, as either a string or an array.

## Smallest input needed from AgentWeb

The aim is to scope a contribution: I would build the content-search capture behind `search_posts` myself, given enough of the executor interface to do it properly. What I need:

1. **The executor or mapper interface**, or a redacted example of an existing LinkedIn action handler (for example `list_profile_posts`). That means:
   - how a step receives the connected session;
   - how it issues requests and returns rows and next tokens;
   - how errors map to the documented codes.

   A test harness or fixture format for existing actions would do as well. With that, the capture can be written to fit, and this conformance kit run against it.
2. **Confirm or correct the proposed map entry:**
   - param names and enum values;
   - whether `next_token` is bound to its query;
   - row fields, including a share URL or permalink and the original URN for reposts;
   - whether one page bills as one completed action.
3. **Agree how it would land:** code review or a sandbox account. Then run `node conformance/run.js --live …` against one connected test account, with its owner's go-ahead. That would cost about 25 requests and about 11–13 billed actions (estimate; the actual price is unconfirmed, and no run is approved). It is the first point at which anything could be said to run live.

## Sources

These are the public AgentWeb pages the contract was taken from, as observed on 24 Nov 2026. Working copies are not included. All were read as data, and no AgentWeb internals were assumed.

- **REST API docs** (execute, envelopes, error codes, Idempotency-Key): https://docs.agentweb.us/rest-api
- **OpenAPI** (`ExecuteRequest`, `ExecuteResponse`, public `GET /api/sites/{map_key}`): https://www.agentweb.us/openapi.json
- **MCP tool manifest** (`execute`, `read_page`, `request_map`): https://www.agentweb.us/.well-known/mcp/tools.json
- **LinkedIn catalog page** (map 0.7.1, 47 actions, as of 20 Oct 2026): https://www.agentweb.us/sites/linkedin.com
- **Public LinkedIn map listing** (0.7.2, 47 actions, no posts search, as reported on 24 Nov 2026): https://mcp.agentweb.us/api/sites/linkedin.com
- **Public MCP docs repository:** https://github.com/agentweb-labs/agentweb-mcp

Pages change, so re-check them before relying on any detail.

## License

No open-source license has been chosen yet. Until the owner picks one, all rights are reserved (`package.json` says `UNLICENSED`). All code, tests and synthetic data here were written for this project. They contain no third-party code, and no real LinkedIn or AgentWeb data.
