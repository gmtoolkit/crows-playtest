---
tags: [crows, foundry, playtest, gap-analysis]
created: 2026-08-23
source: MCDM Crows Public Playtest 2 (Aug-Sept 2026)
repo: github.com/gmtoolkit/crows-playtest
---

# Crows Foundry system — mechanics gap analysis

What the four playtest books contain, against what the system implements.

Produced 2026-08-23 by reading all four books end to end (Rules 37pp,
Characters 55pp, Ref 38pp, Dungeons 19pp) and auditing the codebase, then
cross-referencing. Page cites are to the playtest books:
**R** = Rules, **C** = Characters, **F** = Ref, **D** = Dungeons.

State at the time: 519 compendium documents, 278 tests green, commit `ad28501`.

# CROWS Foundry — gap list against the four books

Answering: "what else do we need, any hexcrawl menu, any dungeon play menus?"

---

## 1. ALREADY DONE (do not rebuild)

- 2d10 tiers, crit ≥19 / doom ≤3 read off raw dice, override the tier (R p6-7).
- Edge/bane counting with cancellation and the double = tier-shift rule (R p7).
- Post-roll expertise spend, +1 tier, refused on doom and at tier 3, decrements uses (R p8).
- Situational modifier panel with 13 named modifiers, page cites, detected vs judgement split (R p16-20).
- Canvas detection: light level at the target square, elevation, wall-collision cover, statuses.
- Damage cascade AD → Stamina → wounds, piercing skipping AD, per-armor-item AD spend (R p12).
- Wounds placed into named backpack slots, wound+cargo speed penalty, death at all slots wounded (R p12).
- Monster-vs-human death rule, optional knockout leaving 1 Stamina (R p12).
- Usage dice pool, 1s and 2s removed, per-cast spellbook UD skipped on a crit (R p13, p31).
- Chaos roll 1d6 on non-doom tier 1 castings, doom always backlashes (R p31).
- Real-time 30-minute dungeon turn HUD, UD → encounter check → advance in the printed order (R p13-14).
- Encounter check with the inverted EN semantics, 10 = immediate (R p14).
- Side-based initiative, one 1d10 per round, rerolled every round (R p18).
- Slot legality: contiguous, one container, no hand stacking; Draw From Pack 1d10 (R p10-11).
- Magic-slot overload = 1d6 wounds per DT (R p11).
- Carried light source drives token light, killed when UD run out (R p15-16).
- Rest: full Stamina, 1 wound, expertise reset, Miasma withholding, rest-restore UD (R p14-15, p27).
- Full advancement: both TXP tracks, per-expertise caps, rest gate as an ordering, undo ledger (C p6-7).
- Trait trees, all 23, with prerequisite connectors and strand-safe refunds (C p7-30).
- Character creation from the real 2d6 background table, kit resolution, 3d6 gold (C p1-6).
- Treasure → XP split with exclusions and threshold announcements (C p6).
- Equipment browsing/purchase gates, typed refusals (C p32, p45).
- 519 content documents: 36 backgrounds, 276 traits, 71 creatures + 195 embedded items, 82 gear, 23 weapons, 4 armor, 27 spellbooks, 7 scenes.

---

## 2. REAL GAPS, RANKED BY VALUE AT THE TABLE

### Rank 0 — code that exists and is not reachable (do these first, hours not days)
These are not gaps in design, they are unplugged wires. Every one is a live table failure.

| Thing | Page | State | Size |
|---|---|---|---|
| **Eat button** | R p16 | `actor.eat()` + `#onEat` exist, no `data-action="eat"` in any template. Starvation wounds are console-only. | tiny |
| **Repair Armor button** | R p15 | `item.repair()` + `#onRepairArmor` exist, no template action. Armor never comes back. | tiny |
| **Vulnerable extra 1d6** | R p12 | Registered status, `CROWS.vulnerableBonus` configured, `applyDamage` has no branch. The condition currently does nothing. | tiny |
| **Greed bonus** | R p13 | `greedMultiplier()` computed and shown in the HUD, `TreasureAward` never calls it. XP awarded is wrong on turns 1-3. | tiny |
| **Magic slot browsing** | R p11 | `Number(undefined)` = NaN, and `canPlace` short-circuits magic so `firstFit` always returns null. Clicking a magic slot silently stows to the backpack. | small |

### 1. Backlash table (R p32-35, 53 entries, d100 + rank) — GM — small (content)
`rollBacklash` is written, tested and wired; there is no RollTable pack, so every backlash in the game prints "no table". This fires on any doom cast and on 1-in-6 of every other failed cast, so it is a *per-session* dead end in the system's most dramatic moment. Highest value per hour of work in the whole list. Bonus: because inventory is genuinely modelled, the four card-shuffle backlashes (31-32, 33-34, 35-36, 79-80) can actually resolve as "pick a random carried item" instead of asking the table to shuffle a deck. Note the 61-62 / 62-64 numbering collision (R p34): pick one and comment the choice.

### 2. Rest screen and the seven rest activities (R p14-15) — both — medium
`CROWS.restActivities` has zero consumers. Every session ends here, and right now the rest button silently gives Stamina back and nothing else. Tend Wounds cannot be chosen even though `rest({woundsHealed})` accepts it; Prepare for Task writes a text box nobody reads; Identify and Seclude Camp do not exist; Craft is section 7. Rest is the single richest unimplemented *loop* in the game and the natural home for the Miasma roll, eating, and UD refresh.

### 3. Miasma rest cycle (R p27-28) — both — medium
Schema and config only. Missing: the end-of-rest 2d10+M per human, the cumulative cruelty penalty applied to that very roll, the `1d10 + cruelty` Effects table with its paired drawback/benefit, clearing all cruelty at tier 3 or by resting outside the Miasma, and the 13+ "character becomes an NPC" terminus. This is the campaign's signature ratchet and the reason the setting exists. `miasmaEffects[]` is rendered read-only and nothing ever writes to it, which is the tell. The rest-gate already asks the Miasma question, so the hook is in place.

### 4. Combat maneuvers and reactions (R p19-21) — both — medium
There is no maneuver UI anywhere. Grab, Escape Grab, Knockback and Taunt are printed tier tables identical in shape to attacks, so they reuse `resolvePowerRoll` and the situation panel directly. Counters (R p21: the missed melee attack, the failed escape, the doom upgrading to tier 3 damage) and opportunity attacks are the highest-frequency *forgotten* rules in play, because they fire on someone else's turn. A "reaction available" flag per creature per round, reset by the combat hook you already own, plus a counter button on the miss card, is most of the win. Also missing: `reactionsPerRound` from stat blocks (Ref Book p15: undead F has 3, undead G/H and the Ring Collector have 4).

### 5. Hidden and sneak — your actual question (R p10) — both — small
`hidden` is a registered condition and `detect.mjs` maps it onto `targetInvisible`, which gives the *attacker* a double bane. That is half the rule and the less important half. The printed rule is attacker-side: **while hidden from a creature you gain an edge on attacks against them, and they take a bane on RRs you impose**. Neither exists. Also missing: the half-speed-or-bane condition on sneaking past, the "you may only test to hide from a creature not currently observing you" gate, and auto-clearing `hidden` when you take aggressive action. Cost: one `selfHidden` edge entry in `MODIFIERS`, one bane entry keyed on the RR source, and a hook on attack rolls. This is a small, obviously correct win and it is the exact thing you noticed was missing.

### 6. Assist and group tests (R p9-10) — both — small
Assist is a pre-roll 2d10 producing -1 / +1 / +2 that expires in one combat turn, and group tests are just "everyone assists, the leader rolls". Three-line rules, used constantly, and group tests are the load-bearing mechanic for both the graveyard stealth check (D p18) and every travel role. Build assist as a chat card that hands its bonus to the next roll from the assisted actor.

### 7. Crafting loop (R p36, C p34, p39, p46) — player — medium
`resolveCraftingRoll` is fully implemented and tested with **no caller outside the test file**. `crafting.progress` is rendered read-only and never incremented. Missing: prerequisite check (expertise + uses + materials + tools), the progress track, the overflow-into-a-second-copy rule, multiple crafters pooling into one item, and the flat +4 substitution for double edge or expertise. Worth building because it is the main between-delve activity for half the trait trees, but it is second-order to surviving the dungeon.

### 8. Corpses, Harvest and parts (R p11, p15, p36) — both — small/medium
`item-gear.mjs` fully models corpses (slot cost derived from size, stack limits) and there are **zero corpse cards** and nothing creates a corpse when a creature dies. Harvest rolls dice and posts a message; it creates no parts item and does not consume the corpse. The interesting play here is entirely the slot pressure of dragging a Large corpse out (8 slots, R p11), which you already have the machinery for. Feeds crafting.

### 9. Overland travel / the hexcrawl (R p24-29) — both — large
Nothing exists. `travelPaces`, `travelRoles`, `hexMiles`, `paceSpeedAdjustments`, `hoursPerTurnOutsideDungeon` all have zero consumers. See section 3 for whether it deserves a screen. Ranked here rather than higher because it is only load-bearing if your campaign actually crawls hexes; if you play "Gadwick to the dungeon, montage", the Ref narrating a pace and rolling one d10 is fine.

### 10. Unarmed strike (R p20) — player — small
`unarmed` is a weapon group and an expertise, `CROWS.unarmedStrike` is configured, and `packs-src/weapons/` has zero unarmed cards. Every crow can do this and no crow can do it in the VTT. One card plus a fallback attack button.

### 11. Ranged range and friendly fire (R p20) — both — small
There is no range check anywhere in the attack pipeline; `longRangePenaltyPerSquare` is unused. Long shots at -2 per square, the bane for shooting an adjacent target, and the odd-die friendly-fire check on a miss near allies are all cheap given you already measure canvas distance for cover and elevation. Friendly fire in particular is the rule tables always forget and always enjoy.

### 12. Multi-target attacks (R p20) — both — medium
One roll, applied to every target, with per-target edges and banes shifting the tier per target. Your damage pipeline already resolves multiple recipients; the missing piece is re-evaluating the situation panel per target and rendering three different tiers on one card. Matters for the 7 attack spellbooks and every area monster feature (Ref p22).

### 13. Falling, suffocation, toppling, squeezing, surprise (R p16, p18, p23) — both — small each
All five are configured constants with no consumers. Each is a 5-line helper plus a button. Low individual frequency, but falling and surprise show up in both shipped dungeons (D p3, D p10, D p11). Batch them into one afternoon rather than treating them as five projects.

### 14. Identify Item and unidentified masking (R p37, D p1) — both — small/medium
`cardFields.identified` renders but nothing masks an unidentified item, and the Dungeons book gives an explicit Ref procedure: hand out a generic card, not the real one (D p1). That is a real VTT-native win, because in Foundry the "generic card" substitution is trivial and at the table it is fiddly. Plus the one-shot 2d10+M test and the Identify rest activity.

### 15. Village, Prosperity and institutions (C p44-55) — both — large
Cycles, Prosperity -10 to 10, 12 institutions with levels and stewards, sale percentages keyed to Prosperity, village events, crypt boons, retirement. Gadwick is already statted in D p1 with all eleven institutions and their levels. Honest assessment: this is a whole second product and it only pays off in a long campaign. Defer, but when you build it, note the single cross-cutting gate (Prosperity 10 + max level) that all twelve top services share.

### 16. Chaos count (C p13, p17, p23) — low value
Trait cards ship text about "the chaos count" and no such counter exists in `CrowData`. The Rules book never defines a chaos count; only the per-cast chaos *roll* (R p31). This is a books-side inconsistency, not an implementation gap. Ask MCDM before building anything.

**Left to the Ref, deliberately:** trying again / locked retries (R p7), readied actions (R p19), pets and summons taking Command maneuvers (R p22, C p42), hirelings (C p43), NPC connections (C p44-45).

---

## 3. SCREENS WORTH BUILDING

**You do not need a "dungeon play menu". You already built it.** The DT HUD is the dungeon screen: clock, drain, greed badge, EN control, end turn. What it is missing is not a screen, it is three fields: the EN reason (crowded / chaos / both, R p14), the greed multiplier actually reaching the treasure award, and a player-visible end-of-DT summary of what drained. Add those to the panel you have.

**The two screens that are genuinely missing:**

### A. Rest screen — both — the highest-value new screen
Opened by the existing Rest button, replacing the current silent recovery. Contents, in the printed order (R p14-15, p27):
1. Ration check and consumption, with the starvation-clear path (R p16).
2. One activity per crow, picked from the seven, with the prerequisites checked live: Craft (expertise uses + materials + tools present), Harvest (a corpse in slots), Tend Wounds (a target with 2+ wounds who is not you), Repair Armor (the kit's slots), Prepare for Task, Identify, Seclude Camp with its EN +1.
3. Rest encounter check at the modified EN (R p14).
4. The Miasma question you already ask, then the 2d10+M per human, cruelty applied, and the `1d10 + cruelty` effects roll.
5. Recovery summary: Stamina, wound, expertise uses (withheld in the Miasma), rest-restore UD, spellbook UD.
6. The advancement prompt, since `restOwed` is already computed here.
This screen alone closes gaps 2, 3, 7, 8 and half of 14.

### B. Travel Day screen — GM opens, players participate — only if you hexcrawl
Yes, overland travel warrants its own screen, because the seven-step travel day (R p24) is a *procedure with an order* and orders are exactly what a VTT is good at. Contents:
1. Pace picker (Slow 1 hex / EN 8, Normal 2 / EN 7, Fast 3 / EN 6) with the automatic modifiers stacked and shown: slowest creature's speed, road, river direction (R p24).
2. Role board: one Guide, up to three each of Supporter, Scout, Tracker, each on a different task, plus assist slots. Resolution buttons that fire in the printed order (supporters, guides, scouts, trackers) and write their EN and hex deltas back to a running total (R p25-26).
3. A live EN readout that shows the arithmetic, capped at 10 (R p29).
4. Lost state: GM-only, with the secret 1d6 clockwise-from-north hex roll and the party's true position hidden from players (R p27), plus the Back on Track button.
5. The encounter check, rolling straight into the Travel Encounters d100 (Ref p1).
6. Hand-off to the Rest screen for step 6, the Miasma RR.
The Cornath map already ships as a scene, so hex position can live on it. **Do not build this before the Rest screen**, and do not build it at all if your table treats travel as narration; it is the largest single build in this document and the only one whose value depends on how you play.

### C. A fifth crow-sheet tab: Actions — player — small
The player-facing dungeon menu you are missing is not a window, it is a tab. Buttons for: unarmed strike, the common maneuvers (Move, Shift, Grab, Escape Grab, Knockback, Stand Up, Draw From Belt, Draw From Pack, Dump Backpack, Pick Up), Taunt, Assist, and the reaction state (counter available / spent). Everything on it is a `resolvePowerRoll` call you already own. This is what makes maneuvers exist at the table instead of existing in the book.

---

## 4. NOT WORTH AUTOMATING

Say no to these plainly. A short list of good tools beats a complete list of bad ones.

- **Morale and ending the fight** (Ref p16, p22, p31). "Animals flee once they clearly cannot win." That is a Ref sentence, not a state machine. A prompt in the creature sheet's lore tab is the most it deserves.
- **Likes and hates, and Suspicious Circumstances** (Ref p30-32). The *lists* belong on the creature sheet (they already are, inherited from monster type). The 2d10+M approach roll is fine as a one-click chat roll; it does not need a screen and must never auto-move a token.
- **Trying again / locked retries** (R p7). "Unless circumstances significantly change" cannot be modelled without modelling circumstances. Tracking attempted tasks per PC would produce a nag list nobody reads.
- **Improvised item use, "Think Outside the Card"** (C p31) and the guide-not-handcuffs rule (D p1). These are explicit permission to ignore the system. Encoding them defeats them.
- **NPC connections, prisoner bargains, Lisbeth's 20 rations, Horace's offering bowl** (C p44-45, D p6, D p13, D p19). Adventure-specific social state. Journal entries, not schema.
- **The physical card-shuffle backlashes as literal shuffles** (R p32-34). Resolve them as "one random carried item" and move on; do not build a card-deck simulator.
- **Village events, other villages, founding a village** (C p45-47, p55). The books themselves say the tables are unfinished and that non-home village advice is not yet written.
- **Dungeon keyed content as a mechanic** (D p2-19). Traps, keyed reveals, room state and the Blood Library acid clock are content, not system. They belong in journals and scene flags in an adventure module, which you already have a separate `adventure/module.json` for.

---

## 5. CONTENT STILL MISSING

**RollTables: the pack does not exist.** `system.json` declares 8 packs and none of them is a RollTable pack. Every table below is printed in a book and shipped nowhere. Priority order:

*Blocking a wired code path:*
1. **Backlashes**, d100 + rank, 53 entries (R p32-35). `rollBacklash` looks for `flag crows.table === "backlashes"` and finds nothing.
2. **Miasma Effects**, 1d10 + cruelty, 7 bands with paired effects (R p28).

*Needed by the Ref every session:*
3. Travel Encounters d100 and Any Monster d10 (Ref p1).
4. Minor Interesting Things d100 and Major Interesting Things d100 (Ref p12-14). Note: 45 appears twice, 57 is missing, and the Major 101+ row is unreachable by d100 by design (Greed Exchange only).
5. Blood Dungeon Encounters d6 and Undead Dungeon Encounters, printed as d6 with 10 rows so it is a d10 (Ref p32, p34).
6. Wild Animal Reaction d100 plus the 7 habitat animal tables (Coastal d10, Cold d10, Desert d100, Forest d100, Grassland d100, Hill/Mountain d100, Marsh d10) (Ref p9-11).
7. Miasma-Touched Humans d100 and Miasma-Touched Encounters d100 (Ref p3-6).
8. Travelers d100, Traveler Encounters d10, Traveler Rewards d6 (Ref p7-8).
9. Merchant Sales d100 and Merchant Guards d10 (Ref p2-3). Merchant Sales 99-100 is a non-terminating reroll loop as printed; cap it.
10. Dismember d6 (C p37), Bad Weather climate lookup (Ref p1), Village Event d10 + Prosperity (C p46-47), Inn gambling (C p53).

**Compendium content:**
- **Unarmed weapon card** (0 in `packs-src/weapons/`, R p20).
- **Corpse cards**, one per size, driving `corpse.isCorpse` (0 exist, R p11).
- **Pet cards** linking to the 32 animal actors via `pet.actorUuid` (0 exist, C p42).
- **Armor and weapon enchantments**, 40 named entries with price, Enchanting uses, materials and crafting goal (C p34-36, p40-41). None are cards; several carry their own charge tracks (Revenge 1d6/hit backfiring at 12+, Teleporting the same, Gashing's 1d6 P bleed).
- **Material upgrade tiers** for armor, metal weapons and bow wood (C p33, p39), and the crafting-goal tables that go with them (C p34, p39).
- **Quality tiers** fine/masterwork: the field is populated with its own extractor path and appears in **no template** (C p31).
- **Vehicles**, 3 entries (C p43). **Barding** size multipliers (C p42).
- **Crypt boons**, 11 entries scaling by crypt level (C p51-52). Gadwick's are already specified (D p1).
- Angel, Demon and Plant monsters do not exist in the playtest books either. Do not chase them.
