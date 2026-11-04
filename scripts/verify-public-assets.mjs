import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const privateNames = ['VITE_ELEVENLABS_API_KEY', 'VITE_DEEPGRAM_API_KEY', 'VITE_MONZO_ACCESS_TOKEN'];
const forbidden = privateNames.map(name => process.env[name]).filter(Boolean);
let files = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(js|json|html|map)$/u.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      if (forbidden.some(value => source.includes(value))) {
        throw new Error(`Provider credential reached public asset: ${entry.name}`);
      }
      files += 1;
    }
  }
}
for (const name of ['about.html', 'privacy.html']) {
  const html = await readFile(resolve('dist', name), 'utf8');
  if (!html.includes('Sabah One (HELM)') || !html.includes('./public-pages.css')) {
    throw new Error(`Public information page is missing its identity or styling: ${name}`);
  }
}
await readFile(resolve('dist', 'public-pages.css'), 'utf8');
await scan(resolve('dist'));
console.log(`Public asset credential check passed (${files} assets; ${forbidden.length} supplied provider sentinels/values checked).`);
