import { mergedLayer } from './core.js?v=drifella-14';
// OpenRarity reference: https://github.com/OpenRarity/open-rarity
// Adapt repeated categories to deterministic categorical slots (independent of stack order).
export function paintingTraits(painting) {
  const groups = new Map();
  for (const op of painting.recipe.ops) {
    const key = mergedLayer(op.layer).trim().toLowerCase();
    const value = op.name.trim().toLowerCase();
    if (!value || value === 'none' || value === 'null') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  const traits = new Map();
  for (const [key, values] of groups) {
    values.sort();
    values.forEach((value, index) => traits.set(JSON.stringify([key, index]), value));
  }
  traits.set('meta_trait:trait_count', String(traits.size));
  return traits;
}
export function rankPaintings(paintings) {
  if (!paintings.length) return new Map();
  const tokens = paintings.map(p => ({id:p.id, traits:paintingTraits(p)}));
  const keys = [...new Set(tokens.flatMap(t => [...t.traits.keys()]))].sort();
  const frequencies = new Map(keys.map(key => [key, new Map()]));
  for (const token of tokens) for (const key of keys) {
    const value = token.traits.get(key) ?? null;
    const counts = frequencies.get(key);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const n = tokens.length;
  let entropy = 0;
  for (const counts of frequencies.values()) for (const count of counts.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  const scored = tokens.map(token => {
    let information = 0, unique = 0;
    for (const key of keys) {
      const count = frequencies.get(key).get(token.traits.get(key) ?? null);
      information -= Math.log2(count / n);
      if (token.traits.has(key) && count === 1) unique++;
    }
    return {id:token.id, score:information / (entropy || 1), unique};
  }).sort((a,b) => b.unique-a.unique || b.score-a.score);
  scored.forEach((item,index) => {
    const previous = scored[index-1];
    const tied = previous && Math.abs(item.score-previous.score) <= 1e-9 * Math.max(Math.abs(item.score),Math.abs(previous.score));
    item.rank = tied ? previous.rank : index+1;
  });
  return new Map(scored.map(item => [item.id,item]));
}
