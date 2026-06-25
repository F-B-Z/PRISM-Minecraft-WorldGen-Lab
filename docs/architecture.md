# PRISM Worldgen Lab Architecture

Session: codex-20260612-px

## Purpose

`prism_worldgen_lab` is the app-side preview lane for fast P.R.I.S.M. terrain
experiments. It is forked from `jacobsjo/mc-datapack-map` and keeps that app's
core model: Vue controls, Leaflet map tiles, and web workers that evaluate
`deepslate` worldgen data.

The current shell is a Tauri desktop app around the Vite/Vue core. This keeps
the upstream renderer usable while giving the lab native local file access and
direct datapack exports.

The lab is allowed to be faster and more experimental than Minecraft itself,
but its results are not final runtime truth. Serious terrain candidates should
still be tested in a real generated world.

## Current Upstream Flow

- `src/stores/useDatapackStore.ts` composes vanilla and user-selected datapacks.
- `src/stores/useLoadedDimensionStore.ts` resolves selected dimension and biome
  color data.
- `src/MapLayers/BiomeLayer.ts` owns Leaflet tile creation, worker updates, and
  biome/hillshade/sea-level rendering.
- `src/webworker/MultiNoiseCalculator.ts` receives biome source JSON, density
  functions, noises, seed, and Y settings, then returns tile arrays with biome,
  surface, and terrain density samples.

## PRISM Direction

The PRISM-specific layer is additive:

- Load worldgen datapack and mod jar resources supplied by the tester.
- Keep public builds free of third-party jars and unreleased PRISM experimental
  worldgen datapacks.
- Keep manual jar loading and Modrinth loading available for ad hoc experiments.
- Represent common terrain goals as curated presets while still allowing direct
  numeric tuning for discovered noise and density-function values.
- Apply tuning by patching a temporary in-memory datapack layer first, then
  export confirmed settings as standalone datapack zips.

Current intended datapack order:

1. vanilla generated datapack
2. user-loaded packs or jars
3. in-memory tuning datapack

## Desktop Shell

- `src-tauri/` owns the native wrapper.
- `npm run desktop:dev` starts the Vite dev server and Tauri window.
- `npm run desktop:build` builds the Vite app, Rust executable, and Windows
  installers.
- `rust-toolchain.toml` pins Rust `1.88.0`; current Rust `1.96.0` hit a
  transitive `time` / `cookie` / `tauri-utils` trait conflict.
- `Cargo.lock` intentionally pins `time` to `0.3.47` and related transitive
  dependencies so the first desktop build remains reproducible.

## Guardrails

- Preserve MIT attribution for copied upstream code.
- Keep npm dependencies scoped to this folder.
- Do not copy generated `node_modules` or `dist` into source snapshots.
- Do not treat app output as authoritative without in-game `prism_worldgen`
  verification.

_Last edited: codex-20260624-pb_
