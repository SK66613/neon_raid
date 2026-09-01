import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ASSET_ENTRIES } from '../src/game/assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const errors = [];
const seen = new Set();
const declared = new Map();

for (const entry of ASSET_ENTRIES) {
  if (seen.has(entry.key)) errors.push(`Duplicate logical asset key: ${entry.key}`);
  seen.add(entry.key);
  declared.set(entry.key, entry.url);
  const assetPath = path.join(root, 'public', entry.url.replace(/^\//, ''));
  try {
    await access(assetPath, constants.R_OK);
  } catch {
    errors.push(`Declared asset does not exist: ${entry.key} -> ${entry.url}`);
  }
}

for (const direction of manifest.directions) {
  for (const state of manifest.player_states) {
    if (!declared.has(`raider.${direction}.${state}`)) errors.push(`Missing directional Raider asset: ${direction}/${state}`);
  }
  for (const state of manifest.enemy_states) {
    if (!declared.has(`corpSec.${direction}.${state}`)) errors.push(`Missing directional Corp Sec asset: ${direction}/${state}`);
  }
}
for (const [animation, frameCount] of Object.entries(manifest.boss_frames)) {
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (!declared.has(`wardenX.${animation}.${frame}`)) errors.push(`Missing Warden-X frame: ${animation}/${frame}`);
  }
}

const sourceFiles = ['index.html', 'src/main.js', 'src/game/Game.js', 'src/game/assets.js'];
for (const file of sourceFiles) {
  const source = await readFile(path.join(root, file), 'utf8');
  if (/data:image\/(?:png|jpeg);base64/i.test(source)) errors.push(`Embedded image payload found in ${file}`);
}

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Verified ${ASSET_ENTRIES.length} unique asset declarations and manifest-required animations.`);
