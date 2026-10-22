# Fltr Fivemleaktr

Fltr / Fivemleaktr branded edition, based on [tlk-rpf](https://github.com/Talkdedsec/tlk-rpf) by Talkdedsec. Existing website and release links point to the upstream project, not Fltr downloads. Licensed under GPL-3.0-only.

> A Windows editor for the `.rpf` packages in the FiveM `mods` folder: change textures, visual settings, particle effects, map tiles and UI graphics without OpenIV, with a backup before every save and undo for every change.

[![Status](https://img.shields.io/badge/status-active-2ea44f)](#)
[![Release](https://img.shields.io/github/v/release/Talkdedsec/tlk-rpf?label=release)](https://github.com/Talkdedsec/tlk-rpf/releases/latest)
[![CI](https://github.com/Talkdedsec/tlk-rpf/actions/workflows/ci.yml/badge.svg)](https://github.com/Talkdedsec/tlk-rpf/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078d4)](#compatibility)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

[Website](https://talkdedsec.github.io/tlk-rpf/) Â· [Download](https://github.com/Talkdedsec/tlk-rpf/releases/latest) Â· [TÃ¼rkÃ§e](README.tr.md) Â· [Changelog](CHANGELOG.md) Â· [Report a problem](https://github.com/Talkdedsec/tlk-rpf/issues/new/choose)

![Overview of a graphics mod with detected presets](docs/ekran/ozet-hazir-ayarlar.png)

## Contents

- [What it is](#what-it-is)
- [Why it exists](#why-it-exists)
- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [Trust and privacy](#trust-and-privacy)
- [Compatibility](#compatibility)
- [How it works](#how-it-works)
- [Known limitations](#known-limitations)
- [Release information](#release-information)
- [Project map](#project-map)
- [Roadmap](#roadmap)
- [Support](#support)
- [License](#license)

## What it is

FiveM loads client-side mods from `%LOCALAPPDATA%\FiveM\FiveM.app\mods`. Each mod is an `.rpf` archive with an `assembly.xml` that says which game file it replaces. fltr-rpf opens those archives, recognises what is inside and gives each file type its own editor: a texture grid for `.ytd`, grouped sliders for `visualsettings.dat`, a 3D view for models, a layer editor for the pause-menu map, a keyframe editor for particle effects. The interface is in Turkish.

## Why it exists

OpenIV can edit these files, but every change goes through export, an external image editor, import and manual repacking, and nothing tells you whether FiveM will actually load the result. fltr-rpf keeps the whole loop inside one window and checks the package the way FiveM reads it.

| It does | It does not |
| --- | --- |
| Edit OPEN and CFXP archives, the formats FiveM's mods loader accepts | Open NG or AES encrypted archives (the keys are not bundled) |
| Replace, recolour, rename and resize textures, including textures embedded in models and particle dictionaries | Author new 3D models or import meshes |
| Warn about mods FiveM will silently ignore and repair broken `assembly.xml` mappings | Modify the base game or FiveM itself |
| Keep a backup before every write and refuse to write while FiveM has the file open | Guarantee how a change looks in game; that still needs a test in FiveM |

## What you get

- **Mods manager.** Enable and disable mods, see conflicts between mods that replace the same game file, compare the conflicting copies (identical, different settings, different textures, different lines) and switch one off. Mods that FiveM will not load are flagged with the reason.
- **Texture editor.** Replace from PNG, JPG, WEBP, TGA or DDS, recolour (hue, saturation, brightness, contrast, tint), rename, add, delete and resize. Export a whole dictionary to a folder and re-import every file whose name matches. DXT1/3/5, BC4/5/7 and uncompressed formats with the game's own mip layout.
- **Embedded textures.** Textures inside `.ydr`, `.ydd`, `.yft` and `.ypt` are edited in place and can be resized; the resource page map is rewritten so the game still finds them.
- **Visual settings.** `visualsettings.dat` grouped by topic with colour pickers and presets for damage overlay, kill effect, coronas, vehicle lights, distant lights, sky, rain and more. Line order, comments and duplicate keys are preserved.
- **Particle effects (`.ypt`).** Every effect, emitter and particle rule with its colour, size, light and spawn-rate keyframes. Search (`blood`, `muz_pistol`) and apply hue shift, tint, size, light and density changes to all results in one undoable step.
- **3D view.** Models and collision meshes (`.ybn`) in 3D. Click a part to select its texture; edits show up immediately. Export to OBJ with textures. Model gallery with empty-model detection for optimisation packs.
- **Pause map and radar editor.** Place photos, logos and text on the ESC map by game coordinates, rotate and scale them, bake them into the tiles and undo the bake to get the layers back. Only the tiles a layer touches are re-encoded.
- **Scaleform UI (`.gfx`).** View, replace and export the images embedded in HUD and minimap files, and see which game textures the UI pulls in.
- **Meta files.** `.ymt`, `.ymap`, `.ytyp` shown as XML and written back to binary after editing.
- **AI assistant (optional).** Describe the change ("make the blood green", "write the server name on Legion Square") and it uses the same tools. Works with Claude, OpenAI, Gemini, Groq, OpenRouter, Ollama or any OpenAI-compatible endpoint you configure.
- **Quality of life.** Ctrl+P command palette, recent files, content search across textures, settings and text, undo and redo for every operation, new mod packages from scratch and one-click install into the mods folder.

| | |
| --- | --- |
| ![Pause map editor](docs/ekran/harita-duzenleyici.png) | ![3D view with texture panel](docs/ekran/3b-doku-paneli.png) |
| ![Particle effect editor](docs/ekran/ypt-efekt-ayarlari.png) | ![Scaleform UI images](docs/ekran/gfx-arayuz.png) |
| ![Model gallery](docs/ekran/model-galerisi.png) | ![Conflict comparison](docs/ekran/cakisma.png) |

## Quick start

### Install

1. Download `tlk-rpf_<version>_x64-setup.exe` from the [latest release](https://github.com/Talkdedsec/tlk-rpf/releases/latest). A portable `tlk-rpf.exe` is attached as well.
2. Check the file against `SHA256SUMS.txt` (see [Release information](#release-information)).
3. Run the installer. It installs for the current user only and needs no administrator rights. The binary is not code-signed, so SmartScreen may ask for confirmation.

### Run

1. Start fltr-rpf. It finds the FiveM mods folder automatically; the pencil icon next to *Mods klasÃ¶rÃ¼* picks another folder.
2. Click a mod on the left. The overview shows problems first, then presets, textures, models and the package mapping.
3. Edit, then press **Ctrl+S**. The previous file goes to the backup folder first. Close FiveM before saving; fltr-rpf refuses to overwrite a file the game has open.

| Shortcut | Action |
| --- | --- |
| Ctrl+P | Command palette: files, mods, tabs, actions |
| Ctrl+S / Ctrl+Shift+S | Save / save as |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+K | AI assistant |
| Ctrl+O | Open an `.rpf` |
| F2 | Rename the selected file |

### Build from source

Requirements: Windows 10/11 x64, Rust 1.88 or newer (edition 2024), Node.js 22 or newer, and the WebView2 runtime.

```text
git clone https://github.com/Talkdedsec/tlk-rpf.git
cd tlk-rpf
npm ci
npm run tauri build          # installer in target/release/bundle/nsis/
npm run tauri dev            # development build with hot reload
cargo test -p fltr-rpf-core   # core tests
cargo run -p fltr-rpf-core --example kirici   # feeds truncated and corrupted files to every parser
```

Tests that need real mod files look for `testdata/*.rpf`. Those files are not in the repository; copy a few mods from your own mods folder there to run the full suite. Without them the file-based tests are skipped and the rest still run.

## Trust and privacy

- **Network.** Nothing leaves the machine unless you configure an AI provider. Then only your request and the file excerpts the assistant reads go to that provider. Requests to non-Anthropic providers are sent from the Rust side and are limited to `https://` and `localhost` addresses. There is no telemetry and no update check.
- **Local state.** Settings: `%APPDATA%\com.talkdedsec.tlkrpf\ayarlar.json`. AI keys are kept in Windows Credential Manager (entries named `tlk-rpf`), not in that file; keys saved in plain text by 1.0.0 move there the first time 1.1.0 starts. Backups: `%APPDATA%\com.talkdedsec.tlkrpf\yedek\`, the last 20 per file. Each backup records the full path it came from, so two mods with the same file name (every dlcpack has a `dlc.rpf`) keep separate backups and are restored to the right place. Temporary map layer images: `%LOCALAPPDATA%\com.talkdedsec.tlkrpf\`.
- **Writes.** Every save writes to a temporary file, re-reads it as an archive, backs up the original and then replaces it atomically. Encrypted archives are never written.
- **Permissions.** Runs as the current user. The installer does not need administrator rights.
- **Security reports.** See [SECURITY.md](SECURITY.md).

## Compatibility

| Environment | Support |
| --- | --- |
| Windows 11 x64 | Supported, tested |
| Windows 10 x64 | Supported (needs the WebView2 runtime) |
| macOS, Linux | Not supported |
| RPF7 `OPEN`, `CFXP` | Read and write |
| RPF7 `NG`, `AES` | Detected and reported, not opened |
| `.ytd` | Full: view, replace, recolour, rename, add, delete, resize, PNG/DDS export |
| `.ydr` `.ydd` `.yft` | 3D view, embedded texture editing and resizing, OBJ export |
| `.ypt` | Effect, emitter and particle keyframes; embedded textures |
| `.gfx` | Embedded images: view, replace, export |
| `.ybn` | 3D view by surface material |
| `.ymap` | Entity placement in 3D (read-only), XML editing |
| `.ymt` `.ytyp` `.ymf` | XML editing with binary write-back |
| `visualsettings.dat` | Grouped editor, colours, presets |
| `.xml` `.meta` `.dat` `.txt` `.lua` | Text editor |
| `.awc` `.ycd` `.gxt2` | Shown as binary |

## How it works

| Area | Location | Responsibility |
| --- | --- | --- |
| Archive | `core/src/rpf.rs` | RPF7 table, lazy file data, rebuild with 512-byte alignment, resources over 16 MB |
| Resources | `core/src/rsc.rs` | RSC7 pages and flags, pointer resolution, section growth with page map update |
| Textures | `core/src/ytd.rs`, `core/src/doku.rs` | Texture dictionaries in `.ytd` and inside models and effects, the game's mip layout, BC encoding |
| Effects | `core/src/ypt.rs` | Particle rule, emitter and effect keyframes |
| UI files | `core/src/gfx.rs` | Scaleform/SWF tags and bitmaps |
| Map | `core/src/harita.rs` | Minimap tile layout and layer compositing |
| Packages | `core/src/oiv.rs`, `core/src/modlar.rs` | `assembly.xml`, mods folder scan, conflicts, backups |
| Settings | `core/src/vs.rs` | Line-preserving `visualsettings.dat` parser |
| Models and meta | `core/src/model.rs` | Model and collision meshes for 3D, meta/PSO XML (via rage-formats) |
| App shell | `src-tauri/src/lib.rs` | Commands, undo history, `tlk://` protocol for previews |
| Interface | `src/` | React editors, 3D (three.js), AI assistant |

Texture edits never re-layout a resource. Same-size replacements are written in place; a resize appends the new pixel data to the graphics section, which is merged into a single page so no existing structure crosses a page boundary, and the page counts in the resource's page map are updated.

## Known limitations

- **No in-game verification yet.** Saved archives, resized embedded textures, effect values and UI images are verified at the file level and with an independent parser (rage-formats), not inside FiveM. Test a change in game before relying on it.
- **Encrypted archives.** NG-encrypted inner archives (for example weapon sound packs using `RESIDENT.rpf`) cannot be opened, so audio mods are out of reach for now.
- **Audio.** `.awc` files are not decoded.
- **Embedded dictionaries.** Textures inside models and `.ypt` files can be replaced and resized but not added or removed.
- **Maps.** `.ymap` entities are shown in 3D but moved or removed only through XML.
- **Memory.** An opened archive is read into memory in full. Very large map packs (1â€“2 GB) need that much RAM.
- **Large resources.** Resources over 32 MB are recompressed at the default level for speed; such files grow by about 8 %.
- **Unsigned binary.** Windows SmartScreen may warn on first run.
- **Language.** The interface is Turkish only.

## Release information

| Item | Where to verify |
| --- | --- |
| Version | [Releases](https://github.com/Talkdedsec/tlk-rpf/releases) and `src-tauri/tauri.conf.json` |
| Changes | [CHANGELOG.md](CHANGELOG.md) |
| Integrity | `SHA256SUMS.txt` attached to each release; check with `Get-FileHash .\tlk-rpf_1.2.0_x64-setup.exe -Algorithm SHA256` |
| Source | The release tag, for example `v1.2.0` |
| Build | Built locally with the commands under [Build from source](#build-from-source); CI builds every tag with the same commands |

## Project map

```text
fltr-rpf/
â”œâ”€â”€ core/                 Rust library: formats and editing
â”‚   â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ tests/            integration tests (real files from testdata/)
â”‚   â””â”€â”€ examples/         diagnostic and parser-breaking tools
â”œâ”€â”€ src-tauri/            desktop shell, commands, installer config
â”œâ”€â”€ src/                  React interface
â”œâ”€â”€ docs/ekran/           screenshots
â”œâ”€â”€ site/                 project website (GitHub Pages)
â”œâ”€â”€ testdata/             your own .rpf samples (not committed)
â””â”€â”€ .github/              CI, release, templates
```

## Roadmap

- [ ] Error boundary around every editor so a rendering failure never blanks the window
- [ ] Move the remaining synchronous commands off the UI thread
- [ ] End-to-end interface tests in the repository
- [ ] Logo and text layers on any texture, reusing the map layer engine
- [ ] Empty-model tools for optimisation packs and removal of unused embedded textures
- [ ] `timecycle_mods` editor and `.gxt2` text labels
- [ ] Select, move and delete `.ymap` entities in 3D
- [ ] NG archives and `.awc` audio, once a key source is decided

## Support

- **Bug:** [open an issue](https://github.com/Talkdedsec/tlk-rpf/issues/new/choose)
- **Security:** [SECURITY.md](SECURITY.md)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)

## License

Copyright (c) 2026 Talkdedsec.

fltr-rpf is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License, version 3, as published by the Free Software Foundation. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

In short: you may use, study, change and share it. If you distribute a modified version, you must release its source under the same license. Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

fltr-rpf is not affiliated with Rockstar Games, Take-Two Interactive or Cfx.re. Grand Theft Auto and FiveM are trademarks of their respective owners.
