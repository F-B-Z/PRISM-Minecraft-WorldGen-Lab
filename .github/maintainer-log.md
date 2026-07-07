# Maintainer Log

This file records repository maintenance notes that are useful for release
operators but should not be uploaded as GitHub Release assets.

## 2026-07-07

- Published `v0.1.5` with missing vanilla datapacks for the public Minecraft
  version selector.
- Confirmed `latest.json` points to the signed `v0.1.5` Windows updater asset.
- Removed local support files from GitHub Release assets and kept future
  checksum / Defender notes under release-local `support/`.
- Keep release-operator upload notes out of user-facing README sections; use
  release script output and maintainer notes instead.
