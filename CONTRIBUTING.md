# Contributing

Bug reports, fixes and new format support are welcome. Keep a change small and focused;
for anything larger than a fix, open an issue first so the shape is agreed before the
code is written.

fltr-rpf is licensed under the GNU General Public License v3.0 only. By opening a pull
request you agree that your contribution is released under the same license. Everyone
taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

```text
npm ci
npm run tauri dev
```

Windows 10/11 x64, Rust 1.88+, Node.js 22+.

## Before you open a pull request

```text
npx tsc --noEmit
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p fltr-rpf-core
cargo run -p fltr-rpf-core --example kirici
```

CI runs the first three on every push. The last one feeds truncated and corrupted
files to every parser; run it whenever you touch a format in `core/src/`. It needs
real archives in `testdata/`.

Real mod archives do not belong in the repository. Put them in `testdata/` locally;
`testdata/*.rpf` is ignored by git and the file-based tests skip when it is empty.
Every `.rpf` there goes through the round-trip tests; a few tests look for a specific
name and skip when it is missing:

| File | What it should contain |
| --- | --- |
| `grafik-paketi.rpf` | A graphics pack with `visualsettings.dat` and a `.ytd` |
| `model-paketi.rpf` | `.ydr` models with embedded textures |
| `efekt-paketi.rpf` | A particle dictionary (`.ypt`) |
| `minimap.rpf` | A minimap UI mod with a `.gfx` |

## Rules the code follows

- Never write to a user's archive without a backup, and always through a temporary file
  and an atomic rename.
- Never write to an encrypted (NG or AES) archive.
- Leave untouched bytes and lines as they were: `visualsettings.dat` keeps its line
  order, comments and duplicate keys; textures are rewritten in place where the size
  allows.
- A new format goes in `core/src/` with a test in `core/tests/gercek.rs` that edits a
  real file, re-reads it and checks that the rest of the file is unchanged.
- Code and identifiers are Turkish, matching the existing code.
