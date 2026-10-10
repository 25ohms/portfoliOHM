# 25ohms / OHMEGA

A single-screen artist portfolio with an interactive radial menu and a live, palette-mapped 3D scene.

## Install and run

Requirements: Node.js 24 and npm. Set `BUCKET_URL` in your local `.env` to the public R2 bucket base URL.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates the static site in `dist/`; `npm run preview` serves that build. `package-lock.json` keeps installs reproducible.

In development, `[25ohms perf]` console logs report startup timings and frame drops. Toggle them with `window.__25ohmsPerfLogger.disable()` or `.enable()`; each reloads the page.

The app uses React and Three.js with React Three Fiber; Leva supplies development scene controls, and Space Mono is bundled locally. Vite, TypeScript, and ESLint support development and builds; Vitest, Playwright, and Prettier provide tests and formatting. Playwright browsers are installed separately with `npx playwright install chromium firefox webkit` when running browser tests.

The music catalogue and audio files are served from a public Cloudflare R2 bucket. Local development needs internet access to that bucket, and the bucket must allow browser CORS requests for audio and waveform loading. `.env` is ignored by Git. Vite injects `BUCKET_URL` into the client bundle for browser requests, so this keeps the URL out of the repository but does not hide it from site visitors. Do not put credentials or private keys in this variable. If the bucket must be private, serve the audio through a backend or signed URLs instead of exposing a direct bucket URL.

## Project structure

```text
index.html                 Page metadata and app mount
package.json               Dependencies and npm commands
package-lock.json          Locked npm dependency versions
tsconfig.json              TypeScript compiler settings
vite.config.ts             Development server and production bundler
vitest.config.ts           Unit test discovery
playwright.config.ts       Browser test projects and server settings
eslint.config.js           Lint rules
.prettierrc.json           Formatting preferences
.gitignore                 Generated, local, and secret files to ignore
README.md                  Setup and project guide
src/
  main.tsx                 React bootstrap, font import, and CSS import
  App.tsx                  Radial menu, audio card, and link panels
  styles.css               Layout, typography, effects, and responsive rules
  audio/
    MusicPlayer.tsx        R2 catalogue, playback, and audio analysis
    NowPlayingBar.tsx      Persistent compact player outside the audio menu
    artworkCache.ts        Preload and cache the now-playing thumbnail
    SpectrumVisualizer.tsx Live audio spectrum display
    bass.ts                Shared bass-level analysis helpers
  components/LoadingScreen.tsx  Startup progress and transition overlay
  components/DitheredLogo.tsx  Canvas-rendered loading logo
  cards/
    AudioCard.tsx          Audio menu content panel
    Waveform.tsx           Peak based bars and seek control
    ShowsCard.tsx          Shows and event content panel
  config/scene.ts          Scene defaults, types, and validation
  data/artist.ts           Public links and portfolio copy
  utils/color.ts           Artwork accent-color helpers
  utils/performanceLogger.ts  Toggleable development performance diagnostics
  scene/
    HeroScene.tsx          Scene lifecycle, fallback, and dev controls
    SceneContents.tsx      Camera, model, effects, and scene interaction
    Fetus.tsx              FBX model setup and materials
    FetusLoader.ts         Repair and parse the source FBX
    Logo.tsx               Animated 3D OHMEGA logo
    Enterprise.tsx         Animated Enterprise OBJ model
    Stars.tsx              Animated star field
    Nebula.tsx             Procedural background clouds
    PalettePass.tsx        Dithered palette postprocessing
    SceneDevPanel.tsx      Development-only scene tuning UI
    math.ts                Palette, camera, and seeded-random helpers
    scene.test.ts          Scene config, loader, and math tests
models/
  fetus/source/scene.fbx   Fetus model used by the scene
  ohmLOGO/ohmLOGO.fbx      Logo model used by the scene
  enterprise/uss-enterprise.obj  Enterprise model used by the scene
public/
  favicon.svg              Browser icon
  ohmega-still*.png        WebGL failure fallback images
  logos/                   Logo images used by loading and scene styling
  fonts/the-2k12.ttf       Local display font
  fonts/README.txt         Font source and license note
scripts/
  clean.mjs                Remove generated build and test output
  preview.mjs              Capture fallback images or screenshots
  check-production.mjs     Check production bundle and runtime behavior
  generate-waveform-sidecars.mjs  Generate and upload per-track waveform data
tests/portfolio.spec.ts    Browser-level portfolio checks
reference/
  artist_info/             Artist source notes
  TDReference/             TouchDesigner reference project
```

`dist/`, `node_modules/`, and browser/test outputs are generated or installed locally and can be recreated. `npm run clean` removes generated output.

The 2K12 display font is served from `public/fonts/the-2k12.ttf`. The R2 now-playing bar stays available across menu sections and shares the audio card's artwork accent and seekable peak waveform. Project order comes from `music/indexing.txt`; each project's `tracklist.txt` lists its WAV files. Generate interval-peak waveform sidecars and upload each beside its WAV with `npm run waveforms:upload` (requires Wrangler access to the R2 bucket).

Keyboard controls: **Space** toggles playback, **Left/Right** seeks by 10 seconds, **Shift+Left/Right** changes tracks, and **Up/Down** moves through the menu.

## Triage before removal

- `src/data/artist.ts` exports `navigation`, `biography`, and `portfolioSections` that are not currently imported. Review whether to keep this future content or remove the unused exports; `socialLinks` is active.
- `reference/artist_info/` and `reference/TDReference/` are not loaded by the site. Confirm whether these source notes and the TouchDesigner project should remain archived before removing them.
- `@fontsource-variable/dm-sans` is in `package.json` but has no source imports. Confirm whether it is planned before removing the dependency.
- `public/logos/ohmLOGO.png` and `public/logos/ohmLOGO_2.png` have no current source references; confirm they are obsolete before removing them.

## Common commands

```sh
npm run lint
npm test
npm run build
npm run test:e2e
npm audit
```

For scene tuning and preview capture, start `npm run dev`, then use `npm run capture` to refresh the fallback still images. Deploy the contents of `dist/` to a static host.
