import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_ENTRY, queryFingerprint, validateSearchParams } from '../src/contract.js';
import { InvalidParamsError } from '../src/errors.js';

const v = (p, a = 'search_posts') => validateSearchParams(a, p);
const invalid = (fn, re) => assert.throws(fn, (e) => e instanceof InvalidParamsError && e.code === 'INVALID_PARAMS' && (!re || re.test(e.message)));

test('map entry is labelled PROPOSED and covers both actions', () => {
  assert.match(MAP_ENTRY._status, /PROPOSED/);
  assert.deepEqual(MAP_ENTRY.actions.map((a) => a.name), ['search_posts', 'search_posts_next']);
  for (const a of MAP_ENTRY.actions) for (const s of Object.values(a.params)) assert.ok(['string', 'number', 'boolean'].includes(s.type), 'flat scalar params only');
});

test('row fields mirror list_profile_posts plus permalink and posted_at_approx', () => {
  const mirrored = ['text', 'age', 'reactions', 'comments', 'reposts', 'author', 'author_headline', 'author_url', 'header', 'activity_urn', 'thread_urn', 'thread_id', 'reshared_author', 'reshared_text'];
  const fields = Object.keys(MAP_ENTRY.row.fields);
  for (const f of mirrored) assert.ok(fields.includes(f), f);
  assert.ok(fields.includes('permalink') && fields.includes('posted_at_approx'));
});

test('keywords are required; whitespace-only rejected', () => {
  invalid(() => v({}), /keywords/);
  invalid(() => v({ keywords: '   ' }));
  invalid(() => v({ keywords: 42 }));
});

test('defaults are filled', () => {
  assert.deepEqual(v({ keywords: 'x' }), { keywords: 'x', sort: 'relevance', date_posted: 'any', count: 10 });
});

test('keywords pass through unchanged: quotes, Boolean operators, unicode, surrounding spaces', () => {
  for (const k of ['"hiring" AND ("product designer" OR designer) NOT intern', '  leading and trailing  ', 'café 採用 ünïcode 👩‍💻', '#hiring -recruiter']) {
    assert.equal(v({ keywords: k }).keywords, k);
  }
});

test('flat scalar params only', () => {
  invalid(() => v({ keywords: 'x', sort: ['latest'] }), /flat/);
  invalid(() => v({ keywords: { q: 'x' } }), /flat/);
  invalid(() => v(null));
  invalid(() => v(['x']));
});

test('unknown params rejected with INVALID_PARAMS', () => invalid(() => v({ keywords: 'x', location: 'US' }), /unknown param "location"/));

test('enum values for sort and date_posted', () => {
  assert.equal(v({ keywords: 'x', sort: 'latest', date_posted: 'past_week' }).sort, 'latest');
  invalid(() => v({ keywords: 'x', sort: 'newest' }));
  invalid(() => v({ keywords: 'x', date_posted: 'past_year' }));
  invalid(() => v({ keywords: 'x', sort: 'LATEST' }));
});

test('count bounds, string coercion, integers only', () => {
  assert.equal(v({ keywords: 'x', count: '25' }).count, 25);
  assert.equal(v({ keywords: 'x', count: 100 }).count, 100);
  assert.equal(v({ keywords: 'x', count: 1 }).count, 1);
  invalid(() => v({ keywords: 'x', count: 101 }), /<= 100/);
  invalid(() => v({ keywords: 'x', count: '101' }), /<= 100/);
  invalid(() => v({ keywords: 'x', count: 0 }));
  invalid(() => v({ keywords: 'x', count: 2.5 }), /integer/);
  invalid(() => v({ keywords: 'x', count: 'ten' }), /numeric/);
  invalid(() => v({ keywords: 'x', count: true }));
});

test('search_posts_next requires pagination_token; search_posts rejects it', () => {
  invalid(() => v({ keywords: 'x' }, 'search_posts_next'), /pagination_token/);
  assert.equal(v({ keywords: 'x', pagination_token: 'abc' }, 'search_posts_next').pagination_token, 'abc');
  invalid(() => v({ keywords: 'x', pagination_token: 'abc' }), /unknown param/);
});

test('query fingerprint binds keywords/sort/date_posted but not count', () => {
  const a = queryFingerprint(v({ keywords: 'x', count: 5 }));
  assert.equal(a, queryFingerprint(v({ keywords: 'x', count: 50 })));
  assert.notEqual(a, queryFingerprint(v({ keywords: 'x ' })));
  assert.notEqual(a, queryFingerprint(v({ keywords: 'x', sort: 'latest' })));
  assert.notEqual(a, queryFingerprint(v({ keywords: 'x', date_posted: 'past_24h' })));
});
