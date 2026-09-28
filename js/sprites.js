export const SPRITE_RANGES = {
  count: {label:'Sprites per painting', min:1, max:60, defaults:[4,12], unit:''},
  unique: {label:'Unique sprites', min:1, max:20, defaults:[2,5], unit:''},
  size: {label:'Size · % of canvas width', min:2, max:60, defaults:[8,20], unit:'%'},
  spacing: {label:'Minimum spacing · % of canvas', min:0, max:40, defaults:[3,10], unit:'%'},
  rotation: {label:'Rotation', min:-180, max:180, defaults:[0,0], unit:'°'},
};
export function spriteSettings(value={}) {
  return Object.fromEntries(Object.entries(SPRITE_RANGES).map(([key,spec])=>{
    const pair=Array.isArray(value[key]) ? value[key] : spec.defaults;
    const clamp=(v,fallback)=>Number.isFinite(Number(v))?Math.max(spec.min,Math.min(spec.max,Number(v))):fallback;
    return [key,[clamp(pair[0],spec.defaults[0]),clamp(pair[1],spec.defaults[1])].sort((a,b)=>a-b)];
  }));
}
const sample=(pair,rng,integer=false)=>integer?Math.floor(pair[0]+rng()*(pair[1]-pair[0]+1)):pair[0]+rng()*(pair[1]-pair[0]);
export function spriteOps(assets,layer,settings,rng) {
  const options=spriteSettings(settings.spritePlacement);
  for (const key of Object.keys(options)) if (settings.spriteRangeModes?.[key] === false) options[key] = [options[key][0],options[key][0]];
  const pool=assets.filter(a=>!a.empty&&(a.weight??1)>0);
  if(!pool.length)return [];
  const count=sample(options.count,rng,true),unique=Math.min(count,pool.length,sample(options.unique,rng,true));
  const selected=[];
  for(let i=0;i<unique;i++) {
    let roll=rng()*pool.reduce((n,a)=>n+(a.weight??1),0);
    const index=Math.max(0,pool.findIndex(a=>(roll-=a.weight??1)<0));
    selected.push(pool.splice(index,1)[0]);
  }
  const spacing=sample(options.spacing,rng)/100,ops=[];
  for(let i=0;i<count;i++) {
    const a=selected[i<selected.length?i:Math.floor(rng()*selected.length)];
    let point,best=-1;
    for(let attempt=0;attempt<100;attempt++) {
      const candidate={rx:rng(),ry:rng()};
      const distance=ops.length?Math.min(...ops.map(op=>Math.hypot(candidate.rx-op.rx,candidate.ry-op.ry))):Infinity;
      if(distance>best){best=distance;point=candidate;}
      if(distance>=spacing)break;
    }
    ops.push({assetId:a.id,layer,name:a.name,path:a.path,source:a.source,...point,opacity:1,
      placement:'sprite',size:sample(options.size,rng)/100,rotation:sample(options.rotation,rng)});
  }
  return ops;
}
