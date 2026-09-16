import { FontRegistry } from './src/fonts/registry.ts';
import { resolveFamily, httpFetch } from './src/fonts/google.ts';

console.log('--- direct resolveFamily');
try {
  const r = await resolveFamily('Noto Sans', httpFetch);
  console.log('resolved:', r ? { license: r.license, files: r.files.map(f => [f.name, f.buffer.length]) } : null);
} catch (e) { console.log('THREW:', e.message); }

console.log('--- via registry.acquire');
const reg = await FontRegistry.create({ env: { CRISPR_CACHE_DIR: process.env.DBG_CACHE } });
try {
  const p = await reg.acquire('Noto Sans');
  console.log('acquired payloads:', p.length);
} catch (e) { console.log('THREW:', e.message); }
