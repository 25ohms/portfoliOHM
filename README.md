# 25ohms / OHMEGA

A single-screen artist portfolio with an interactive radial menu and a live, palette-mapped 3D scene.

## Install and run

Requirements: Node.js 24 and npm. No environment variables or credentials are needed.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates the static site in `dist/`; `npm run preview` serves that build. `package-lock.json` keeps installs reproducible.

The app uses React and Three.js with React Three Fiber; Leva supplies development scene controls, and Space Mono is bundled locally. Vite, TypeScript, and ESLint support development and builds; Vitest, Playwright, and Prettier provide tests and formatting. Playwright browsers are installed separately with `npx playwright install chromium firefox webkit` when running browser tests.

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
.gitignore                 Generated, local, and secret files to ignore
README.md                  Setup and project guide
src/
  main.tsx                 React bootstrap, font import, and CSS import
  App.tsx                  Radial menu, audio card, and link panels
  styles.css               Layout, typography, effects, and responsive rules
  audio/SoundCloudPlayer.tsx  SoundCloud widget and shared player state
  cards/AudioCard.tsx       Audio menu content panel
  config/scene.ts          Scene defaults, types, and validation
  data/artist.ts           Public links and portfolio copy
  scene/
    HeroScene.tsx          Scene lifecycle, fallback, and dev controls
    SceneContents.tsx      Camera, model, effects, and scene interaction
    Fetus.tsx              FBX model setup and materials
    FetusLoader.ts         Repair and parse the source FBX
    Stars.tsx              Animated star field
    Nebula.tsx             Procedural background clouds
    PalettePass.tsx        Dithered palette postprocessing
    SceneDevPanel.tsx      Development-only scene tuning UI
    math.ts                Palette, camera, and seeded-random helpers
    scene.test.ts          Scene config, loader, and math tests
models/fetus/source/scene.fbx  Source model used by the scene
public/
  favicon.svg              Browser icon
  ohmega-still*.png        WebGL failure fallback images
  fonts/the-2k12.ttf       Local display font
  fonts/README.txt         Font source and license note
scripts/
  clean.mjs                Remove generated build and test output
  preview.mjs              Capture fallback images or screenshots
  check-production.mjs     Check production bundle and runtime behavior
tests/portfolio.spec.ts    Browser-level portfolio checks
reference/
  artist_info/             Artist source notes
  TDReference/             TouchDesigner reference project
```

`dist/`, `node_modules/`, and browser/test outputs are generated or installed locally and can be recreated. `npm run clean` removes generated output.

## Triage before removal

- `src/data/artist.ts` exports `navigation`, `biography`, and `portfolioSections` that are not currently imported. Review whether to keep this future content or remove the unused exports; `socialLinks` is active.
- `reference/artist_info/` and `reference/TDReference/` are not loaded by the site. Confirm whether these source notes and the TouchDesigner project should remain archived before removing them.
- `@fontsource-variable/dm-sans` is in `package.json` but has no source imports. Confirm whether it is planned before removing the dependency.

## Common commands

```sh
npm run lint
npm test
npm run build
npm run test:e2e
```

For scene tuning and preview capture, start `npm run dev`, then use `npm run capture` to refresh the fallback still images. Deploy the contents of `dist/` to a static host.
