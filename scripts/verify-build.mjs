import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_ENTRIES } from '../src/game/assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const errors = [];
const requireFile = async file => {
  try { await access(file, constants.R_OK); } catch { errors.push(`Missing build output: ${path.relative(root, file)}`); }
};

await requireFile(path.join(dist, 'index.html'));
for (const { url } of ASSET_ENTRIES) await requireFile(path.join(dist, url.replace(/^\//, '')));

const outputFiles = await readdir(path.join(dist, 'assets')).catch(() => []);
if (!outputFiles.some(file => file.endsWith('.js'))) errors.push('No JavaScript bundle emitted in dist/assets');
if (!outputFiles.some(file => file.endsWith('.css'))) errors.push('No CSS bundle emitted in dist/assets');

const textOutputs = ['index.html', ...outputFiles.filter(file => /\.(?:js|css)$/.test(file)).map(file => `assets/${file}`)];
for (const file of textOutputs) {
  const content = await readFile(path.join(dist, file), 'utf8').catch(() => '');
  if (/data:image\/(?:png|jpeg);base64/i.test(content)) errors.push(`Embedded PNG/JPEG payload in dist/${file}`);
}

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Verified production shell, JS/CSS bundles, and ${ASSET_ENTRIES.length} external image assets.`);
