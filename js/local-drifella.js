// Resolve original collection/category paths without confusing identically named traits.
const normalized = path => path.replaceAll('\\', '/').normalize('NFC').toLowerCase();
export async function matchDrifellaFiles(files, assets) {
  const originals = assets.filter(a => a.originalPath && a.path.startsWith('drifella/'));
  const matches = new Map();
  let matchedFiles = 0;
  for (const file of files) {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) continue;
    const parts = normalized(file.webkitRelativePath || file.name).split('/');
    let candidates = [];
    for (let length = parts.length; length >= 2; length--) {
      const suffix = parts.slice(-length).join('/');
      candidates = originals.filter(a => {
        const path = normalized(a.originalPath);
        return path === suffix || path.endsWith('/' + suffix);
      });
      if (candidates.length) break;
    }
    let paths = [...new Set(candidates.map(a => a.path))];
    if (paths.length !== 1) {
      // Original filenames can collide between collections. Verify their bytes instead.
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      paths = originals.some(a => a.path === `drifella/${hash}.webp`) ? [`drifella/${hash}.webp`] : [];
    }
    if (paths.length === 1) { matches.set(paths[0], file); matchedFiles++; }
  }
  return {matches, matchedFiles};
}
