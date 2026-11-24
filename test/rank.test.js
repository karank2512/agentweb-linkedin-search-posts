import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNALS, explain, rankPosts, scorePost } from '../src/rank.js';

const P = (text, urn = null, orig) => ({ text, urn, repost: orig ? { original: { text: orig } } : null });

test('positive signals and explanation', () => {
  const r = scorePost(P("We're hiring a designer to join our team. Apply here. #hiring"));
  assert.equal(r.label, 'likely_hiring');
  const ids = r.signals.map((s) => s.id);
  for (const id of ['we_are_hiring', 'join_our_team', 'apply', 'hiring_hashtag']) assert.ok(ids.includes(id), id);
  assert.match(explain(r), /\+3 we_are_hiring/);
});

test('hard negatives: job seekers ("open to work", "looking for a job", laid off, asking who is hiring)', () => {
  for (const t of ['#OpenToWork looking for a role in sales', "I'm looking for a job in finance, we're hiring? no", 'I was laid off today. Any leads?', 'Is anyone hiring data analysts?', 'Open to work: nurse, available January', "I'm actively seeking new opportunities in design"]) {
    const r = scorePost(P(t));
    assert.equal(r.hard_negative, true, t);
    assert.equal(r.label, 'unlikely', t);
  }
});

test('a hiring post addressed to job seekers is not a hard negative', () => {
  const r = scorePost(P("If you're #OpenToWork, we're hiring forklift drivers. Apply now."));
  assert.equal(r.hard_negative, false);
  assert.equal(r.label, 'likely_hiring');
});

test('soft negatives: bait, agency volume, new-job announcement, filled role', () => {
  assert.equal(scorePost(P("Comment 'interested' for 50 companies hiring now")).label, 'unlikely');
  assert.notEqual(scorePost(P('Our client, a fast-growing fintech, is hiring across multiple roles. 40+ openings across Europe. Send your CV.')).label, 'likely_hiring');
  // Known limitation (also seen in the held-out eval): an agency post with strong hiring phrasing can still score
  // likely_hiring. The agency signal fires and lowers the score, but does not veto it.
  const agency = scorePost(P('Our client is hiring two designers. Apply here, send your CV.'));
  const direct = scorePost(P('Our team is hiring two designers. Apply here, send your CV.'));
  assert.ok(agency.signals.some((s) => s.id === 'agency_volume'));
  assert.equal(agency.label, 'likely_hiring'); // the limitation, pinned so a future fix shows up here
  assert.equal(direct.score - agency.score, 3);
  assert.equal(scorePost(P("Excited to share that I've started a new position at Example Co")).label, 'unlikely');
  assert.equal(scorePost(P('Update: the role has been filled')).label, 'unlikely');
});

test('repost: original text scored at half weight; the original author\'s hard negatives do not apply to the reposter', () => {
  const r = scorePost(P('Sharing', null, "We're hiring a designer. Apply here. #hiring"));
  assert.ok(r.signals.every((s) => s.part === 'original'));
  assert.equal(r.score, (3 + 2 + 2 + 2) / 2);
  const s = scorePost(P('Help my friend out', null, '#OpenToWork looking for a job'));
  assert.equal(s.hard_negative, false);
});

test('deterministic: same input → same output; input order does not change ranking', () => {
  const posts = [P('We are hiring a nurse. Apply now.', 'urn:li:activity:3'), P('nice weather', 'urn:li:activity:1'), P("We're hiring a chef. Apply now.", 'urn:li:activity:2'), P('#opentowork', null)];
  const a = rankPosts(posts).map((x) => [x.post.urn, x.score, explain(x)]);
  const b = rankPosts([...posts].reverse()).map((x) => [x.post.urn, x.score, explain(x)]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((x) => x[0]).slice(0, 2), ['urn:li:activity:2', 'urn:li:activity:3']); // ties broken by URN
});

test('filter keeps only likely hiring, or a minScore without hard negatives', () => {
  const posts = [P("We're hiring. Apply here."), P('hello'), P('#opentowork we are hiring')];
  assert.equal(rankPosts(posts, { filter: true }).length, 1);
  assert.equal(rankPosts(posts, { filter: true, minScore: -100 }).length, 2);
});

test('no hard-coded industry, location or seniority: substitutions do not change the score', () => {
  const template = "We're hiring a {role} in {place}. Apply here.";
  const roles = ['nurse', 'software engineer', 'senior accountant', 'junior chef', 'VP of Sales', 'intern', 'electrician', 'principal scientist'];
  const places = ['Leeds', 'London', 'Lagos', 'São Paulo', 'remote', 'Tokyo'];
  const scores = new Set();
  for (const role of roles) for (const place of places) scores.add(scorePost(P(template.replace('{role}', role).replace('{place}', place))).score);
  assert.equal(scores.size, 1);
});

test('signal patterns contain no industry, location or seniority vocabulary', () => {
  // ("lead" is not listed: the verb "to lead" appears in looking_for_to_join.)
  const banned = ['engineer', 'developer', 'nurse', 'sales', 'finance', 'senior', 'junior', 'director', 'manager\\b(?!s\\?)', 'remote', 'london', 'new york', 'tech', 'software', 'intern', 'hybrid', 'executive'];
  for (const s of SIGNALS) for (const b of banned) assert.ok(!new RegExp(b, 'i').test(s.re.source), `${s.id} contains ${b}`);
});
