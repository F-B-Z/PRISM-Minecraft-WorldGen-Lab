# PRISM Worldgen Lab

PRISM Worldgen Lab is an independent worldgen preview and tuning tool for Minecraft Java datapacks and modpack worldgen testing.

For live feedback and discussions, join the PRISM Development Discord:
https://discord.gg/vsjgvwu82

Built on a heavily modified fork of [`jacobsjo/mc-datapack-map`](https://github.com/jacobsjo/mc-datapack-map).

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

## Download

Use the latest Windows release from the GitHub Releases page:
https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab/releases/latest

The desktop app checks for signed GitHub updates on startup and shows an update prompt when a newer release is available.

## What It Does

- Preview Minecraft worldgen datapacks and compatible worldgen mod jars.
- Load worldgen sources from disk or Modrinth.
- Compare default and tuned seed views side by side.
- Inspect heightmap, cave view, Y layers, biome search, and difference stats.
- Export basic datapacks and preset data for testing.

## Public Beta Scope

The public build stays focused on community world preview and basic tuning workflows. It does not bundle Lithosphere, Still Life, unreleased PRISM datapacks, or other third-party mod jars.

Some advanced production workflows are developed privately first and may later appear as clearly labeled Pro Preview, Pro, or Studio features. Community features already released publicly will remain available in at least a basic form.

## Privacy

PRISM Worldgen Lab does not send telemetry by default. Future diagnostics, if added, must be explicit opt-in.

## Upstream Attribution

Fork source: `jacobsjo/mc-datapack-map`

Original license: MIT, retained in `LICENSE.txt`.

## Development

```powershell
npm install
npm run build
npm run dev
```

Desktop development:

```powershell
npm run desktop:dev
npm run desktop:build
```

_Last edited: codex-20260704-k9_
