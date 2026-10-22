# Third-party notices

## Base source attribution

Copyright (c) 2026 Talkdedsec. Base source: [tlk-rpf](https://github.com/Talkdedsec/tlk-rpf), GPL-3.0-only. FLTR / Fivemleaktr modifications are distributed under the same license.

fltr-rpf is built on the components below. Each is used under its own license; the
license texts are distributed with each package (`Cargo.lock` and `package-lock.json`
pin the exact versions).

## Format knowledge

| Source | License | Used for |
| --- | --- | --- |
| [CodeWalker](https://github.com/dexyfex/CodeWalker) by dexyfex | MIT | Structure offsets of particle dictionaries (`ptxFxList`, particle, emitter and effect rules, keyframe properties) and the keyframe property name table in `core/src/ypt.rs`. No CodeWalker code is included. |
| [rage-formats](https://github.com/VIRUXE/rage-formats) | Unlicense | Drawable, fragment, collision and meta/PSO parsing; texture dictionary rebuilding. Linked as a Rust dependency. |

## Rust crates (direct dependencies)

| Crate | License |
| --- | --- |
| tauri, tauri-plugin-dialog, tauri-plugin-opener | Apache-2.0 OR MIT |
| rage-formats | Unlicense |
| image | MIT OR Apache-2.0 |
| fast_image_resize | MIT OR Apache-2.0 |
| texpresso | MIT |
| intel_tex_2 | MIT OR Apache-2.0 |
| bcdec_rs | MIT |
| flate2 | MIT OR Apache-2.0 |
| roxmltree | MIT OR Apache-2.0 |
| rayon | MIT OR Apache-2.0 |
| reqwest | MIT OR Apache-2.0 |
| serde, serde_json | MIT OR Apache-2.0 |
| thiserror | MIT OR Apache-2.0 |
| chrono | MIT OR Apache-2.0 |
| keyring | MIT OR Apache-2.0 |

## JavaScript packages (direct dependencies)

| Package | License |
| --- | --- |
| react, react-dom | MIT |
| three | MIT |
| codemirror, @codemirror/* | MIT |
| @tauri-apps/api, @tauri-apps/plugin-dialog, @tauri-apps/plugin-opener | Apache-2.0 OR MIT |
| @anthropic-ai/sdk | MIT |

## Trademarks

Grand Theft Auto, GTA V and Rockstar Games are trademarks of Take-Two Interactive
Software. FiveM is a trademark of Cfx.re. fltr-rpf is not affiliated with or endorsed
by either.
