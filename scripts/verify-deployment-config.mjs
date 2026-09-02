import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'));

assert.equal(config.assets?.directory, './dist', 'Static assets must come from the Vite dist directory');
assert.equal(config.assets?.binding, 'ASSETS', 'Static assets must use the ASSETS binding');
assert.equal(
  config.assets?.not_found_handling,
  'single-page-application',
  'Frontend navigation must use the SPA fallback',
);
assert.deepEqual(
  config.assets?.run_worker_first,
  ['/api/*'],
  'Only API routes should run the Worker before static asset handling',
);
assert.ok(
  config.durable_objects?.bindings?.some(
    binding => binding.name === 'RAID_ROOMS' && binding.class_name === 'RaidRoom',
  ),
  'RAID_ROOMS must remain bound to RaidRoom',
);
assert.ok(
  config.migrations?.some(migration => migration.new_sqlite_classes?.includes('RaidRoom')),
  'RaidRoom must remain declared as a SQLite Durable Object migration',
);

console.log('Verified same-origin static assets, API routing, SPA fallback, and Durable Object configuration.');
