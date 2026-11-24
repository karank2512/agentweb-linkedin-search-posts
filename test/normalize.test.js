import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxPostedAt, dedupePosts, normalizeRow, parseUrn, stripTracking } from '../src/normalize.js';
import { FIXED_NOW, row } from './helpers.js';

const N = (r) => normalizeRow(r, { now: FIXED_NOW });

test('tracking params and fragments are stripped from share URLs; other params kept; http → https', () => {
  assert.equal(
    stripTracking('http://www.linkedin.com/posts/x_activity-1-AbCd/?utm_source=share&utm_medium=member&trk=a&trackingId=b&lipi=c&rcm=d&keep=1#comments'),
    'https://www.linkedin.com/posts/x_activity-1-AbCd/?keep=1',
  );
  assert.equal(stripTracking('not a url'), null);
  assert.equal(stripTracking('javascript:alert(1)'), null);
});

test('permalink: share URL preferred (stripped), else constructed from the URN and flagged', () => {
  const shared = N(row(1, { extra: { share_url: 'https://www.linkedin.com/posts/a_b-activity-1-x?utm_source=share' } }));
  assert.equal(shared.permalink, 'https://www.linkedin.com/posts/a_b-activity-1-x');
  assert.equal(shared.permalink_constructed, false);
  const built = N(row(2));
  assert.equal(built.permalink, 'https://www.linkedin.com/feed/update/urn:li:activity:2/');
  assert.equal(built.permalink_constructed, true);
  assert.ok(built.flags.includes('permalink_constructed'));
});

test('a non-LinkedIn share URL is rejected in favour of the URN', () => {
  const p = N(row(3, { extra: { share_url: 'https://evil.example/phish' } }));
  assert.ok(p.flags.includes('share_url_rejected'));
  assert.equal(p.permalink_source, 'constructed_from_urn');
});

test('relative age → approximate timestamp, flagged approximate with granularity', () => {
  const cases = { '3h': '2026-11-23T21:00:00.000Z', '2d': '2026-11-22T00:00:00.000Z', '1w': '2026-11-17T00:00:00.000Z', '45m': '2026-11-23T23:15:00.000Z', '2 days ago': '2026-11-22T00:00:00.000Z', 'Edited • 3d': '2026-11-21T00:00:00.000Z', '1mo': '2026-10-25T00:00:00.000Z', '1yr': '2025-11-24T00:00:00.000Z', now: FIXED_NOW.toISOString() };
  for (const [age, iso] of Object.entries(cases)) {
    const r = approxPostedAt(age, FIXED_NOW);
    assert.equal(r.iso, iso, age);
    assert.equal(r.approximate, true);
  }
  assert.equal(approxPostedAt('3d', FIXED_NOW).granularity, 'day');
  assert.equal(approxPostedAt('yesterday-ish', FIXED_NOW), null);
  assert.ok(N(row(4, { age: 'sometime' })).flags.includes('age_unparsed'));
});

test('missing optional fields are tolerated', () => {
  const p = N({ activity_urn: 'urn:li:activity:5', text: 'hi' });
  assert.equal(p.author.name, null);
  assert.deepEqual(p.engagement, { reactions: null, comments: null, reposts: null });
  assert.equal(p.posted_at, null);
  assert.equal(p.repost, null);
  assert.equal(p.synthetic, false);
});

test('engagement counts given as strings with separators are parsed', () => {
  const p = N({ ...row(6), reactions: '1,234', comments: '7', reposts: 'many' });
  assert.deepEqual(p.engagement, { reactions: 1234, comments: 7, reposts: null });
});

test('repost: reposter commentary, original author/text/URN preserved', () => {
  const p = N(row(7, { text: 'Great team!', reshared_author: 'Orig', reshared_text: 'We are hiring', header: 'X reposted this', extra: { reshared_activity_urn: 'urn:li:activity:8' } }));
  assert.deepEqual(p.repost, { reposter: 'Author 7', commentary: 'Great team!', original: { author: 'Orig', text: 'We are hiring', urn: 'urn:li:activity:8', missing: false } });
});

test('repost whose original is missing is kept and flagged', () => {
  const p = N(row(9, { text: '', header: 'Someone reposted this' }));
  assert.equal(p.repost.original.missing, true);
  assert.ok(p.flags.includes('repost_original_missing'));
  assert.ok(p.flags.includes('repost_original_urn_unknown'));
});

test('URN parsing: activity, share, ugcPost; unknown formats flagged', () => {
  assert.deepEqual(parseUrn(' urn:li:ugcpost:12 '), { urn: 'urn:li:ugcPost:12', type: 'ugcPost', id: '12' });
  assert.equal(parseUrn('urn:li:share:3').type, 'share');
  assert.ok(N(row(1, { urn: 'urn:li:fsd_update:(1,2)' })).flags.includes('unrecognised_urn_format'));
});

test('dedupe: identical URN once (also with whitespace variant)', () => {
  const r = dedupePosts([N(row(1)), N(row(2)), N(row(1, { urn: ' urn:li:activity:1 ' }))]);
  assert.equal(r.posts.length, 2);
  assert.equal(r.duplicates_removed, 1);
});

test('dedupe: identical (stripped) share URL with different URNs → same post, once', () => {
  const a = N(row(1, { extra: { share_url: 'https://www.linkedin.com/posts/p-activity-1?utm_source=a' } }));
  const b = N(row(99, { urn: 'urn:li:share:99', extra: { share_url: 'https://www.linkedin.com/posts/p-activity-1?trk=b' } }));
  assert.equal(dedupePosts([a, b]).posts.length, 1);
});

test('dedupe: different URN types on the same thread are NOT merged, both flagged', () => {
  const a = N(row(1, { thread_urn: 'urn:li:ugcPost:5' }));
  const b = N(row(2, { urn: 'urn:li:share:2', thread_urn: 'urn:li:ugcPost:5' }));
  const r = dedupePosts([a, b]);
  assert.equal(r.posts.length, 2);
  assert.ok(r.posts[0].flags.includes('possible_same_post_as:urn:li:share:2'));
  assert.ok(r.posts[1].flags.includes('possible_same_post_as:urn:li:activity:1'));
});

test('dedupe: rows without a URN are kept and flagged; identical ones flagged as possible duplicates', () => {
  const a = N(row(1, { urn: null, text: 'same' }));
  const b = N(row(1, { urn: null, text: 'same' }));
  const r = dedupePosts([a, b]);
  assert.equal(r.posts.length, 2);
  assert.ok(r.posts.every((p) => p.flags.includes('no_urn')));
  assert.ok(r.posts[1].flags.includes('possible_duplicate_no_urn'));
});

test('dedupe: a repost and its original are both kept and linked', () => {
  const orig = N(row(1, { text: 'We are hiring' }));
  const rep = N(row(2, { text: '+1', reshared_author: 'Author 1', reshared_text: 'We are hiring', extra: { reshared_activity_urn: 'urn:li:activity:1' } }));
  const r = dedupePosts([rep, orig]);
  assert.equal(r.posts.length, 2);
  assert.ok(r.posts[0].flags.includes('original_in_results'));
  assert.equal(r.posts[0].repost.original.urn, orig.urn);
});
