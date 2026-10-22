# Security policy

tlk-rpf opens archives that come from strangers on the internet. A file that makes it
write outside the chosen archive, run code, leak an API key or corrupt a mod it was not
asked to touch is a security bug. Please do not report one in a public place.

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/Talkdedsec/tlk-rpf/security/advisories/new)
on GitHub, or mail **talkdedsec@proton.me** with `tlk-rpf` in the subject. Include the
version, the file that triggers the problem (or how to build it) and what happened.

You get an acknowledgement within 72 hours and an assessment within 7 days. A fix, if
warranted, ships in a patch release and you are credited in the changelog unless you ask
otherwise.

## In scope

- A crafted `.rpf`, resource or `assembly.xml` that crashes the app, hangs it, or makes it
  read or write files outside the archive being edited.
- Path traversal through archive entry names, mod file names or export targets.
- Anything that sends the configured AI key or file contents somewhere other than the
  provider you set up.
- Saving over a mod without a backup, or writing to an encrypted archive.

## Out of scope

- Changes that load fine in tlk-rpf but look wrong in game. Open an issue instead.
- Reading the AI keys stored in Windows Credential Manager from your own Windows session;
  any program running as you can do that.
- Findings that require an attacker who already controls your Windows account.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.2.x | Yes |
| < 1.2 | No |
