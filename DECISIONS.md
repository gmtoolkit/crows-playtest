# Decisions — crows-playtest

Newest first.

## 2026-08-22 — Standalone system, not a module on an existing one

**Decision:** Ship a Foundry v14 **system** (`crows`) with its own DataModels
and ApplicationV2 sheets, rather than a module layered on Simple Worldbuilding
or on MCDM's Draw Steel system.

**Why:** Crows' actor model has no analogue in an existing system —
characteristics on a −5..5 scale, Armor Defense as a depleting per-item pool,
Stamina, and wounds that occupy backpack inventory slots. On Simple
Worldbuilding all of that becomes untyped flags, which kills the slot grid and
the automation. Draw Steel shares the 2d10 tier chassis (and is worth reading
for its roll code), but its actor schema is built around classes, kits, and
heroic resources that Crows does not have, so extending it would mean fighting
its data model on every field.

**Alternatives:** Simple Worldbuilding module (rejected: no typed data, shallow
automation); Draw Steel extension (rejected: schema mismatch, though its power
roll implementation is a useful reference).

**Consequences:** More work up front, and worlds are locked to this system. In
exchange the slot inventory, wound-slot interaction, and tier automation are all
first-class. Content ships as compendium packs inside the same repo.

## 2026-08-22 — The inventory sheet IS the character sheet

**Decision:** The crow sheet is built around a card-slot grid mirroring MCDM's
printed inventory sheet (2 hand / 4 belt / 10 backpack, with a wound checkbox on
every backpack slot), with a thin stat header above it. Wounds are stored as a
ten-element array indexed by backpack slot, not as a counter.

**Why:** The only sheet MCDM ships in the packet is
`01 Crows Inventory Sheet for Playtest 2.pdf`, and it contains no stat block at
all — just slots, each backpack slot carrying its own `Wound ( )` checkbox. The
Characters book tells players to "record your background's statistics on a piece
of paper with a pencil". Wounds and cargo competing for the same ten slots is
the game's central tension, so the data model has to represent slot identity,
not just wound count. Cliff identified this independently.

**Consequences:** Items store their own `carried: {container, index}` rather
than the actor holding a slot map, so deleting an item cannot orphan a slot.
Multi-slot items need contiguity validation. Wound placement has to be
automated with a sane default (empty slots first) but stay user-editable.

## 2026-08-22 — Pure rules math kept free of Foundry globals

**Decision:** `src/dice/tiers.mjs` and `src/system/damage-math.mjs` contain the
rules arithmetic and import nothing from Foundry. The Foundry-facing modules
wrap them.

**Why:** Every rule with a number in it can then be exercised by `node --test`
without booting Foundry, which is the difference between testing the tier
bands and hoping. 75 tests cover the tier boundaries, the full edge/bane
cancellation table, crit/doom precedence, the damage cascade, and rest
recovery.

**Consequences:** Two modules per subsystem instead of one. Anything in the pure
modules that reaches for `game`, `CONFIG`, `Roll`, or `ui` breaks the tests
immediately, which is the intended pressure.

## 2026-08-22 — Encounter number direction documented and tested

**Decision:** `resolveEncounterCheck(face, en)` fires when `face >= en`, and a
dedicated test asserts that a *higher* EN is *safer*.

**Why:** The name reads backwards. Seclude Camp and Scout for Danger both
*raise* the EN to make the party safer, while a crowded dungeon *lowers* it to 8
or 7 to make encounters more likely. This is the single easiest rule in the
system to implement inverted, and inverting it would silently make the whole
dungeon-turn loop wrong in a way that still "works".

**Consequences:** Mutation-checked: inverting the comparison fails 5 tests.

## 2026-08-22 — Wound speed penalty is ambiguous; strict reading is the default

**Decision:** "For each slot occupied by a wound and an item, your speed is
reduced by 1" (R p12) is implemented as *both* — only slots holding a wound AND
cargo cost speed. A `woundSpeedRule` setting exposes the looser reading.

**Why:** The sentence parses two ways. Under the loose reading (every wound or
every item costs 1), a starting crow with speed 5 hits speed 0 the moment they
pack six items, before taking any damage — clearly not intended. The strict
reading also gives the wound-placement choice its meaning.

**Consequences:** Flagged for Cliff to raise in the MCDM feedback survey, since
the wording is worth reporting regardless of which reading is intended.

## 2026-08-22 — Content isolated to packs-src/ and assets/ for takedown safety

**Decision:** All MCDM-derived content lives under `packs-src/` and `assets/`.
Code is MIT; those two directories are not.

**Why:** The repo is public and the playtest packet carries no license grant.
Cliff is contacting MCDM directly and will take it down on request. Confining
the content means a takedown is `rm -rf packs-src assets` with the system still
buildable by anyone who owns the packet, rather than a repo deletion.

**Consequences:** `tools/extract-*.mjs` must stay able to regenerate
`packs-src/` from a local copy of the PDFs. Raw extracted text is gitignored so
the repo never carries a verbatim dump of the books.
