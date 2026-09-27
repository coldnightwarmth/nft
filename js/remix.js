import {clone, categoryLayer, mergedLayer, rngFromSeed} from './core.js?v=drifella-14';
export function remixRecipe(original, assets, seed) {
  const recipe = clone(original), rng = rngFromSeed(seed);
  recipe.seed = seed;
  const candidates = recipe.ops.map((op,index) => {
    const layer = original.pack === 'all' ? mergedLayer(op.layer) : categoryLayer(op.layer);
    return {index, alternatives:assets.filter(a => a.layer === layer && !a.empty && (a.weight ?? 1) > 0 &&
      a.id !== op.assetId && (!a.path || !op.path || a.path !== op.path))};
  }).filter(item => item.alternatives.length);
  const minimum = Math.max(1, Math.ceil(recipe.ops.length * .1));
  const maximum = Math.min(candidates.length, Math.max(1, Math.floor(recipe.ops.length * .75)));
  if (maximum < minimum) throw Error('Not enough alternative enabled traits to remix this painting. Enable more assets in its categories.');
  const count = minimum + Math.floor(rng() * (maximum - minimum + 1));
  for (let i=candidates.length-1;i>0;i--) {
    const j=Math.floor(rng()*(i+1));
    [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
  }
  for (const {index,alternatives} of candidates.slice(0,count)) {
    let roll = rng()*alternatives.reduce((sum,a)=>sum+(a.weight ?? 1),0);
    const asset = alternatives.find(a => (roll -= a.weight ?? 1)<0) || alternatives.at(-1);
    Object.assign(recipe.ops[index], {assetId:asset.id,name:asset.name,path:asset.path,source:asset.source});
  }
  return recipe;
}
