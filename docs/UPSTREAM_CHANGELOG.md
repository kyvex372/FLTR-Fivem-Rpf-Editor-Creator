# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-10-11

First public release. Versions before 1.2.0 were distributed privately; their notes
are kept in CHANGELOG.md for reference.

### Changed

- tlk-rpf is now free software under the GNU General Public License v3.0 only.
- Project website: <https://talkdedsec.github.io/tlk-rpf/>.

### Fixed

- An archive cut short inside the data of an uncompressed file no longer opens as if
  that file were simply shorter. Saving it would have made the loss permanent. Only the
  trailing padding of a nested `.rpf` is still tolerated (the case fixed in 1.1.1).
- A crafted directory table that lists the same entry twice or nests directories
  hundreds of levels deep is rejected instead of exhausting memory or the stack. A nested
  archive of 4 to 7 bytes no longer panics.
- *Mods'a kur* and *save as* refuse to overwrite a mod that is open in another tab with
  unsaved changes, and refresh it when it has none.
- Opening the same file twice with a different letter case or slash direction focuses
  the open tab instead of creating a second copy that could overwrite the first.
- An operation that fails no longer clears the redo history.

## [1.1.1] - 2026-10-10

### Fixed

- Archives whose last 512-byte block was cut short by another tool open again. FiveM loads them, but tlk-rpf refused them with "arşivin dışına taşıyor" (seen on a blood effect mod whose nested `gta5.rpf` was 13 bytes short). Only the zero padding of uncompressed data is tolerated; a cut into compressed data is still an error. Saving writes the archive back at its full size.

## [1.1.0] - 2026-10-10

### Fixed

- Backups of files with the same name no longer overwrite or rotate out each other. Every dlcpack has a `dlc.rpf`; saving one could delete the backups of another, and restoring suggested the first mod with that name. Backups now record the full path they came from, are kept 20 per file and restore to that path. Older backups still list; when their name matches more than one mod, the app asks where to restore.
- Two saves within the same second no longer share one backup file, which could lose the earlier version.
- The backup list shows when each backup was taken; before, it showed the mod's own modification date.

### Changed

- AI keys are kept in Windows Credential Manager instead of `ayarlar.json`. Keys saved by 1.0.0 move there on first start.
- AI: Claude Opus 5.5 is the default model, and Claude Sonnet 5.5 and Claude Haiku 5.5 are in the list. Refused requests fall back to another model on Opus 5.5, Opus 5, Fable 5.1 and Sonnet 5.5. Current models run with high effort for multi-step edits.

## [1.0.0] - 2026-09-27

First release.

### Archives and packages

- RPF7 reading and writing for `OPEN` and `CFXP` archives, nested archives, resources over 16 MB; saving compacts dead space left by other tools.
- `assembly.xml` parsing that tolerates the malformed files real mods ship with; repair of mappings that point at renamed files; removal of dead lines; targeted file add.
- FiveM load checks: encryption, missing `assembly.xml`, sources missing from the package.

### Mods manager

- Enable and disable mods, conflict detection, conflict comparison (identical, different settings, textures or lines) with one-click disable.
- Batch compaction of bloated mods, backups before every write (last 20 per mod) and restore.
- New mod packages from scratch and one-click install into the mods folder.

### Editors

- Textures: replace, recolour, rename, add, delete, resize, PNG and DDS export, folder export and folder re-import by name; the game's own mip layout.
- Embedded textures in `.ydr`, `.ydd`, `.yft` and `.ypt`: in-place editing and resizing with page map updates.
- `visualsettings.dat` grouped editor with colour pickers and presets; line order and comments preserved.
- Particle effects: effect, emitter and particle rule keyframes; batch hue, tint, size, light and density changes.
- Scaleform `.gfx`: embedded image view, replace and export; list of textures pulled from the game.
- Meta files (`.ymt`, `.ymap`, `.ytyp`) as XML with binary write-back; text editor for XML, meta and data files.

### 3D and maps

- 3D view for models and collision meshes, click-to-select textures, OBJ export with textures, model gallery with empty-model detection.
- `.ymap` entity placement view.
- Pause map and radar editor: photo, logo and text layers placed by game coordinates, layer history, bake to tiles with undo that restores the layers, recolouring.

### Assistant and navigation

- AI assistant with Claude, OpenAI, Gemini, Groq, OpenRouter, Ollama and custom OpenAI-compatible providers; token budgets, retries and tool selection for small budgets; tools for settings, textures, effects, maps, UI files and new packages.
- Ctrl+P command palette, recent files, content search, undo and redo for every operation.

### Reliability

- Parser fuzzing tool (`cargo run -p tlk-rpf-core --example kirici`); a crash on malformed `assembly.xml` with multi-byte characters was found and fixed.
- Release builds unwind on panic so a failed request does not take unsaved work with it.
- A document undone back to its saved state is no longer reported as modified.

[Unreleased]: https://github.com/Talkdedsec/tlk-rpf/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Talkdedsec/tlk-rpf/releases/tag/v1.2.0
