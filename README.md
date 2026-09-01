# NEON RAID — Two Stage Build v0.5

NEON RAID is a vanilla JavaScript and Canvas two-stage action prototype. This client-foundation refactor intentionally preserves the v0.5 gameplay: the Corp Sec sector, its two enemy waves, and the three-phase Warden-X reactor fight.

## Architecture

- `index.html` — small document shell containing the HUD, canvas, controls, and module entrypoint.
- `src/main.js` — client bootstrap.
- `src/styles.css` — application presentation and responsive mobile controls.
- `src/game/Game.js` — existing v0.5 rendering, input, audio, and gameplay runtime. Keeping the runtime together makes this extraction reviewable; simulation separation belongs in a later change.
- `src/game/assets.js` — canonical logical asset manifest and runtime URL maps.
- `src/game/config.js` — stable client metadata and canvas dimensions for future extraction work.
- `public/assets/` — canonical image files served unchanged by Vite.
- `scripts/verify-assets.mjs` — validates declared files, unique logical keys, directional actors, Warden-X frames, and the absence of embedded image payloads.
- `manifest.json` — v0.5 animation and stage expectations used by asset verification.

No multiplayer, networking, backend, Telegram SDK, or Telegram integration is included.

## Development

Install dependencies and start Vite's development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The source is now served as ES modules and is no longer intended to be opened by double-clicking a standalone HTML file.

## Validation and production build

```sh
npm run check
npm run build
npm run test:smoke
npm run preview
```

`npm run test:smoke` launches the production build in Chromium and verifies Stage 1 movement/fire plus the Warden-X transition and damage path.

`npm run check` verifies the asset manifest against `public/assets/`. `npm run build` writes the production client to `dist/`, and `npm run preview` serves that build locally.

## Controls

- **WASD / arrow keys:** move
- **Space:** fire
- **Shift:** dash
- **G:** grenade
- **Touch controls:** movement, fire, dash, grenade, pause, and restart

## Refactor scope

There are no intentional changes to controls, balance, visuals, assets, enemy behavior, stage progression, or Warden-X phases in this PR. It establishes a maintainable build foundation before the planned GameState/simulation separation work.

## Deployment

The client currently has an explicit origin-root deployment contract (`base: '/'`): deploy the contents of `dist/` at the origin root so `/assets/...` URLs resolve correctly. Subpath deployment is not supported by this foundation PR.
