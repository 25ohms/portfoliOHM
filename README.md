# 25ohms / OHMEGA

An artist portfolio built as a single-screen, CRT-inspired game menu around an interactive, palette-mapped wireframe sculpture. The dial opens external work links while the OHMEGA scene remains in view. Fonts and runtime images are served locally; no credentials or environment variables are required.

## Installation and setup

Use Node.js 24 LTS, as recorded in `.nvmrc`, and npm. With [nvm](https://github.com/nvm-sh/nvm) installed:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open the local URL printed by Vite. `npm run build` type-checks and creates the production site in `dist/`; `npm run preview` serves that build locally. `npm ci` uses the committed `package-lock.json` for a reproducible dependency install.

## Main stack and why it is used

- **Vite** provides the local development server and produces static files that can be hosted without an application server.
- **React and TypeScript** structure the single-screen menu and scene controls while catching many content and configuration mistakes during the build.
- **Three.js with React Three Fiber** renders the interactive OHMEGA sculpture, twinkling stars, and procedural nebula. React Three Fiber lets the scene live alongside the React interface; Three.js supplies the WebGL rendering primitives.
- **A custom Three.js palette pass** creates the dithered, limited-color treatment. DOM text and controls remain regular HTML for accessibility and responsive layout.
- **Plain CSS** styles the site without adding a component framework, keeping the visual system and responsive rules close to the project.
- **Vitest and Playwright** support scene-level and browser-level checks; **ESLint and Prettier** support consistent source code.

## Architecture

The browser starts at `index.html` and mounts the React application. A fixed radial dial changes the active menu item and opens a compact link panel; the 3D scene stays mounted behind the interface. The scene renders to an offscreen target before the palette pass displays it.

```mermaid
flowchart TD
    Browser[index.html]
    Entry[src/main.tsx]
    App[src/App.tsx<br/>Single-screen dial and link panels]
    Content[src/data/artist.ts<br/>Page content and links]
    Styles[src/styles.css]
    Home[Full-screen experience]
    Dial[Audio / Visual / Shows / Contact]
    Hero[src/scene/HeroScene.tsx<br/>Scene and controls]
    Config[src/config/scene.ts<br/>Scene defaults and validation]
    Contents[SceneContents.tsx]
    Model[Fetus.tsx + FetusLoader.ts<br/>FBX model]
    Stars[Stars.tsx]
    Pass[PalettePass.tsx<br/>Dither and color ramp]
    Assets[models/ and public/]

    Browser --> Entry --> App
    App --> Content
    App --> Styles
    App --> Home
    App --> Dial
    Home --> Hero
    Hero --> Config
    Hero --> Contents
    Contents --> Model
    Contents --> Stars
    Contents --> Pass
    Model --> Assets
    Hero -. WebGL failure .-> Assets
```

## Repository layout

```text
.
├── index.html                 # HTML entry point
├── src/
│   ├── main.tsx               # React bootstrap, local fonts and CSS
│   ├── App.tsx                # Full-screen dial and link panels
│   ├── data/artist.ts         # Page copy, navigation and public social links
│   ├── config/scene.ts        # Scene defaults and configuration validation
│   ├── scene/                 # 3D scene, model loader, palette effect and tests
│   └── styles.css             # Site layout, typography and responsive styles
├── public/                    # Favicon and runtime fallback still images
├── models/fetus/source/       # Source FBX loaded by the 3D scene
├── reference/                 # Artist source notes and TouchDesigner reference
├── scripts/                   # Cleanup, capture and production-check utilities
├── tests/                      # Playwright browser tests
├── package.json               # Dependencies and project commands
├── package-lock.json          # Reproducible npm dependency tree
└── *config files              # Vite, TypeScript, lint, format and test settings
```

`dist/` is generated output, not source. It is only needed for deployment or `npm run preview`, and can be recreated with `npm run build`. Browser test output and optional screenshots go under the ignored `.artifacts/` directory. Run `npm run clean` to remove generated output after testing or previewing.

`node_modules/` is a local install and is ignored by Git. Commit `package-lock.json` so other developers and CI can use `npm ci`. The fallback images in `public/` and the FBX in `models/` are runtime assets and should be versioned with the source.

## Tune the sculpture

In development, click **Tune scene +** on the landing page. The panel controls:

- Model rotation (degrees in the panel, radians in the configuration), position, scale, wire intensity, and opacity.
- Camera field of view, framing padding, and idle rotation speed.
- Bayer matrix size (2, 4, or 8), pixel size in CSS pixels, strength, and quantization levels.
- Lookup colors and intermediate stop positions; endpoints stay at 0 and 1.
- Star count, size, brightness, random seed, pixel density, and render resolution.

**Capture pose** pauses rotation and synchronizes the controls with the actual dragged pose. **Export JSON** includes that live pose and all other settings. Import accepts 2–8 ordered palette stops, including endpoints at 0 and 1. **Reset all** restores the committed defaults. Draft settings persist in this browser under `25ohms.scene.v1`; production neither reads nor writes them.

To promote a preset, replace the `DEFAULT_SCENE` object in `src/config/scene.ts` with the exported JSON object. Keep its `SceneConfig` annotation. Rebuild, inspect the result, then regenerate the fallback image. This is deliberately a manual, reviewable change: the tuning panel never rewrites source files.

Visitors can drag to inspect the sculpture, use the arrow keys to move through the dial, and use the on-screen controls to pause or reset the scene. Reduced motion starts the sculpture still. The font and CRT colors are centralized in the custom properties at the top of `src/styles.css`.

## Rendering and model compatibility

`Fetus` loads the original `models/fetus/source/scene.fbx`, centers its bounds, and applies one shared, unlit white wire material. `Stars` creates a deterministic, slowly drifting point field with individual twinkle; `Nebula` adds animated procedural clouds behind it. `PalettePass` renders the scene to an offscreen target, quantizes luminance using a Bayer threshold, and samples a color-ramp texture. Palette colors are stored in sRGB, decoded for sampling, and converted to the display color space once at the output. Text and controls stay in the DOM.

The supplied MODO FBX contains two artifacts that stock FBXLoader cannot parse: an empty normals layer and an unconnected `MODO_RenderSettings` model. `FetusLoader` ignores those two node names in a copied buffer. The source file and all geometry data remain intact. A test parses the real asset and checks finite geometry and unchanged source bytes.

The scene caps device pixel ratio and reduces offscreen resolution if measured frame rate stays below 42 FPS after warmup. Animation stops while the scene is outside the viewport or the document is hidden. Paused scenes render on demand. Model data is reused while the scene is mounted, while per-mount materials and postprocessing resources are disposed. The renderer uses WebGL2; failure shows `public/ohmega-still.png` and keeps the website usable.

## Content and next milestone

- `src/data/artist.ts`: navigation, section descriptions, biography, and named public social links.
- `src/styles.css`: palette, typography, spacing, and responsive layouts.
- `src/App.tsx`: single-screen radial menu and compact external-link panels.

Audio, Visual, Shows, and Contact link to the artist's public Bandcamp, YouTube, Resident Advisor, and Instagram pages. The supplied SoundCloud insights URL is a private dashboard and is not published.

Future work can replace the external links with hosted audio, project and performance content, and a contact service. There is no CMS, analytics, or server API in this milestone.

## Checks and previews

```sh
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

Browser tests cover actual model loading, motion controls, reduced motion, live-pose export/persistence, failure fallback, and mobile layout. Desktop/mobile emulation does not replace physical-device testing.

With the development server running, refresh the fallback from the actual scene:

```sh
npm run capture
```

The script uses fresh browser storage and reduced motion, so it captures committed defaults. It writes desktop/mobile fallback images under `public/ohmega-still*.png`. Rebuild after changing the fallback.

Screenshots are optional: `node scripts/preview.mjs --previews` writes desktop, mobile, and development-panel previews to `.artifacts/previews/`. They are not required to run or deploy the website.

Run `npm run check:production` with `npm run preview -- --port 4173` running to check that production omits tuning code, ignores development storage, lazy-loads 3D assets, and handles a lost WebGL context. `npm run format` formats the editable source.

## Hosting

Deploy the contents of `dist/` to a static host. The site is a single screen and does not require route rewrites. Keep it at the domain root unless Vite's `base` path is changed.

Development tuning controls are removed from production. No deployment has been made by this repository setup.
