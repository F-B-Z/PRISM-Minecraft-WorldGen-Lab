# PRISM Worldgen Lab

For live feedback/discussions, please join my PRISM Development Discord :)
https://discord.gg/vsjgvwu82

Local P.R.I.S.M. worldgen experiment app based on
[`jacobsjo/mc-datapack-map`](https://github.com/jacobsjo/mc-datapack-map).

This tool is a fast preview lane for seed screening, worldgen datapack patch
experiments, screenshots, and visual comparison work. It is not a replacement
for in-game verification; serious candidates should still be tested in a real
generated Minecraft world.

## Upstream Attribution

Fork source: `jacobsjo/mc-datapack-map`

Original license: MIT, retained in `LICENSE.txt`.

Initial copied files came from a local checkout of the upstream project.

## Development

```powershell
npm install
npm run build
npm run dev
```

## Desktop App

The lab is wrapped as a Tauri desktop app. Rust is pinned through
`rust-toolchain.toml` so the app avoids known compatibility issues with newer
Rust releases and transitive Tauri dependencies.

```powershell
npm run desktop:dev
npm run desktop:build
```

Build outputs:

- App executable:
  `src-tauri/target/release/prism_worldgen_lab.exe`
- Windows installers:
  `src-tauri/target/release/bundle/`

## Public Releases and Updates

Use the release helper to build the portable app, installer, and updater metadata:

```powershell
npm run release:public -- -OpenFolder
```

The script checks local build requirements, configures the Tauri updater signing
key, builds the desktop bundles, and writes versioned artifacts under
`release/<tag>/`:

- `PRISM-Worldgen-Lab-<version>-portable-windows-x64.zip`
- `installer/` with the NSIS setup exe and MSI
- `updater/` with the signed Tauri updater asset and signature
- `latest.json` for GitHub updater checks
- `release-manifest.json` with upload guidance

The updater checks GitHub once at desktop startup. When a newer signed release
exists, the app shows a PRISM update popup and can install/restart itself.
Upload the updater asset, its `.sig`, and `latest.json` to the matching GitHub
release tag so the endpoint
`https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab/releases/latest/download/latest.json`
can resolve it.

The private updater signing key is intentionally not stored in the repository.
The default expected path is
`Documents/PRISM Worldgen Lab/Signing/worldgen-lab.key`. If it is missing,
generate it with:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\Documents\PRISM Worldgen Lab\Signing\worldgen-lab.key" --ci
```

The Windows installer is configured to use the official Microsoft Edge WebView2
download bootstrapper if WebView2 is missing on a tester machine.

The upstream app expects generated vanilla datapack zips under
`public/vanilla_datapacks/`. If those are missing for a target Minecraft version,
run:

```powershell
npm run createZips
```

## Public Testing Build

The public app starts with:

1. vanilla generated datapack
2. user-loaded worldgen mod/datapack jars, either from disk or Modrinth
3. an in-memory tuning override layer

It does not bundle:

- Lithosphere jars
- Still Life jars
- unreleased PRISM experimental worldgen datapacks

The bundled PRISM Worldgen Lab presets are calibrated for Lithosphere 1.6 on
Minecraft 1.21.1. Other datapack-driven worldgen mods may expose editable noise
and density-function resources, but the included presets are not guaranteed to
fit those mods.

On first startup, the app shows a public-testing introduction. The help button
in the PRISM Lab header reopens the same guidance and lets testers re-enable it
on startup. Desktop datapack exports are written to
`Documents/PRISM Worldgen Lab/Datapacks` and the folder is opened immediately.

## Near-Term Plan

1. Keep the upstream map booting and building.
2. Expand the PRISM lab editor from raw numeric discovery toward named controls.
3. Add curated tuning states matching `prism_worldgen`.
4. Add side-by-side comparison for default vs tuned seed views.
5. Add PNG export plus a small JSON preset report.
6. Later, replace individual jar loading with a full modpack scan/import flow.

_Last edited: codex-20260624-pb_
