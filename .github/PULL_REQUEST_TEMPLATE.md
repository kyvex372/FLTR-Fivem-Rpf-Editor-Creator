## What changes

<!-- One or two sentences. Why matters more than how. English or Turkish is fine. -->

## Checks

- [ ] `npx tsc --noEmit`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test -p fltr-rpf-core` (with real files in `testdata/`)
- [ ] If I touched a format, `cargo run -p fltr-rpf-core --example kirici` reports 0 crashes
- [ ] Every path that writes a user's file takes a backup and goes through a temporary file and an atomic rename

<!-- New format? Add a test to core/tests/gercek.rs that edits a real file, re-reads it
     and checks that the rest of the file is unchanged. -->
