# Crows for Foundry VTT

An unofficial Foundry VTT **game system** for [Crows](https://mcdm.gg), MCDM's
survival-horror dungeon-crawling RPG, built against the **Public Playtest 2**
packet (August–September 2026).

> Free fan content, not affiliated with or endorsed by MCDM Productions.
> See [NOTICE.md](NOTICE.md).

## Why a system and not a module

Crows does not fit any existing Foundry system. It has:

- **2d10 + characteristic** resolved into three tiers (≤11 / 12–16 / 17+), with
  crits and dooms read off the raw dice so they override edges and banes.
- **Edges and banes** that are a flat ±2 alone but a *tier shift* in pairs.
- **Layered vitality**: Armor Defense depletes per item, then Stamina, and only
  then do wounds appear — one per point of damage.
- **Wounds that occupy inventory slots.** Fill all ten backpack slots with
  wounds and you die. A wound sharing a slot with cargo costs you speed.
- **Usage dice**: d6 pools where each die showing 1–2 is removed, tracking
  torches, spellbooks, and ongoing spells.
- **Dungeon turns**: 30 minutes of *real* time, ending in a usage-dice roll and
  an encounter check.

None of that maps onto d20 actor data, so this is a system with its own data
models and sheets.

## Status

Early. The rules engine and data models exist and are tested; sheets and
compendium content are in progress.

| Area | State |
|---|---|
| Power roll (tiers, edges/banes, crit/doom, expertise) | Done, 46 tests |
| Damage cascade (AD → Stamina → wounds), rest recovery | Done, 29 tests |
| Actor + item data models | Done |
| Character sheet (slot grid) | In progress |
| Compendium content (backgrounds, traits, gear, monsters) | In progress |
| Dungeon-turn engine | In progress |
| Maps and scenes | In progress |

## Requirements

- Foundry VTT **v14** (developed against 14.365)

## Install

Paste this manifest URL into Foundry's *Install System* dialog:

```
https://github.com/cliffcolvin/crows-playtest/releases/latest/download/system.json
```

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run deploy
```

`npm run deploy` builds the bundle, compiles the compendium packs, and copies
the result into your local Foundry data directory. It **copies rather than
symlinks** on purpose: `classic-level` cannot open a LevelDB through a Windows
directory junction, and the compendium packs silently fail to load if you try.

### Rebuilding content from the PDFs

The compendium sources under `packs-src/` are generated from the official
playtest PDFs. To regenerate them you need your own copy of the packet:

```bash
npm run extract -- --src "/path/to/MCDM Crows Public Playtest August-Sept 2026"
```

### Layout

```
src/
  config.mjs        every enum, table, and threshold, with book page refs
  data/             DataModels for actors and items
  dice/
    tiers.mjs       pure rules math (no Foundry globals) — unit tested
    power-roll.mjs  Foundry wiring: dice, dialogs, chat cards
  system/
    damage-math.mjs pure damage/wound/rest math — unit tested
  apps/             ApplicationV2 sheets
tools/              extraction, pack building, scene building, deploy
packs-src/          compendium sources (JSON)
test/               node:test suites over the pure modules
```

The pure/`Foundry` split is deliberate: every rule with a number in it lives in
a module that `node --test` can exercise without booting Foundry.

## License

Code is MIT ([LICENSE](LICENSE)). Game content is © MCDM Productions and is not
covered by that license — see [NOTICE.md](NOTICE.md).
