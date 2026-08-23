# crows-playtest

## Project Overview

An unofficial Foundry VTT **game system** (not a module) for [Crows](https://mcdm.gg), MCDM's survival-horror dungeon-crawling RPG, built against the **Public Playtest 2** packet (August–September 2026). Free fan content, not affiliated with or endorsed by MCDM Productions (see `NOTICE.md`).

It's a system rather than a module because Crows doesn't map onto any existing d20 actor data: 2d10 + characteristic resolved into three tiers (≤11 / 12–16 / 17+) with crits/dooms read off the raw dice; edges and banes that are a flat ±2 alone but a tier shift in pairs; layered vitality where Armor Defense depletes per item, then Stamina, and only then wounds appear — each wound occupying one of ten backpack slots, so filling all ten is death; d6 usage-dice pools (torches, spellbooks, ongoing spells); and 30-real-minute dungeon turns ending in a usage-dice roll and encounter check. All of that needs its own DataModels and sheets.

Status as of the last commit: the power-roll engine, damage cascade, dungeon-turn engine, and side-based initiative are done and verified in actual play; actor/item data models, the crow sheet, and creature sheet are built; the creatures compendium (71 stat blocks) and traits compendium (276 traits) are done. Gear/weapons/armor/spellbook compendia, backgrounds/traits-linked content, dungeon journals, overland travel, and the village/crafting economy are not yet built. Repo history shows it was split into a system package plus a separate `adventure/` module and moved to the `gmtoolkit` org (commit "Split into system + adventure module; move repo to gmtoolkit").

## Layout

- `src/` — system code.
  - `config.mjs` — every enum, table, and threshold, annotated with rulebook page references.
  - `data/` — Foundry DataModels for actors (`actor-crow.mjs`, `actor-creature.mjs`) and items (gear, weapon, armor, spellbook, trait, background, attack, feature).
  - `dice/` — `tiers.mjs` is pure rules math (no Foundry globals, unit tested); `power-roll.mjs` is the Foundry wiring (dice, dialogs, chat cards).
  - `system/` — `damage-math.mjs` is pure damage/wound/rest math (unit tested); `advancement.mjs`, `combat.mjs`, `dungeon-turn.mjs`, `slots.mjs`, `settings.mjs`, `handlebars.mjs` are the Foundry-facing engine pieces.
  - `apps/` — ApplicationV2 sheets and dialogs: crow sheet, creature sheet, character builder wizard, advancement screen, trait-tree browser, rest gate, item sheet, token controls.
  - `documents/` — Actor and Item document subclasses.
- `packs-src/` — compendium sources (JSON), generated from the official playtest PDFs via `npm run extract` (requires your own copy of the PDF packet).
- `packs/` — compiled compendium packs built from `packs-src/` via `npm run packs`.
- `test/` — `node --test` suites over the pure modules (`tiers`, `damage`, `damage-parse`, `advancement`, `slots`, `lang`, `style-tokens`).
- `tools/` — PDF extraction, art conversion, scene building, pack building, and local deploy scripts.
- `adventure/` — a separate Foundry **module** (own `module.json`, `LICENSE`, `NOTICE.md`) carrying adventure-specific content: scenes, maps, and location assets, with its own `packs/` and `packs-src/`.
- `dist/` — Vite build output (`crows.mjs`, `crows.css`) referenced by `system.json`'s `esmodules`/`styles`; produced by `npm run build`, not hand-edited.
- `lang/en.json` — Foundry localization strings.
- `system.json` — the Foundry system manifest (id `crows`, compatible with Foundry v14, verified against 14.365).
- `DECISIONS.md` — this repo's own decision log (Decision / Why / Alternatives / Consequences format), newest entry first.
- `LICENSE`, `NOTICE.md` — code is MIT; game content is © MCDM Productions and is explicitly not covered by the code license.

## Conventions

- **Pure logic is split from Foundry wiring on purpose.** Anything with a number in it (`tiers.mjs`, `damage-math.mjs`) has no Foundry globals, so `node --test` can exercise the rules without booting Foundry. Foundry-specific concerns (dice rolls, dialogs, chat cards, sheets) live in separate files that call into the pure modules.
- **`config.mjs` is the single source for rules constants**, each annotated with a rulebook page reference, rather than magic numbers scattered through the engine.
- **This repo keeps its own decision log**, `DECISIONS.md` at the root, newest first, in Decision / Why / Alternatives considered / Consequences format (per the 2026-08-23 rest-gate entry). It's public and meant to stand alone, so judgment calls made here are recorded here rather than in the vault's decision log.
- **`npm run deploy` copies the build into the local Foundry data directory instead of symlinking**, deliberately: `classic-level` can't open a LevelDB compendium through a Windows directory junction, and packs silently fail to load if you try.
- **Compendium content is regenerated from the official playtest PDFs**, not hand-authored from scratch (`npm run extract` against a local copy of the PDF packet). Hand-authored exceptions, like specific scenes' walls/doors/lights, get exported back into the module afterward rather than edited in the source JSON directly.
