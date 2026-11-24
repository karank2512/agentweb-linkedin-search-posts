import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeSearchPosts } from '../src/probe.js';
import { createLinkedinSearchPostsHandler, linkedinSearchPostsTool } from '../src/mcp-tool.js';
import { createClient } from '../src/client.js';
import { createMockServer } from '../demo/mock-server.js';
import { scriptedFetch } from './helpers.js';
import { FIXED_NOW } from './helpers.js';

const TODAY = { domain: 'linkedin.com', version: '0.7.2', actions: [{ name: 'list_profile_posts', params: { profile_id: { required: true }, count: {} } }, { name: 'get_profile', params: ['vanity_name'] }] };
const SEARCH = { name: 'search_posts', params: { keywords: { required: true }, sort: {}, date_posted: {}, count: {} } };
const NEXT = { name: 'search_posts_next', params: { keywords: { required: true }, sort: {}, date_posted: {}, pagination_token: { required: true }, count: {} } };

test('probe: a map without search_posts → unsupported', () => {
  assert.deepEqual(probeSearchPosts(TODAY), { status: 'unsupported', map_version: '0.7.2', problems: [] });
  assert.equal(probeSearchPosts(null).status, 'unsupported');
});

test('probe: matching params → supported (object params, array params, curated wrapper)', () => {
  assert.equal(probeSearchPosts({ ...TODAY, actions: [...TODAY.actions, SEARCH, NEXT] }).status, 'supported');
  const arr = { actions: [{ name: 'search_posts', params: ['keywords', 'sort', 'date_posted', 'count'] }, { name: 'search_posts_next', params: [{ name: 'keywords' }, { name: 'pagination_token' }] }] };
  assert.equal(probeSearchPosts(arr).status, 'supported');
  assert.equal(probeSearchPosts({ domain: 'linkedin.com', curated: { version: '9', actions: [SEARCH, NEXT] } }).map_version, '9');
});

test('probe: param mismatch or half the pair → incompatible, with reasons', () => {
  const noToken = { actions: [SEARCH, { name: 'search_posts_next', params: { keywords: {} } }] };
  const r = probeSearchPosts(noToken);
  assert.equal(r.status, 'incompatible');
  assert.match(r.problems.join(), /pagination_token/);
  assert.equal(probeSearchPosts({ actions: [SEARCH] }).status, 'incompatible');
  const extra = { actions: [{ ...SEARCH, params: { ...SEARCH.params, geo_urn: { required: true } } }, NEXT] };
  assert.match(probeSearchPosts(extra).problems.join(), /geo_urn/);
});

test('MCP tool definition: name, input_schema, readOnlyHint', () => {
  assert.equal(linkedinSearchPostsTool.name, 'linkedin_search_posts');
  assert.equal(linkedinSearchPostsTool.annotations.readOnlyHint, true);
  assert.deepEqual(linkedinSearchPostsTool.input_schema.required, ['keywords']);
  assert.match(linkedinSearchPostsTool.description, /PROPOSED/);
});

test('MCP handler: map without search_posts → UnsupportedActionError result, no execute call made', async () => {
  const f = scriptedFetch([]);
  const h = createLinkedinSearchPostsHandler({ client: createClient({ fetch: f }), map: TODAY });
  const r = await h({ keywords: 'hiring' });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.error.type, 'UnsupportedActionError');
  assert.equal(r.structuredContent.error.code, 'ACTION_NOT_FOUND');
  assert.equal(f.calls.length, 0);
});

test('MCP handler against the mock as it is today → UnsupportedActionError result', async () => {
  const m = createMockServer({ searchMissing: true });
  const baseUrl = await m.listen(0);
  try {
    const h = createLinkedinSearchPostsHandler({ client: createClient({ baseUrl, apiKey: 'aw_t', fetch }) });
    const r = await h({ keywords: 'hiring' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /UnsupportedActionError: linkedin\.com\/search_posts/);
  } finally { await m.close(); }
});

test('MCP handler against the mock with search_posts (mock) → ranked posts with explanations', async () => {
  const m = createMockServer({ now: () => FIXED_NOW });
  const baseUrl = await m.listen(0);
  try {
    const map = await (await fetch(`${baseUrl}/api/sites/linkedin.com`)).json();
    const h = createLinkedinSearchPostsHandler({ client: createClient({ baseUrl, apiKey: 'aw_t', fetch }), map, now: FIXED_NOW });
    const r = await h({ keywords: 'hiring', count: 5, max_pages: 2, only_likely_hiring: true });
    assert.equal(r.isError, undefined);
    assert.ok(r.structuredContent.posts.length > 0);
    assert.ok(r.structuredContent.posts.every((p) => p.hiring.label === 'likely_hiring' && p.hiring.why.length > 0));
    const bad = await h({ keywords: 'hiring', count: 1000 });
    assert.equal(bad.isError, true);
    assert.equal(bad.structuredContent.error.code, 'INVALID_PARAMS');
  } finally { await m.close(); }
});
