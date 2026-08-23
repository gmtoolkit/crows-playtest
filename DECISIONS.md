# Decisions — crows-playtest

## 2026-08-23 — The rest gate, and three rulings from Cliff

**Decision:** Advancement is gated on a rest, reachable from both directions.

- A crow records `advancement.txpAtLastRest` whenever it finishes a rest.
- Finishing a rest offers the advancement screen if anything is owed.
- Opening advancement or the trait browser with XP earned since the last rest
  warns, names the exact amount, spells out what a rest will do, and offers to
  finish one there and then. Cancel and the screen does not open.

**Why:** "You can only spend XP or gain bonuses from TXP when you finish a rest
after earning the XP" (C p6). Nothing enforced that, and nothing pointed at the
rest as the moment to spend — bonuses had sat unspendable on the sheet for
months.

The rule is about ORDER, not about having rested at all: the XP must predate
the rest. A boolean "has rested" cannot express that, so the rest stamps the
TXP it settles and anything above that mark has not been slept on. `-1` means
never recorded and reports no debt, so a crow that predates this bookkeeping is
assumed caught up rather than retroactively locked out.

Cliff asked for this shape specifically: "when someone takes the rest prompt the
wizard to spend the points. when someone clicks into those areas warn that it
will trigger rest." Offering the rest rather than refusing is the point — a
player who opened the advancement screen has already decided they want to
spend, and making them close it, find Rest and come back teaches nothing. But a
rest is a real event (Stamina refills, a wound closes, expertise uses return,
Prepare for Task expires) so it asks first, and asks the Miasma question the
same way the Rest button does rather than quietly assuming shelter.

**Three rulings recorded where the code will need them:**

1. **The hybrid bonus ships as printed** (1 use + 1 Stamina), even though it is
   strictly the worst pick against 3 uses or 2 Stamina and looks like a number
   edited down. Raised on the playtest survey instead of silently fixed.
   Recorded in `config.mjs` at `expertiseBonusOptions`.
2. **Replacement crows get full catch-up.** C p7's "starts with XP equal to the
   lowest TXP of a crow already in the party" confers the advancement bonuses
   that TXP earns, not merely trait XP. The book says XP, not TXP, and never
   settles it. Recorded in `builder.mjs`.
3. **The raw expertise `uses` box becomes read-only for everyone** once the
   backgrounds pack ships and the builder can set starting uses. It exists
   today only because there is no other way to enter what a background granted.
   Recorded in `expertise-row.hbs`.

**Alternatives:** Gating the numbers themselves — computing bonuses from
settled TXP so unslept XP simply pays nothing — was rejected. It is arguably
more faithful, but it makes counts drop without explanation, which is the exact
failure the advancement work was fixing.

Resting silently when the player opens the screen was rejected: a rest
irreversibly changes wounds, Stamina and expertise uses.

**Consequences:** `rest()` now writes `system.advancement.txpAtLastRest`, so any
future caller of `rest()` settles XP as a side effect. Every door into
advancement must call `ensureRested` — there are two today (`buyTrait` and
`openAdvancement`), and a third that deliberately does not, the post-rest offer,
because a rest just happened.

**Also fixed this session:** advancement could raise a characteristic to 5. The
rules give two limits — the field's -5..5 range, and "the highest score a PC can
have in a characteristic without magic help is 4" (R p5) — and `pcCap: 4` was in
config but referenced nowhere. See the previous entry for the same class of bug
in CSS.

## 2026-08-23 — Training is a ledger, not a text box; and the blood is gone

**Decision:** Three things.

1. **Advancement bonuses are now claimed, not merely counted.** A new stored
   `system.advancement` ledger records every Expertise & Stamina bonus taken,
   which package was chosen, and WHERE its expertise uses landed. A new
   `AdvancementApp` is how a crow trains.
2. **The wound blood drip is removed** and is not coming back in CSS.
3. **`--crows-blood` is a colour again**, and a test enforces it.

**Why:**

Cliff asked "how does one train the expertise?" The honest answer was: you
typed a number into a box and nothing anywhere reacted. The Expertises tab
showed "Expertise & Stamina bonuses: 3" under a tooltip reading "still to
assign", but the number was recomputed from lifetime TXP on every prepare and
could not move. There was no assign.

The rules make this a real mechanic. Expertise uses are NOT bought with XP; XP
buys traits and nothing else. Uses arrive when TXP crosses a threshold and
hands you a bonus, and a bonus is one pick from three fixed packages: three
uses divided as you like, or +2 Stamina, or one use and +1 Stamina. The
per-expertise cap rises 2 -> 3 -> 4 with TXP. Characteristics are a separate
table that collides with the first at 5,000 and 30,000 TXP, where a crow
receives one of each.

The blood came out because it never looked like blood. Assembled from
radial-gradients it read as a divider artefact, and Cliff's judgement after
several passes was that more effort would not fix it. Recorded so nobody
rebuilds it the same way: replacing it means authored art, not shapes made of
gradients.

**Removing it fixed a real bug it had caused.** `_onRender` wrote a 0..1 wound
ratio into `--crows-blood`, which the palette already defines as `#9d2222`. A
custom property is one namespace shared by the stylesheet and every script
writing inline styles, and nothing warns when the two disagree — the property
just holds the last write and every rule reading it computes to garbage. The
worst casualty was `.wound-box.wounded`: the wound markers on the Slots tab
rendered TRANSPARENT from the first wound onwards, going blank at exactly the
moment they started to matter. The dead banner and the dungeon-turn bar lost
their fills with them. Verified in-world before and after: four wounded boxes
computed `rgba(0, 0, 0, 0)`, and now compute `rgb(157, 34, 34)`.

**Alternatives:**

*Storing the background's uses* was rejected: recording where each bonus's uses
land makes the background's own uses fall out as a subtraction, so there is no
second number to keep in sync and no migration for existing crows.

*Deriving Stamina as base + granted* was rejected because there is no base
field — `stamina.max` IS the field the background sets. The bonus writes into
it and undo subtracts, which is what the book's imperative ("increase your
Stamina maximum by 2") describes anyway.

*Letting a partial allocation through* was rejected. The budget must be spent
exactly: "gain three uses ... divided however you choose" is a grant, not a
ceiling, so leaving one unplaced silently loses it, and a lost use is worse
than a blocked button.

*Removing the raw `uses` input* was rejected while backgrounds are unmodelled —
a crow still needs its starting uses entered by hand. It is relabelled as an
import/Ref field.

**Consequences:**

- `system.advancement` is now BOTH stored and derived. `prepareDerivedData`
  must `Object.assign` onto it; assigning over it drops the ledger. The same
  namespace-collision that broke the wound markers applies here.
- The pre-100-TXP cap of 2 is NOT in the book. It is the only reading
  consistent with the text (no background exceeds 2 uses in one expertise, and
  2 is the cap for the whole first five bonuses), and it is flagged for the
  playtest survey. The previous code used 1, which would have made several
  printed backgrounds illegal on their own sheets.
- Undo is refused when an expertise no longer holds the uses a bonus granted,
  because subtracting anyway would silently rewrite the background's uses — the
  one number nothing else records.
- `test/style-tokens.test.mjs` fails if any script writes to a custom property
  the stylesheet declares as a colour. Mutation-tested: reintroducing the
  `--crows-blood` write fails it.
- The rules encoded here were researched from the PDFs and then adversarially
  re-checked; see the Activity Log entry for what the verification found.

## 2026-08-23 — The sheet's state readouts, and a drip that was a whole update behind

**Decision:** Three changes to how the crow sheet reports state.

1. An expertise row shows one reading, "left / trained", and its pips became
   the spend control: click a full pip to spend it, click a spent one to take
   it back. The separate `spent` number field is gone.
2. Advancement moved from the foot of the Expertises tab to a strip at its
   top, with XP available given the most weight.
3. The wound drip hangs off the tab bar instead of the header, with thicker
   droplets, and **no CSS transition**.

**Why:** Cliff could not tell what the two unlabelled number boxes on an
expertise row were, could not find advancement without scrolling past thirty
expertises, and read the drip as decoration.

The drip being unreadable turned out to be a real bug, not a styling
complaint. Both its height and opacity are `calc()`s over `--crows-blood`, and
Chrome transitions custom-property-derived values against the STALE variable:
the drip settled on the PREVIOUS wound count and stayed there. Measured
in-world — healing to 0 wounds left the 4-wound drip at 22.4px; then going to
7 wounds showed the healed 4px. It had never once shown the current state.

**Alternatives:** Labelling the two number boxes was the smaller change, but
`spent` is a play-time counter and `uses` an advancement stat; they only sat
side by side because both were numbers. Folding `spent` into the pips removed
the question instead of answering it, and dropped the row to one line, which
is what let the columns stay tight.

Keeping the transition and forcing a reflow was possible, but the drip is
redrawn on a sheet re-render anyway, so there is no animation worth the
fragility.

**Consequences:** The drip now depends on `.window-content > nav.sheet-tabs`,
Foundry's generic tab navigation — if that markup changes, the selector goes
with it. Note it carries no `data-group` attribute despite the tabs being a
named group, which is why the first selector missed. Any future `calc()` over
a live custom property on this sheet must stay untransitioned.

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
