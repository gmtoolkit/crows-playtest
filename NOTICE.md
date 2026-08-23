# Notice — unofficial fan content

**Crows** is a roleplaying game by **MCDM Productions LLC**, game director James
Introcaso. Its rules, setting (Cornath), monsters, equipment, and artwork are
© 2026 MCDM Productions LLC.

This repository is an **unofficial, non-commercial, fan-made** Foundry VTT
system built against the *Crows Public Playtest 2 (August–September 2026)*
packet. It is **not published, endorsed, or approved by MCDM Productions**.

- It is and will remain **free of charge**. Nobody may sell it, bundle it into a
  paid product, or put it behind a paywall.
- The Blood Library maps are by **The MAD Cartographer**, credited in the
  playtest packet.
- If MCDM asks for any part of this to be taken down, it comes down. Open an
  issue, or contact the repository owner directly.

## How the content is separated

The **code** (everything under `src/`, `tools/`, `styles/`, `templates/`) is
original work by this repository's author and is MIT licensed — see `LICENSE`.

The **game content** (compendium sources under `packs-src/` and art under
`assets/`) is MCDM's, reproduced here only to make the playtest playable on
Foundry VTT. It is confined to those two directories precisely so that a
takedown request is satisfied by deleting them, with the system code left
intact and usable by anyone who owns the playtest packet.

`tools/extract-*.mjs` regenerates `packs-src/` from a local copy of the official
playtest PDFs, so the system remains buildable from source you supply yourself.
