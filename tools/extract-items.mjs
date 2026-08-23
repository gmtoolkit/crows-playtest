/**
 * Extract the printed inventory card decks into
 * `packs-src/{weapons,armor,gear,spellbooks}/*.json`.
 *
 * The grid geometry is already solved: `tools/lib/pdf-cards.mjs` turns a card
 * page into `{page, col, lines, footer}` cells, splitting the 7.5pt crafting
 * and price band from the 11pt body without parsing either. What is left is
 * everything above that line — which deck to believe, where one card ends and
 * the next begins, and what the printed grammar means.
 *
 * A canonical card:
 *
 *   Hammer Stack 2                     <- name and stack size
 *   Melee 1/Ranged 5                   <- reach / thrown range
 *   Attack 2d10 + A or S               <- the roll and the characteristic
 *   12-16 17+                          <- tier header
 *   2 + A or S 4 + A or S              <- one damage cell per header column
 *   Bashing, Light,                    <- weapon group, then properties,
 *   Pummeling                             wrapped over as many lines as it takes
 *   ----
 *   Blacksmithing 1 | 1 iron bar | 5   <- crafting: expertise+uses, materials, goal
 *   10 gc                              <- retail price
 *
 * Three things about the corpus drive the shape of this file.
 *
 * DECK 02 IS THE NEWEST, NOT DECK 05. The two decks carry the same content
 * generation and the same title typo, but the PDF metadata dates 02 to 19 Aug
 * and 05 to 13 Aug; 05 is the older snapshot that James marked up with 40
 * annotations, which is why it *looks* like the authoritative one. Where they
 * disagree, 02 has the newer wording ("bane" rather than "-1 penalty") and the
 * normalised crafting rating ("Blacksmithing 1" rather than "+1"). So decks are
 * ranked 02 > 03 > 04 > 05 and that ranking breaks ties in `merge`.
 *
 * LINE 0 IS "Name Stack N" LESS THAN HALF THE TIME. The real grammar is: a
 * `Stack N` token appears somewhere in the cell, and everything printed before
 * it that is not a structural line is the name. A long name pushes the token
 * onto line 1, a usage-dice line pushes it to line 2, and one card kerns it
 * flat against the name ("Alteration StoneStack1"), so the token is matched
 * with no word boundary at all.
 *
 * THE CELL IS NOT ALWAYS ONE CARD. Rows of cards with no footer band (the
 * write-in treasure cards) do not close their row, so the next row runs on into
 * the same cell — a second `Stack N` means a second card. And a row holding a
 * single wide card gets cut down the middle by the column detector, stranding
 * `Stack N` and the `17+` header in a neighbouring cell. Both are repaired
 * here rather than in pdf-cards.mjs, because both are properties of these
 * decks rather than of grid extraction.
 *
 * WHAT IS NOT RECOVERED: multi-line tier tables. `cellToLines` discards x, and
 * a 3-column table whose cells wrap ("No / effect" over two lines, or
 * Caltrops' four-line middle column) comes back interleaved. Single-line rows
 * are re-columnised here by anchoring on the damage expressions; anything else
 * is reported by name and kept verbatim in the description rather than guessed
 * at. Recovering those needs a second pass that keeps item x, which is a
 * different tool.
 *
 *   node tools/extract-items.mjs [--src "/path/to/packet"]
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCards } from "./lib/pdf-cards.mjs";
import { parseDamage } from "../src/dice/tiers.mjs";
import { CROWS } from "../src/config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKS = { weapon: "weapons", armor: "armor", gear: "gear", spellbook: "spellbooks" };

const args = process.argv.slice(2);
const srcIndex = args.indexOf("--src");
const SRC =
  srcIndex >= 0
    ? args[srcIndex + 1]
    : "C:/Users/Cliff/Downloads/MCDM Crows Public Playtest August-Sept 2026/MCDM Crows Public Playtest August-Sept 2026";

const CARDS = join(SRC, "Inventory Cards");

/**
 * The card decks, best first.
 *
 * "01 Crows Inventory Sheet for Playtest 2.pdf" is deliberately absent: it is
 * the blank slot sheet (2 hands, 4 belt, 10 backpack, each backpack slot paired
 * with a wound box), not a deck. It holds no cards and the pitch detector
 * shreds it, which would otherwise show up as five phantom fragments.
 */
const DECKS = [
  { file: "02 Crows Invetory Cards for Public Playtest 2.pdf", label: "Inventory Cards" },
  { file: "03 Crows Inventory Cards by Profession for Public Playtest 2.pdf", label: "Profession Cards" },
  { file: "04 Crows Inventory Cards for POIs and Dungeons.pdf", label: "POI and Dungeon Cards" },
  { file: "05 Crows Inventory Cards for Public Playtest 2 - Annotated.pdf", label: "Inventory Cards (13 Aug draft)" }
];

/* -------------------------------------------- */
/*  Printed spellings that do not match config   */
/* -------------------------------------------- */

/**
 * A key that misses `src/config.mjs` is not cosmetic — a weapon property that
 * config does not know loses its label and its rules hook, and a magic slot it
 * does not know cannot be worn. Corrected here; the printed text is left alone
 * wherever a player reads it. Same pattern as extract-backgrounds.mjs.
 */

/** Cards print "Reload"; config calls the property `loading`. */
const PROPERTY_FIXES = { reload: "loading" };

/** Cards print "Slot Ring"; config's finger slot is what a ring occupies. */
const MAGIC_SLOT_FIXES = { ring: "finger" };

/**
 * Two cards print "Light Brutal" with the comma missing. Both halves are real
 * properties, and left alone the pair becomes one unknown property and the
 * weapon silently loses both.
 */
const PROPERTY_SPLIT_FIXES = { "light brutal": ["Light", "Brutal"] };

/**
 * Deck 02 renamed three cards. Deduplication is by name, so without these the
 * older spelling ships as a second, near-identical document.
 */
const NAME_ALIASES = {
  "Quiver of Arrows": "Quiver of 20 Arrows",
  "Case of Crossbow Bolts": "Case of 20 Crossbow Bolts",
  "Death's Ring": "Death Ring"
};

/**
 * Prices that arrive as one right-aligned text run with a space inside the
 * thousands group: the enchanted weapons in deck 04 print "2,0 15 gc" for
 * 2,015 gc (a 15 gc greatsword plus a 2,000 gc enchantment) and "1,0 15 gc"
 * for 1,015. Read naively the tail is "15 gc" and a 2,000 gc weapon ships at
 * 15. Detected structurally rather than by name: what is left after the price
 * tail is a bare number fragment, which no crafting block ever is.
 */

/** Section titles printed above the first card of a page, with no band between. */
const SECTION_HEADER = /^(.*?)\s*(?:Inventory\s+)?Cards$/i;

/** Page titles in deck 04 that do not end in "Cards". */
const SECTIONS = ["Blood Dungeon", "Floating Manor"];

/* -------------------------------------------- */
/*  Small helpers                                */
/* -------------------------------------------- */

/** `Coin Purse` -> `coin-purse`, for filenames and pack ids. */
function slug(s) {
  return s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** `Religious Lore` -> `religiousLore`, which is how config keys are written. */
function camelKey(s) {
  const words = String(s)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
}

/** Typographic apostrophes and dashes, so a name matches itself across decks. */
function plain(s) {
  return String(s).replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
}

/**
 * Names are matched across decks in the ASCII form `plain()` produces, but the
 * cards print a typographic apostrophe and so does every other pack in
 * packs-src (see `traits/necromancy-demon-s-sight.json`). Restore it on the way
 * out so the item packs read the same as the rest of the repo. Only the stored
 * `name` is converted: `plain()`, `NAME_ALIASES` and `slug()` keep seeing ASCII.
 */
const printedName = (s) => String(s).replace(/'/g, "’");

const num = (s) => Number(String(s).replace(/,/g, ""));

/** Join hard-wrapped card lines into one paragraph of HTML. */
const para = (lines) => (lines.length ? `<p>${lines.join(" ").replace(/\s+/g, " ").trim()}</p>` : "");

/* -------------------------------------------- */
/*  Line grammar                                 */
/* -------------------------------------------- */

/**
 * The stack token, matched with NO word boundary on either side.
 *
 * "Alteration StoneStack1" is a real card: the kerning collapsed both spaces,
 * and `\bStack\b` misses it entirely, which drops the card to a nameless
 * fragment.
 */
const STACK = /\s*Stack\s*(\d+)/;

const OCCUPIES = /\s*\(Occupies\s+(\d+)\s+slots?\)/i;
const BOOK_RANK = /\s*\bBook\s+R(\d)\b/;
const ATTACK = /Attack\s+2d10\s*\+\s*([AMS](?:\s+or\s+[AMS])?)/;
const ARMOR_AD = /^Armor\s+AD:?\s*(\d+)/i;
const UD_LINE = /^UD:?\s*(\d+)\s*\(([^)]*)\)/i;
const SLOT_LINE = /^Slot:?\s+(\w+)/i;
const RANGE_SPEC = /^(?:(Melee|Ranged)\s+(\d+)(?:\s*\/\s*(?:Melee|Ranged)\s+(\d+))?|(Self)|Line\s+(\d+)\s*x\s*(\d+)(?:\s+within\s+(\d+))?)/i;
const TIER_HEADER = /^(?:(≤11)\s+)?12-16\s+17\+$/;
const ACTIVATION = /^(Maneuver|Action|Reaction|Free\s+Action):\s*(.*)$/i;
const QUALITY_LINE = /^(Fine|Masterwork)\s*\(/i;

/**
 * A quality rung, with its price and the start of its effect.
 *
 * These lines are DATA, not prose: James's own annotation on the 13 Aug deck
 * reads "Price and effect for fine and masterwork items is listed like this".
 * Eleven cards were shipping their upgrade ladder as their description, which
 * both lost the card's real prose and left the item describing itself as a
 * price list. Prices carry thousands separators ("Masterwork (1,000 gc)").
 */
const QUALITY_TIER = /^(Fine|Masterwork)\s*\(\s*([\d,]+)\s*gc\s*\)\s*:\s*(.*)$/i;
const LIGHT = /\bLight\s+(\d+)\/(\d+)/;
const SPELL_META = /\b(Alteration|Benefaction|Conjuration|Elemental|Illusion|Necromancy)\b\s*(Attk\.|Act\.|Man\.)?/i;
const TARGET = /\bTarget\s+(.+?)(?=\s*Dur\.|$)/;
const DURATION = /\bDur\.\s*(.+)$/;

/**
 * Lines that carry a field rather than prose.
 *
 * Used for two things: deciding which lines before the stack token are part of
 * the NAME (a wrapped name is interrupted by its usage-dice line), and deciding
 * where a tier block stops.
 */
const STRUCTURAL = [UD_LINE, SLOT_LINE, RANGE_SPEC, ATTACK, ARMOR_AD, TIER_HEADER, ACTIVATION];
const isStructural = (line) => STRUCTURAL.some((re) => re.test(line));

/* -------------------------------------------- */
/*  Cell repair                                  */
/* -------------------------------------------- */

/**
 * Drop the page's section title off the first card of the page.
 *
 * Deck 03 heads every profession page and deck 04 every location page with a
 * title, and there is no footer band between the title and the first card, so
 * the title lands inside that card's cell. Returns the title so the card can
 * record where it was printed.
 */
function stripSection(lines) {
  if (!lines.length) return { lines, section: "" };
  const first = plain(lines[0]);
  if (SECTIONS.includes(first)) return { lines: lines.slice(1), section: first };
  const m = SECTION_HEADER.exec(first);
  // "Coin Purse" must not match; only a real "<something> Cards" title does.
  if (m && m[1] && !STACK.test(first)) return { lines: lines.slice(1), section: m[1] };
  return { lines, section: "" };
}

/**
 * Re-join a wide card that the column detector cut in half.
 *
 * `detectColumns` bails out only when a row's x span is under 60pt, and a lone
 * horizontal card spans about 96, so the autocorrelation invents a pitch and
 * splits it. The right half is unmistakable: it has no name, no footer, and
 * opens with a bare `Stack N` — every real card prints something before that
 * token or on the line above it.
 *
 * The halves are re-zipped by MEANING, not by concatenation: the stack token
 * belongs on the name line, `17+` completes the tier header, the second damage
 * expression completes the tier row, and the attack completes the reach line.
 * Appending them in order instead leaves the damage cells in the wrong place,
 * which is how a Shortbow ends up dealing 2 damage on a tier 3.
 */
function rezip(prev, fragment) {
  for (const line of fragment) {
    if (/^Stack\s*\d+$/.test(line) && !prev.some((l) => STACK.test(l))) {
      prev[0] = `${prev[0]} ${line}`;
      continue;
    }
    if (line === "17+") {
      const at = prev.findIndex((l) => /^(?:≤11\s+)?12-16$/.test(l));
      if (at >= 0) {
        prev[at] = `${prev[at]} 17+`;
        continue;
      }
    }
    if (ATTACK.test(line)) {
      const at = prev.findIndex((l) => RANGE_SPEC.test(l) && !ATTACK.test(l));
      if (at >= 0) {
        prev[at] = `${prev[at]} ${line}`;
        continue;
      }
    }
    if (/^\d+\s*\+\s*[AMS]/.test(line)) {
      const header = prev.findIndex((l) => TIER_HEADER.test(l));
      if (header >= 0 && /^\d+\s*\+\s*[AMS]/.test(prev[header + 1] ?? "")) {
        prev[header + 1] = `${prev[header + 1]} ${line}`;
        continue;
      }
    }
    prev.push(line);
  }
}

/**
 * Split a cell that holds two cards.
 *
 * A row whose cards print no footer (the write-in treasure cards: Gem, Potion,
 * Magic Wand) has no small-set band to close it, so `rowRegions` runs it into
 * the next row and both cards arrive in one cell. A second `Stack N` is the
 * tell; when that token stands alone on its line the name is the line above it,
 * and the footer belongs to the SECOND card, because the footer band that
 * closed the region is the second card's.
 */
function splitCards(lines, footer) {
  const stackAt = lines.map((l, i) => (STACK.test(l) ? i : -1)).filter((i) => i >= 0);
  if (stackAt.length < 2) return [{ lines, footer }];

  const starts = [0];
  for (const i of stackAt.slice(1)) {
    // A bare "Stack N" line means the name is printed above it.
    const start = /^Stack\s*\d/.test(lines[i]) ? i - 1 : i;
    if (start > starts[starts.length - 1]) starts.push(start);
  }

  return starts.map((start, n) => ({
    lines: lines.slice(start, starts[n + 1] ?? lines.length),
    footer: n === starts.length - 1 ? footer : []
  }));
}

/* -------------------------------------------- */
/*  Footer: crafting and price                   */
/* -------------------------------------------- */

/**
 * Read the small-set band under a card.
 *
 * The band wraps mid-field, so the lines are concatenated before anything is
 * parsed — real fragments include "Alchemy 2 | 2 monster parts (any)" + "| 50"
 * + "250 gc". The price is the trailing "N gc"; the crafting block is
 * everything before it, and on the horizontal cards the two share one line.
 *
 * Materials may themselves be priced ("gem worth 200 gc | 200 | 1,000 gc"), so
 * the price is anchored to the END of the band rather than found by search.
 */
function parseFooter(footer) {
  const joined = footer.join(" ").replace(/\s+/g, " ").trim();
  const out = { price: 0, xpValue: null, crafting: null, raw: joined };
  if (!joined) return out;

  // Unique items are priced in experience instead of coin (C p6).
  const xp = /Unique Item\s*\|\s*XP:\s*([\d,]+)/i.exec(joined);
  if (xp) {
    out.xpValue = num(xp[1]);
    return out;
  }

  let head = joined;
  const price = /([\d,]+)\s*gc\s*$/.exec(joined);
  if (price) {
    out.price = num(price[1]);
    head = joined.slice(0, price.index).trim();
    // "2,0 15 gc": one right-aligned run whose thousands group carries a space.
    // What is left of a real crafting block is never a bare number.
    if (/^[\d,]+$/.test(head)) {
      out.price = num(head + price[1]);
      head = "";
    }
  }

  head = head.replace(/\|\s*$/, "").trim();
  if (!head) return out;

  const parts = head.split("|").map((p) => p.trim());
  // "Blacksmithing 1", "Alchemy 1/2/3" (the fine/masterwork ladder), and the
  // legacy "Blacksmithing +1" from the 13 Aug deck all reduce to the base tier.
  const first = /^([A-Za-z ]+?)\s*\+?\s*([\d/]+)?$/.exec(parts[0]);
  out.crafting = {
    printed: parts[0],
    expertise: first ? camelKey(first[1]) : "",
    uses: first?.[2] ? num(first[2].split("/")[0]) : 0,
    materials: parts[1] ?? "",
    goal: parts[2] ? num((parts[2].match(/[\d,]+/) ?? ["0"])[0].split("/")[0]) : 0
  };
  return out;
}

/* -------------------------------------------- */
/*  Tier tables                                  */
/* -------------------------------------------- */

/** A printed damage cell: "3 + S", "2 + A or S", "4+M". */
const DAMAGE_CELL = /\d+\s*\+\s*[AMS](?:\s+or\s+[AMS])?/g;

/**
 * Re-columnise one printed tier row.
 *
 * The row arrives as a single string because `cellToLines` throws x away, so
 * the columns have to be found in the text. Whitespace alone does not do it —
 * "No effect 5+M 10+M" is three cells in four words and "1 gal 5 gals 10 gals"
 * is three cells in six.
 *
 * What IS reliable is that the tier 2 and tier 3 cells are the numeric ones.
 * Anchor on them and the cell boundaries fall out; a leading prose cell ("No
 * effect") is then simply whatever precedes the first anchor.
 *
 * @param {string} row    The printed row.
 * @param {number} cells  2 for a "12-16 17+" header, 3 when "≤11" is present.
 * @returns {string[]|null} One string per cell, or null if it cannot be read.
 */
function splitTierRow(row, cells) {
  for (const anchor of [DAMAGE_CELL, /\d+(?:\/\d+)?/g]) {
    const hits = [...row.matchAll(anchor)];
    // One anchor per cell, or one per cell but the first, which is prose.
    if (hits.length === cells || hits.length === cells - 1) {
      const starts =
        hits.length === cells ? [0, ...hits.slice(1).map((h) => h.index)] : [0, ...hits.map((h) => h.index)];
      return starts.map((s, i) => row.slice(s, starts[i + 1] ?? row.length).trim());
    }
  }
  const words = row.split(/\s+/);
  return words.length === cells ? words : null;
}

/* -------------------------------------------- */
/*  Card parsing                                 */
/* -------------------------------------------- */

/**
 * Turn one cell into a type-agnostic record.
 *
 * Everything is collected first and the type decided afterwards, from the
 * card's own signature rather than from which deck it came out of — deck 03
 * and deck 04 both mix weapons, gear and spells on the same page.
 */
function parseCard({ lines, footer }, deck, page, section) {
  const at = lines.findIndex((l) => STACK.test(l));
  if (at < 0) return { fragment: "no Stack token", lines, footer, deck, page };

  const m = STACK.exec(lines[at]);
  const head = lines[at].slice(0, m.index);
  // "(Occupies 2 Slots)" trails the stack number, so it has to come off before
  // the rest of that line joins the body — otherwise it reads as description.
  let tail = lines[at].slice(m.index + m[0].length);
  const occupies = OCCUPIES.exec(tail) ?? OCCUPIES.exec(head);
  if (occupies) tail = tail.replace(OCCUPIES, "");

  // A wrapped name is interrupted by its own structural lines; those stay in
  // the body ("Quiver of Arrows" / "UD 2 (activate; useless)" / "Stack 1").
  const before = lines.slice(0, at);
  const nameParts = [...before.filter((l) => !isStructural(l)), head].filter((s) => s.trim());
  // A cell with a stack token and no name is the right half of a wide card the
  // column detector cut in two and `rezip` could not place. It carries real
  // text — an attack roll, a damage cell — and filing it as an unnamed item is
  // how half a weapon ships as a piece of gear.
  if (!nameParts.length) return { fragment: "stack token with no name", lines, footer, deck, page };

  // The same wreckage the other way round: when a broken row leaves the stack
  // token stranded against a tier header, the "name" is "12-16".
  if (isStructural(nameParts.join(" ")) || /^(?:≤11|12-16|17\+)/.test(nameParts[0])) {
    return { fragment: "name is a structural line", lines, footer, deck, page };
  }
  const body = [...before.filter(isStructural), tail, ...lines.slice(at + 1)].filter((s) => s.trim());

  let name = plain(nameParts.join(" "));
  const card = {
    deck,
    page,
    section,
    stack: num(m[1]),
    slots: 1,
    rank: null,
    discipline: "",
    spellAction: "",
    ud: null,
    magicSlot: null,
    range: null,
    area: null,
    target: "",
    duration: "",
    attack: null,
    ad: null,
    tier: null,
    properties: [],
    enchantments: [],
    activation: null,
    light: null,
    quality: [],
    prose: [],
    unresolved: [],
    ...parseFooter(footer)
  };

  if (occupies) {
    card.slots = num(occupies[1]);
    name = plain(name.replace(OCCUPIES, ""));
  }

  const rank = BOOK_RANK.exec(name);
  if (rank) {
    card.rank = num(rank[1]);
    name = plain(name.replace(BOOK_RANK, ""));
  }

  card.name = NAME_ALIASES[name] ?? name;

  /* --- Walk the body ------------------------------------------------- */

  for (let i = 0; i < body.length; i++) {
    let line = body[i].trim();
    if (!line) continue;

    const ud = UD_LINE.exec(line);
    if (ud) {
      card.ud = readUsageDice(ud);
      continue;
    }

    const slot = SLOT_LINE.exec(line);
    if (slot) {
      card.magicSlot = slot[1].toLowerCase();
      continue;
    }

    const tier = TIER_HEADER.exec(line);
    if (tier) {
      // Everything printed under the header up to the next structural line is
      // the table. How much of it is really the table depends on the card
      // type, so the block is kept whole and resolved later.
      const block = [];
      while (i + 1 < body.length && !isStructural(body[i + 1]) && !QUALITY_LINE.test(body[i + 1])) {
        block.push(body[++i].trim());
      }
      card.tier = { cells: tier[1] ? 3 : 2, header: line, block };
      continue;
    }

    // The spell meta sits on the stack line's tail: "Stack 1 Elemental Attk."
    const meta = SPELL_META.exec(line);
    if (meta && card.rank !== null && !card.discipline) {
      card.discipline = meta[1].toLowerCase();
      card.spellAction = (meta[2] ?? "").toLowerCase();
      line = line.replace(SPELL_META, "").trim();
      if (!line) continue;
    }

    const ad = ARMOR_AD.exec(line);
    if (ad) {
      card.ad = num(ad[1]);
      continue;
    }

    // The horizontal cards fuse reach and attack onto one line, and the spell
    // cards fuse range, target and duration, so one line can carry several
    // fields. Each is consumed in turn and the remainder re-tested.
    const attack = ATTACK.exec(line);
    if (attack) {
      card.attack = attack[1];
      line = line.replace(ATTACK, "").trim();
    }
    // First match only. Minor Ward's description opens "Target gains AD based
    // on the casting.", and a later match overwrites the real "Target 1 creat."
    // with a fragment of prose — and eats the sentence out of the description
    // on the way past.
    const target = !card.target && TARGET.exec(line);
    if (target) {
      card.target = target[1].trim();
      line = line.replace(TARGET, "").trim();
    }
    const duration = !card.duration && DURATION.exec(line);
    if (duration) {
      card.duration = duration[1].trim();
      line = line.replace(DURATION, "").trim();
    }
    const range = RANGE_SPEC.exec(line);
    if (range && !card.range) {
      readRange(card, range);
      line = line.slice(range[0].length).trim();
    }
    if (!line) continue;

    // A quality rung and everything it wraps onto. Read before the activation
    // test so that "Fine (100 gc): 2 UD" can never be mistaken for one, and
    // before the fall-through so it can never reach the description.
    if (QUALITY_LINE.test(line)) {
      const rung = QUALITY_TIER.exec(line);
      if (!rung) {
        // A rung whose price did not parse is left as prose rather than
        // dropped: better a card that reads oddly than one that silently
        // loses an upgrade.
        card.unresolved.push(`quality line "${line}" has no readable price`);
        card.prose.push(line);
        continue;
      }
      const text = [rung[3]];
      // The effect wraps exactly like an activation sentence, and the wrap
      // often lands mid-token — Torch prints "Masterwork (200 gc): 3" and
      // then "UD" on the line below, so a line-at-a-time read ships "3".
      while (i + 1 < body.length && !isStructural(body[i + 1]) && !QUALITY_LINE.test(body[i + 1])) {
        text.push(body[++i].trim());
      }
      card.quality.push({
        printed: rung[1],
        price: num(rung[2]),
        effect: text.join(" ").replace(/\s+/g, " ").trim()
      });
      continue;
    }

    const activation = ACTIVATION.exec(line);
    if (activation) {
      const text = [activation[2]];
      // The activation sentence wraps; it runs until the next structural line.
      while (i + 1 < body.length && !isStructural(body[i + 1]) && !QUALITY_LINE.test(body[i + 1])) {
        text.push(body[++i].trim());
      }
      const joined = text.join(" ").replace(/\s+/g, " ").trim();
      card.activation ??= { type: camelKey(activation[1]), description: joined };
      const light = LIGHT.exec(joined);
      if (light) card.light = { bright: num(light[1]), dim: num(light[2]) };
      // The sentence after the colon is the card's DESCRIPTION as often as it
      // is anything else — a Healing Potion says nothing else about itself —
      // and consuming the line for `activation` alone threw it away. What is
      // left after the structured part is lifted out is the prose: Candle
      // prints "Maneuver: Light 0/5" and has none, Smoke Bomb prints a
      // paragraph and is nothing but.
      const rest = (light ? joined.replace(LIGHT, "") : joined).replace(/\s+/g, " ").trim();
      if (rest) card.prose.push(rest);
      continue;
    }

    card.prose.push(line);
  }

  return card;
}

/** "UD 2 (activate; useless)" — the two halves are printed in either order. */
function readUsageDice([, max, spec]) {
  const parts = spec.toLowerCase();
  return {
    max: num(max),
    value: num(max),
    trigger: /\bdt\b/.test(parts) ? "dt" : "activate",
    restore: /rest/.test(parts) ? "rest" : /refuel/.test(parts) ? "refuel" : "useless",
    // "Refuel w oil" names what must be consumed.
    refuelWith: /refuel\s+w\.?\s*(\w+)/.exec(parts)?.[1] ?? ""
  };
}

/**
 * Read a printed range spec into the attack profile's shape.
 *
 * "Melee 1/Ranged 5" is one weapon with two profiles, not two weapons: the
 * model stores it as `type: "both"` with the thrown range alongside the reach,
 * which is what makes `isThrown` derivable rather than authored.
 */
function readRange(card, m) {
  const [, kind, value, thrown, self, lineLength, lineWidth, lineRange] = m;
  if (self) {
    card.range = { type: "melee", value: 0 };
    return;
  }
  if (lineLength) {
    card.area = { type: "line", size: num(lineLength), width: num(lineWidth) };
    card.range = { type: "ranged", value: lineRange ? num(lineRange) : 0 };
    return;
  }
  card.range = thrown
    ? { type: "both", value: num(value), thrownValue: num(thrown) }
    : { type: kind.toLowerCase(), value: num(value) };
}

/* -------------------------------------------- */
/*  Classification                               */
/* -------------------------------------------- */

/**
 * Decide the type from the card's own signature.
 *
 * Order matters: a spell card carries a range and a damage table too, and an
 * attack spell would otherwise read as a weapon. The `Book Rn` suffix is what
 * separates them, and no other card prints it.
 */
function classify(card) {
  if (card.rank !== null && card.discipline) return "spellbook";
  if (card.ad !== null) return "armor";
  if (card.attack && card.range) return "weapon";
  return "gear";
}

/* -------------------------------------------- */
/*  Type-specific builders                       */
/* -------------------------------------------- */

const CHARACTERISTIC = {
  a: "agility",
  m: "mind",
  s: "strength",
  "a or s": "agilityOrStrength",
  "a or m": "agilityOrMind",
  "m or s": "mindOrStrength"
};

/**
 * The card's printed damage, normalised to the `@mod` form the roller binds.
 *
 * `parseDamage` already knows every printed dialect ("4+M", "2 dam",
 * "8+M dam; vulnerable"), so it is reused rather than re-implemented — and it
 * hands back the trailing condition clause separately, which belongs on the
 * profile's note rather than inside the damage formula.
 */
function damage(text) {
  if (!text) return { formula: "", note: "", piercing: false };
  const parsed = parseDamage(text);
  return {
    // Spell cards set the damage tight ("4+M"), weapon cards spaced ("4 + S");
    // one stored form keeps the two from looking like different notations.
    formula: (parsed.formula ?? text.trim()).replace(/\s*\+\s*/g, " + "),
    note: parsed.note,
    piercing: parsed.piercing
  };
}

/** The shared card block, emitted only where the card actually says something. */
/**
 * Resolve the printed quality ladder into `system.qualityTiers`.
 *
 * Every card that offers upgrades prints exactly two rungs, cheap first: a
 * fine one and a masterwork one. `tier` is a choices field (fine|masterwork),
 * so a rung that resolves to anything else does not merely read oddly — it
 * fails validation and the whole array is refused.
 */
function readQualityTiers(card, report) {
  if (!card.quality.length) return null;
  const rungs = card.quality.map((q) => ({ tier: q.printed.toLowerCase(), price: q.price, effect: q.effect }));

  /**
   * Rope prints "Fine (500 gc): 100 feet…" and then "Fine (1,000 gc): 150
   * feet…" — the second rung is plainly the masterwork one, printed with the
   * wrong word. The ORDER and the PRICES are what the deck never gets wrong,
   * so a colliding pair is resolved by price and reported by name; nothing is
   * inferred from the effect text. Left alone, Rope would ship two fine rungs
   * and no masterwork rung at all.
   */
  if (rungs.length === 2 && rungs[0].tier === rungs[1].tier) {
    const [cheap, dear] = [...rungs].sort((a, b) => a.price - b.price);
    report(
      `${card.name} (${card.deck.label}): both quality rungs are printed "${card.quality[0].printed}" ` +
        `(${cheap.price} gc and ${dear.price} gc); read by price as fine then masterwork`
    );
    cheap.tier = "fine";
    dear.tier = "masterwork";
  }

  const seen = new Set();
  const kept = [];
  for (const rung of rungs) {
    if (seen.has(rung.tier)) {
      report(`${card.name} (${card.deck.label}): a second "${rung.tier}" rung at ${rung.price} gc; dropped`);
      continue;
    }
    seen.add(rung.tier);
    kept.push(rung);
  }
  // Sort so the ladder always reads cheap rung first, whatever the card did.
  kept.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "fine" ? -1 : 1));
  return kept.length ? kept : null;
}

function cardBlock(card, description, report, badKeys) {
  const out = { description, slots: card.slots, stack: card.stack, price: card.price };
  if (card.xpValue !== null) out.xpValue = card.xpValue;
  if (card.ud) out.ud = card.ud;
  if (card.crafting) {
    out.crafting = {
      expertise: card.crafting.expertise,
      uses: card.crafting.uses,
      materials: card.crafting.materials,
      goal: card.crafting.goal
    };
  }
  if (card.magicSlot) {
    // "Slot Ring" / "Slot Neck" / "Slot: Head" — the printed word is the body
    // part that wears the item, and a slot config does not know cannot be worn.
    const key = MAGIC_SLOT_FIXES[card.magicSlot] ?? card.magicSlot;
    if (CROWS.magicSlots[key]) out.magicSlot = key;
    else badKeys.push(`${card.name}: magic slot "${key}" (printed "${card.magicSlot}") is not in CROWS.magicSlots`);
  }
  // An enchanted item is one an enchanter made, one that occupies a magic slot,
  // or one the card names as magic. Nothing else on a card says so.
  if (card.crafting?.expertise === "enchanting" || card.magicSlot || /^Magic\b/.test(card.name)) out.magic = true;
  const quality = readQualityTiers(card, report);
  if (quality) out.qualityTiers = quality;
  out.source = `Crows Playtest 2, ${card.deck.label}`;
  return out;
}

/**
 * Resolve the tier table for a card that has one.
 *
 * Single-line rows are re-columnised; a wrapped row is reported and left in the
 * description. The one wrap that IS unambiguous is a lone word completing a
 * three-column table's prose cell ("No" / "effect"), because tier 1 is the only
 * cell that can be prose.
 */
function readTiers(card, report, { rowOnly = false } = {}) {
  if (!card.tier) return null;
  const { cells, block } = card.tier;
  if (!block.length) {
    // The header printed but its row did not: the card was taller than its
    // row-mates, so everything under the closing footer band spilled into a
    // phantom cell. Another deck's copy usually still has it.
    report(`${card.name} (${card.deck.label}): tier header with no row beneath it`);
    return null;
  }
  const row = splitTierRow(block[0], cells);
  if (!row) {
    report(`${card.name} (${card.deck.label}): tier row "${block.join(" / ")}" could not be columnised`);
    return null;
  }
  // A weapon's table is always one line; what follows it is the trait list.
  const extra = rowOnly ? [] : block.slice(1);
  if (extra.length === 1 && cells === 3 && !/^\d/.test(row[0]) && extra[0].split(/\s+/).length === 1) {
    row[0] = `${row[0]} ${extra[0]}`;
    return { row, leftover: [] };
  }
  if (extra.length) {
    report(`${card.name} (${card.deck.label}): tier table wraps over "${extra.join(" / ")}", kept as prose`);
  }
  return { row, leftover: extra };
}

/**
 * Read the weapon's printed trait list.
 *
 * The list is one comma run wrapped over as many lines as it needs, and its
 * FIRST entry is the weapon group, not a property — the group is what an
 * expertise attaches to, so mistaking it for a property costs the weapon its
 * expertise link. Enchanted weapons in deck 04 append an "Enchantment" marker
 * after their named enchantment.
 */
function readProperties(card, lines, badKeys) {
  /**
   * The comma that separates two properties is dropped at the line break as
   * often as it is kept: "Slashing, Light," wraps WITH its comma but
   * "Slashing, Disengage" / "Parry 4" wraps without one. Joining on whitespace
   * alone fuses the pair into one unknown property called "disengageParry" and
   * the weapon loses both.
   */
  let text = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce((acc, line) => (!acc ? line : acc.endsWith(",") ? `${acc} ${line}` : `${acc}, ${line}`), "");

  const enchanted = /,?\s*\bEnchantment\s*$/i.test(text);
  if (enchanted) text = text.replace(/,?\s*\bEnchantment\s*$/i, "").trim();

  const entries = [];
  for (const raw of text.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const fixed = PROPERTY_SPLIT_FIXES[entry.toLowerCase()];
    entries.push(...(fixed ?? [entry]));
  }

  for (const entry of entries) {
    const m = /^(.+?)(?:\s+(\d+))?$/.exec(entry);
    const key = PROPERTY_FIXES[camelKey(m[1])] ?? camelKey(m[1]);

    if (!card.group && CROWS.weaponGroups[key]) {
      card.group = key;
      continue;
    }
    // The last entry of an enchanted weapon's list is the enchantment's name.
    if (enchanted && entry === entries[entries.length - 1] && !CROWS.weaponProperties[key]) {
      card.enchantments.push({ name: m[1].trim() });
      continue;
    }
    if (!CROWS.weaponProperties[key]) {
      badKeys.push(`${card.name}: weapon property "${key}" (printed "${entry}") is not in CROWS.weaponProperties`);
      continue;
    }
    card.properties.push(m[2] ? { key, value: num(m[2]) } : { key });
  }
}

/* -------------------------------------------- */

function buildWeapon(card, report, badKeys) {
  const tiers = readTiers(card, report, { rowOnly: true });
  const propertyLines = card.tier ? card.tier.block.slice(1) : card.prose;
  readProperties(card, propertyLines, badKeys);

  const prose = card.tier ? card.prose : [];
  const tier2 = damage(tiers?.row[tiers.row.length - 2] ?? "");
  const tier3 = damage(tiers?.row[tiers.row.length - 1] ?? "");

  if (!tier2.formula || !tier3.formula) {
    report(`${card.name} (${card.deck.label}): weapon with no tier ${!tier2.formula ? "2" : "3"} damage`);
  }
  if (!card.group) {
    badKeys.push(`${card.name}: no weapon group in the printed trait list "${propertyLines.join(" ")}"`);
  }

  const system = {
    ...cardBlock(card, para(prose), report, badKeys),
    characteristic: CHARACTERISTIC[card.attack.toLowerCase()] ?? "strength",
    range: card.range,
    tier2: tier2.formula,
    tier3: tier3.formula,
    properties: card.properties
  };
  if (card.group) system.group = card.group;
  if (tiers && tiers.row.length === 3) system.tier1 = tiers.row[0];
  if (tier2.piercing || tier3.piercing) system.piercing = true;
  const note = [tier3.note, ...(tiers?.leftover ?? [])].filter(Boolean).join(" ");
  if (note) system.note = `<p>${note}</p>`;
  if (card.enchantments.length) {
    system.enchantments = card.enchantments;
    // An enchanted weapon is a magic item even though nothing enchanted it in
    // play: the card carries no crafting block, only the finished price.
    system.magic = true;
  }
  if (/Ammunition for (.+)/.test(card.prose.join(" "))) system.ammunition = card.name;

  return system;
}

/* -------------------------------------------- */

function buildArmor(card, report, badKeys) {
  // "Light Armor" / "Medium Armor" / "Heavy Armor" / "Shield" — the first word
  // is the category everywhere it exists.
  const printed = card.name.replace(/\s*Armor$/i, "");
  const key = camelKey(printed === card.name ? card.name : printed);

  const system = {
    ...cardBlock(card, para(card.prose), report, badKeys),
    ad: { value: card.ad, max: card.ad }
  };
  if (CROWS.armorCategories[key]) system.category = key;
  else {
    badKeys.push(
      `${card.name}: armor category "${key}" is not in CROWS.armorCategories ` +
        `(declared: ${Object.keys(CROWS.armorCategories).join(", ")}) — left at the model default`
    );
  }
  return system;
}

/* -------------------------------------------- */

/** The three toolkits, resolved through the expertise that names each one. */
const TOOLKITS = Object.fromEntries(
  Object.entries(CROWS.expertises)
    .filter(([, e]) => e.craftTool)
    .map(([key, e]) => [e.craftTool, key])
);

function buildGear(card, report, badKeys) {
  const prose = [...card.prose];
  if (card.tier) {
    // GearData has no tier fields — a consumable's outcome table is prose here
    // rather than a rollable profile, so it is preserved verbatim and flagged.
    report(
      `${card.name} (${card.deck.label}): gear card carries a tier table; ` +
        `kept as description prose (GearData declares no tier fields)`
    );
    prose.push(card.tier.header, ...card.tier.block);
  }

  const system = cardBlock(card, para(prose), report, badKeys);
  if (card.light) system.light = card.light;
  if (card.activation) system.activation = card.activation;

  const toolkit = /^(\w+)'s\s+(Tools|Utensils)$/i.exec(card.name);
  const expertise = toolkit ? TOOLKITS[toolkit[1].toLowerCase()] : null;
  if (expertise) system.tool = { expertise };

  if (/^(Crafting Material|Monster Part)\b/i.test(card.name)) system.material = true;
  return system;
}

/* -------------------------------------------- */

/** "Man." / "Act." / "Attk." — an attack is an action (James's card note). */
const CASTING_TIME = { "man.": "maneuver", "act.": "action", "attk.": "action" };

function buildSpellbook(card, report, badKeys) {
  const tiers = readTiers(card, report);
  const isAttack = card.spellAction === "attk.";

  /**
   * A wrapped tier table's overflow is the spell card's only prose.
   *
   * `readTiers` reports these as "kept as prose" and hands them back as
   * `leftover`, which the weapon builder puts on its `note` — and which this
   * builder was dropping on the floor. Bone Capture's "prone", Corrupt's
   * "vulnerable" and Thunder's "push 1 push 2" are the rider on the tier they
   * wrapped out of, and losing them loses the only thing those cards say
   * beyond their damage. They are kept VERBATIM rather than folded back into
   * the tier cells: recovering the column they belong to needs the item x that
   * `cellToLines` throws away (see the file header).
   */
  const prose = [...card.prose, ...(tiers?.leftover ?? [])];

  const system = {
    ...cardBlock(card, para(prose), report, badKeys),
    rank: card.rank,
    isAttack
  };

  if (CROWS.disciplines[card.discipline]) system.discipline = card.discipline;
  else badKeys.push(`${card.name}: discipline "${card.discipline}" is not in CROWS.disciplines`);

  const casting = CASTING_TIME[card.spellAction];
  if (casting) system.castingTime = casting;
  else if (card.spellAction) badKeys.push(`${card.name}: unknown casting marker "${card.spellAction}"`);

  if (card.range) system.range = card.range;
  if (card.area) system.area = card.area;
  if (card.target) {
    system.target = card.target;
    // "Target 3 creat." is three targets; "Target All creatures" is not a count.
    const count = /^(\d+)/.exec(card.target);
    if (count) system.targets = num(count[1]);
  }
  if (card.duration) system.duration = readDuration(card.duration, card.name, badKeys);

  if (tiers) {
    const row = tiers.row;
    if (isAttack) {
      const tier2 = damage(row[row.length - 2]);
      const tier3 = damage(row[row.length - 1]);
      system.tier2 = tier2.formula;
      system.tier3 = tier3.formula;
      if (row.length === 3) system.tier1 = row[0];
      if (tier2.piercing || tier3.piercing) system.piercing = true;
      if (tier3.note) system.note = `<p>${tier3.note}</p>`;
    } else {
      // A non-attack casting prints an outcome per tier, not damage.
      system.effects = Object.fromEntries(
        row.map((cell, i) => [`tier${i + (row.length === 3 ? 1 : 2)}`, `<p>${cell}</p>`])
      );
    }
  } else if (isAttack) {
    report(`${card.name} (${card.deck.label}): attack spell with no readable damage table`);
  }

  return system;
}

/** "Instant" / "1 UD" / "End of DT" — the three printed durations. */
function readDuration(printed, name, badKeys) {
  if (/instant/i.test(printed)) return { type: "instant", ud: 0 };
  if (/\bDT\b/i.test(printed)) return { type: "dt", ud: 0 };
  const ud = /(\d+)\s*UD/i.exec(printed);
  if (ud) return { type: "ud", ud: num(ud[1]) };
  badKeys.push(`${name}: unreadable duration "${printed}"`);
  return { type: "instant", ud: 0 };
}

/* -------------------------------------------- */
/*  Deduplication                                */
/* -------------------------------------------- */

/**
 * How much a document actually says.
 *
 * Deck 05 loses the tail of 12 cards and deck 02 of 15, so the same card
 * arrives twice with one copy missing its damage, its price, or its crafting
 * block. Counting populated fields is what keeps the gutted copy from winning:
 * a weapon with no `tier2` scores below the same weapon with one, whichever
 * deck it came from.
 */
function richness(system) {
  let score = 0;
  for (const [key, value] of Object.entries(system)) {
    if (key === "source") continue;
    if (value === null || value === "" || value === 0 || value === false) continue;
    if (Array.isArray(value)) score += value.length ? 1 : 0;
    else if (typeof value === "object") score += Object.values(value).some((v) => v !== 0 && v !== "") ? 1 : 0;
    else score += 1;
  }
  return score;
}

/** Which system fields two copies of the same card disagree about. */
function differences(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("source");
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/* -------------------------------------------- */

async function main() {
  if (!existsSync(CARDS)) {
    console.error(`Card decks not found at:\n  ${CARDS}\nPass --src "/path/to/packet".`);
    process.exit(1);
  }

  const problems = [];
  const badKeys = [];
  const fragments = [];
  const report = (x) => problems.push(x);

  /* --- Read every deck into type-agnostic records -------------------- */

  const parsed = [];

  for (const [priority, deck] of DECKS.entries()) {
    const path = join(CARDS, deck.file);
    if (!existsSync(path)) {
      problems.push(`deck missing: ${deck.file}`);
      continue;
    }
    deck.priority = priority;

    const cells = await extractCards(path);
    deck.cells = cells.length;
    deck.cards = 0;

    // Cells are emitted in page-then-row order, so the previous cell is the
    // wide card's left half when a right half turns up.
    let previous = null;
    for (const cell of cells) {
      const { lines, section } = stripSection(cell.lines);

      if (previous && previous.page === cell.page && !cell.footer.length && /^Stack\s*\d+$/.test(lines[0] ?? "")) {
        rezip(previous.lines, lines);
        continue;
      }
      if (!lines.length) {
        fragments.push(`${deck.label} p${cell.page}: footer with no card — ${JSON.stringify(cell.footer)}`);
        previous = null;
        continue;
      }

      previous = { deck, page: cell.page, lines, footer: cell.footer, section };
      parsed.push(previous);
    }
  }

  /* --- Split merged cells, then parse -------------------------------- */

  const records = [];
  for (const cell of parsed) {
    for (const one of splitCards(cell.lines, cell.footer)) {
      const card = parseCard(one, cell.deck, cell.page, cell.section);
      if (card.fragment) {
        fragments.push(
          `${cell.deck.label} p${cell.page}: ${card.fragment} — ${JSON.stringify(card.lines)} ${JSON.stringify(card.footer)}`
        );
        continue;
      }
      cell.deck.cards++;
      records.push(card);
    }
  }

  /* --- Classify and build -------------------------------------------- */

  const built = [];
  for (const card of records) {
    const type = classify(card);
    // A card that looks like a weapon but is missing half its signature is a
    // parse failure, not a piece of gear; gear is where the silence hides.
    if (type === "gear" && (card.attack || card.tier?.cells === 2)) {
      report(
        `${card.name} (${card.deck.label} p${card.page}): filed as gear but carries ` +
          `${card.attack ? "an attack roll" : "a two-tier damage table"}`
      );
    }

    const system =
      type === "weapon"
        ? buildWeapon(card, report, badKeys)
        : type === "armor"
          ? buildArmor(card, report, badKeys)
          : type === "spellbook"
            ? buildSpellbook(card, report, badKeys)
            : buildGear(card, report, badKeys);

    built.push({ card, type, system });
  }

  /* --- Deduplicate ---------------------------------------------------- */

  /**
   * Deck 05 largely repeats deck 02 and deck 03 reprints an abridged subset of
   * it, so most names arrive three times. The winner is the RICHEST copy, with
   * the newest deck breaking ties — richness first because the failure that
   * matters is keeping a copy the extractor gutted, and deck order second
   * because 02 carries the 19 Aug revisions.
   */
  const byName = new Map();
  for (const entry of built) {
    const key = `${entry.type}:${entry.card.name}`;
    byName.set(key, [...(byName.get(key) ?? []), entry]);
  }

  const disagreements = [];
  const winners = [];

  /**
   * Whether the copy kept the price off its footer band.
   *
   * The band is a physically separate region of the card, so a cell that
   * arrives without one lost it to the row geometry, not to a revision — no
   * deck reprints a card with its price removed. That is why the price ranks
   * ahead of the body count rather than counting as one field among many:
   * deck 02 prints Lockpick Set, Lore Book and Spyglass with the band cut
   * short, and once `qualityTiers` gave those bodies one more populated field
   * than their deck 05 twins they won on richness and shipped at 0 gc.
   *
   * Cards that genuinely print no price (the write-in treasure cards: Gem,
   * Potion, Magic Wand) score 0 in every copy, so this changes nothing there.
   */
  const banded = (system) => (system.price > 0 || system.xpValue ? 1 : 0);

  for (const [key, group] of byName) {
    group.sort(
      (a, b) =>
        banded(b.system) - banded(a.system) ||
        richness(b.system) - richness(a.system) ||
        a.card.deck.priority - b.card.deck.priority ||
        b.card.prose.length - a.card.prose.length
    );
    const [winner, ...rest] = group;
    winners.push(winner);

    for (const loser of rest) {
      const diff = differences(winner.system, loser.system);
      if (!diff.length) continue;
      disagreements.push(
        `${key}: kept ${winner.card.deck.label} over ${loser.card.deck.label} — differs in ${diff.join(", ")}`
      );
    }
  }

  /* --- A name may not exist as two different types -------------------- */

  /**
   * Gear is the fallback bucket, so a broken row's leftovers land there under a
   * real card's name — deck 03 splits Pike across three cells and the half that
   * kept the stack token has no attack line left, which reads as a piece of
   * gear called "Pike". A name already claimed by a typed card is that card;
   * the gear copy is wreckage and is dropped rather than shipped alongside it.
   */
  const typesByName = new Map();
  for (const w of winners) typesByName.set(w.card.name, [...(typesByName.get(w.card.name) ?? []), w.type]);
  const shadowed = new Set();
  for (const [name, types] of typesByName) {
    if (types.length < 2) continue;
    if (types.includes("gear") && types.length === 2) {
      shadowed.add(name);
      report(`"${name}": a gear-shaped fragment shares the name of the ${types.find((t) => t !== "gear")} card; dropped`);
    } else {
      report(`"${name}" classified as ${types.join(" and ")}`);
    }
  }
  const shipped = winners.filter((w) => !(w.type === "gear" && shadowed.has(w.card.name)));

  /* --- Write ---------------------------------------------------------- */

  for (const dir of Object.values(PACKS)) {
    const out = join(root, "packs-src", dir);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
  }

  const IMG = {
    weapon: "icons/svg/sword.svg",
    armor: "icons/svg/shield.svg",
    gear: "icons/svg/item-bag.svg",
    spellbook: "icons/svg/book.svg"
  };

  const counts = { weapon: 0, armor: 0, gear: 0, spellbook: 0 };
  for (const { card, type, system } of shipped) {
    const doc = {
      __key: slug(card.name),
      name: printedName(card.name),
      type,
      img: IMG[type],
      system
    };
    writeFileSync(
      join(root, "packs-src", PACKS[type], `${doc.__key}.json`),
      JSON.stringify(doc, null, 2) + "\n"
    );
    counts[type]++;
  }

  /* --- Report --------------------------------------------------------- */

  console.log("deck                                cells  cards");
  for (const deck of DECKS) {
    if (deck.cells === undefined) continue;
    console.log(`${deck.label.padEnd(34)} ${String(deck.cells).padStart(5)}  ${String(deck.cards).padStart(5)}`);
  }

  console.log(
    `\n${shipped.length} items after dedup -> ` +
      Object.entries(counts)
        .map(([t, n]) => `${n} ${PACKS[t]}`)
        .join(", ")
  );

  /**
   * The same finding lands once per printed copy — deck 03 reprints the Knife
   * on 30 of its 36 profession pages — so identical lines are collapsed with a
   * count. A report nobody reads to the end is a report that hides things.
   */
  const section = (title, lines, mark) => {
    if (!lines.length) return;
    const tally = new Map();
    for (const line of lines) tally.set(line, (tally.get(line) ?? 0) + 1);
    console.log(`\n${lines.length} ${title}:`);
    for (const [line, n] of tally) console.log(`  ${mark} ${line}${n > 1 ? ` (x${n})` : ""}`);
  };

  section("cell(s) held no readable card (row spill, split rows)", fragments, "!");
  section("dedup disagreement(s)", disagreements, "~");
  section("key(s) not in src/config.mjs", badKeys, "!");
  section("problem(s)", problems, "!");
  if (!fragments.length && !badKeys.length && !problems.length) console.log("no problems");
}

main();
