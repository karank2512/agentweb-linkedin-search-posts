// Capability probe: given a map JSON (discover's ActionMap, its `curated` summary, or a map listing),
// report whether the PROPOSED search_posts pair is unsupported, supported, or present but incompatible.
import { MAP_ENTRY } from './contract.js';

/** Param names from {params:{name:spec}} | {params:[name|{name}]} | {parameters:...}. */
const paramNames = (a) => {
  const p = a?.params ?? a?.parameters ?? {};
  return new Set(Array.isArray(p) ? p.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean) : Object.keys(p));
};

/** @param {any} map @returns {{status: 'unsupported'|'supported'|'incompatible', map_version: string|null, problems: string[]}} */
export function probeSearchPosts(map) {
  const actions = map?.curated?.actions ?? map?.actions ?? [];
  const version = map?.curated?.version ?? map?.version ?? null;
  const problems = [];
  let present = 0;
  for (const want of MAP_ENTRY.actions) {
    const got = actions.find((a) => a?.name === want.name);
    if (!got) { problems.push(`${want.name}: not in map`); continue; }
    present++;
    const have = paramNames(got);
    for (const [name, spec] of Object.entries(want.params)) if (spec.required && !have.has(name)) problems.push(`${want.name}: missing required param ${name}`);
    const gp = got.params ?? got.parameters ?? {};
    const pairs = Array.isArray(gp) ? gp.map((x) => (typeof x === 'string' ? [x, {}] : [x?.name, x])).filter(([n]) => n) : Object.entries(gp);
    const extraReq = pairs.filter(([n, s]) => s?.required && !(n in want.params)).map(([n]) => n);
    for (const n of extraReq) problems.push(`${want.name}: requires unknown param ${n}`);
  }
  const status = present === 0 ? 'unsupported' : problems.length ? 'incompatible' : 'supported';
  return { status, map_version: version, problems: status === 'unsupported' ? [] : problems };
}
