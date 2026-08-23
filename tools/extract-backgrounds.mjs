/**
 * Extract the 36 backgrounds from the Characters Book into
 * `packs-src/backgrounds/*.json`.
 *
 * A background is the whole of chargen in seven printed lines:
 *
 *   Acolyte of the Healer
 *   You served the god of healing.
 *   Characteristic at 2: Mind
 *   Stamina: 7
 *   Trait: Benefaction: Enhanced Healing
 *   Expertises: Alchemy, Lift, Religious Lore (2 uses), Benefaction (2 uses)
 *   Equipment: Holy symbol, surgical kit, torch, spellbooks: minor blessing,
 *     minor healing
 *
 * The pages are two-column, and the columns MUST be resolved before anything
 * is parsed. A naive dump concatenates the two columns on their shared
 * baselines and produces lines like "Backgrounds Acolyte of the Warrior" and
 * "Backgrounds are presented in alphabetical order. You served the god of war."
 *
 * The generic gutter finder in tools/lib/pdf-text.mjs is not reused here: it
 * derives one gutter for the whole document from row occupancy, and this book
 * is mostly trait-tree pages, so the split is done per page from the item
 * positions instead (see `columnBoundary`).
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { CROWS } from "../src/config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, "packs-src", "backgrounds");
const TRAITS = join(root, "packs-src", "traits");

const args = process.argv.slice(2);
const srcIndex = args.indexOf("--src");
const SRC =
  srcIndex >= 0
    ? args[srcIndex + 1]
    : "C:/Users/Cliff/Downloads/MCDM Crows Public Playtest August-Sept 2026/MCDM Crows Public Playtest August-Sept 2026";

const BOOK = join(SRC, "02 Crows Characters Book for Playtest 2.pdf");

/** Background names are set at 12pt; body copy is 9pt. */
const NAME_FONT_MIN = 11.5;

/** Section headings ("Backgrounds", "Advancement") are 14pt and larger. */
const SECTION_FONT_MIN = 13.5;

/** Baselines within this many points are the same printed line. */
const LINE_TOLERANCE = 3;

/**
 * Running heads, folios, and the copyright line are not content.
 *
 * This has to catch the whole footer, not just an exact "© 2026": the footer
 * sits directly under the last line of a column, so anything it leaves behind
 * is folded into whichever field ended there. Half-matching it produced the
 * equipment entry "torch © 2026 MCDM Productions LLC" and, worse, hid the
 * Noble's "50 gold coins" from the coin rule below.
 */
const NOISE = /^(?:©\s*\d{4}\b|MCDM Productions\b|\d{1,3}$)/i;

/**
 * Printed keys that do not match `src/config.mjs`.
 *
 * The book has typos, and a key that misses config is not a cosmetic problem:
 * the expertise loses its category (so it stops applying to castings or weapon
 * attacks) and the trait loses its tree. Corrected here; the printed spelling
 * is left alone wherever a player sees it. `extract-traits.mjs` carries the
 * matching fix for the "Blackmsithing" tree title.
 */
const KEY_FIXES = {
  blacksmith: "blacksmithing", // Keraunomancer, "Expertises: Blacksmith, ..."
  blackmsithing: "blacksmithing",
  smithing: "blacksmithing" // Blacksmith, "Trait: Smithing: Double Duty"
};

/**
 * Printed spellbook lists that are mis-punctuated.
 *
 * The Transmuter reads "spellbooks: jaunt, animal form, repair take, shape" —
 * the comma after "repair" is missing and a stray one splits "take shape",
 * which the PDF confirms by emitting "repair take" as a single text run. Both
 * spells appear under their proper names elsewhere (Apprentice Mage is granted
 * "take shape"), so the run is repaired rather than shipped as two spellbooks
 * that do not exist.
 */
const SPELLBOOK_FIXES = [[["repair take", "shape"], ["repair", "take shape"]]];

/** Apply the printed-list repairs above to one background's spellbook list. */
function fixSpellbooks(list) {
  for (const [printed, corrected] of SPELLBOOK_FIXES) {
    const at = list.findIndex((_, i) => printed.every((p, n) => list[i + n] === p));
    if (at >= 0) list.splice(at, printed.length, ...corrected);
  }
  return list;
}

/* -------------------------------------------- */

/** `Religious Lore` -> `religiousLore`, which is how config keys are written. */
function camelKey(s) {
  const words = s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
  const key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
  return KEY_FIXES[key] ?? key;
}

/** `Acolyte of the Healer` -> `acolyte-of-the-healer`, for filenames and ids. */
function slug(s) {
  return s
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Equipment and spellbook names are printed inside a sentence, so only the
 * first entry of each list carries a capital ("Holy symbol, torch" but
 * "spellbooks: minor healing"). Lower-casing that initial gives every list one
 * canonical form, so the same item does not arrive under two names when the
 * builder resolves it against the gear packs.
 */
function unsentence(s) {
  return s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/* -------------------------------------------- */

/**
 * Split a page into its two columns.
 *
 * The centroids come from a 1-D k-means (k=2) over item x, but items are NOT
 * assigned to the nearer centroid: the last word of a wrapped left-column line
 * sits at x around 195 on a 432pt page, nearer the right column's centroid
 * (about 243) than the left's (about 60). That mistake is silent and
 * destructive. It moved Acolyte of the Three's spellbook "bone capture" into
 * the middle of Archer's equipment, and Gladiator's "rage potion" onto
 * Keraunomancer's Stamina line.
 *
 * So the centroids only bracket the search, and the boundary is the widest
 * UNCOVERED band between them: the real gutter, which no printed line crosses.
 * The band has to be measured over each item's full extent, not its start —
 * gaps between start positions are an artifact of where words happen to begin
 * and put the p1 boundary at x=109, straight through the running text.
 */
function columnBoundary(items) {
  const xs = items.map((i) => i.x).sort((a, b) => a - b);
  if (xs.length < 4) return null;

  let a = xs[0];
  let b = xs[xs.length - 1];
  for (let n = 0; n < 50; n++) {
    const mid = (a + b) / 2;
    const left = xs.filter((x) => x <= mid);
    const right = xs.filter((x) => x > mid);
    if (!left.length || !right.length) break;
    const na = left.reduce((s, x) => s + x, 0) / left.length;
    const nb = right.reduce((s, x) => s + x, 0) / right.length;
    if (na === a && nb === b) break;
    a = na;
    b = nb;
  }

  // Merge the inked spans, then take the widest hole that lies between the
  // two centroids.
  const spans = items.map((i) => [i.x, i.x + i.width]).sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + 0.5) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }

  let best = null;
  for (let i = 1; i < merged.length; i++) {
    const lo = merged[i - 1][1];
    const hi = merged[i][0];
    const centre = (lo + hi) / 2;
    if (centre < a || centre > b) continue;
    const gap = hi - lo;
    if (gap >= 5 && (!best || gap > best.gap)) best = { gap, at: centre };
  }
  return best ? best.at : (a + b) / 2;
}

/**
 * Group a column's items into printed lines.
 *
 * Baselines are clustered before any horizontal sort, for the reason recorded
 * in tools/lib/pdf-text.mjs: a label and its value can differ by a fraction of
 * a point, and sorting by raw y then x emits values ahead of their own labels.
 */
function toLines(items) {
  const sorted = [...items].sort((p, q) => p.y - q.y);
  const clusters = [];
  let cluster = null;
  for (const item of sorted) {
    if (cluster && Math.abs(item.y - cluster.y) <= LINE_TOLERANCE) cluster.items.push(item);
    else {
      cluster = { y: item.y, items: [item] };
      clusters.push(cluster);
    }
  }

  return clusters.map((c) => {
    c.items.sort((p, q) => p.x - q.x);
    let text = "";
    let endX = null;
    for (const item of c.items) {
      // A gap wider than a kerning wobble is a real word or cell break.
      if (endX !== null && item.x - endX > 1.5) text += " ";
      text += item.text;
      endX = item.x + item.width;
    }
    return {
      y: c.y,
      font: Math.max(...c.items.map((i) => i.font)),
      text: text.replace(/\s+/g, " ").trim()
    };
  });
}

/* -------------------------------------------- */

/** The labelled lines of a background, in printed order. */
const LABELS = [
  ["characteristic", /^Characteristic at 2:\s*/i],
  ["stamina", /^Stamina:\s*/i],
  ["trait", /^Trait:\s*/i],
  ["expertises", /^Expertises:\s*/i],
  ["equipment", /^Equipment:\s*/i]
];

/** Split a printed comma list, tolerating a missing space after the comma. */
const commaList = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/* -------------------------------------------- */

async function main() {
  if (!existsSync(BOOK)) {
    console.error(`Characters Book not found at:\n  ${BOOK}\nPass --src "/path/to/packet".`);
    process.exit(1);
  }

  const doc = await getDocument({ data: new Uint8Array(readFileSync(BOOK)), useSystemFonts: true }).promise;

  /* --- Read every page as ordered columns --------------------------- */

  const pages = [];
  /** Gutter violations per page; only the pages this tool reads are reported. */
  const straddlesByPage = new Map();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items = content.items
      .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
      .map((i) => ({
        text: i.str,
        // transform is [a,b,c,d,e,f]; e,f are the translation.
        x: i.transform[4],
        y: vp.height - i.transform[5],
        width: i.width,
        font: Math.abs(i.transform[3])
      }));
    if (!items.length) {
      pages.push({ page: p, boundary: null, columns: [[], []] });
      continue;
    }

    const boundary = columnBoundary(items);
    const columns = [[], []];
    for (const item of items) columns[boundary !== null && item.x >= boundary ? 1 : 0].push(item);

    /**
     * Cross-check the split before a single field is parsed: with the right
     * boundary the gutter is empty, so no printed line may cross it. A
     * straddling item is the signature of the interleaving this whole function
     * exists to prevent, and it is reported rather than quietly parsed.
     *
     * This fires when no clean gutter was found and `columnBoundary` fell back
     * to the midpoint between the centroids — which is what happens on the
     * three-column trait-tree pages, and why only the pages this tool actually
     * reads get reported.
     */
    if (boundary !== null) {
      const crossing = columns[0]
        .filter((item) => item.x + item.width > boundary + 1)
        .map((item) => `p${p}: "${item.text}" runs past the gutter at x=${boundary.toFixed(0)}`);
      if (crossing.length) straddlesByPage.set(p, crossing);
    }

    pages.push({
      page: p,
      boundary,
      columns: columns.map((c) => toLines(c).filter((l) => !NOISE.test(l.text)))
    });
  }

  /* --- The 2d6 Backgrounds table (C p1) ----------------------------- */

  /**
   * Rows read `1 4 Acolyte of the Three`: two d6 cells then a name. The table
   * is the only authority on which backgrounds exist, so it doubles as the
   * roster the section walk is checked against.
   *
   * Only rows under the table's own `d6 d6 Background` header count. The row
   * shape alone is not distinctive enough — the crafting tables later in the
   * book have rows like "1 2 undead parts 50" that match it exactly.
   */
  const rollByName = new Map();
  /** The pages this tool reads, so the gutter report ignores the rest of the book. */
  const read = new Set();

  for (const { page, columns } of pages) {
    for (const lines of columns) {
      const header = lines.findIndex((l) => /^d6\s+d6\s+Background$/i.test(l.text));
      if (header < 0) continue;
      read.add(page);
      for (const line of lines.slice(header + 1)) {
        const m = /^([1-6])\s+([1-6])\s+(\S.*)$/.exec(line.text);
        if (!m) continue;
        rollByName.set(m[3].trim(), { first: Number(m[1]), second: Number(m[2]) });
      }
    }
  }

  const problems = [];
  if (rollByName.size !== 36) problems.push(`roll table has ${rollByName.size} rows, expected 36`);

  /* --- Walk the section, one record per 12pt heading ----------------- */

  const records = [];
  let current = null;

  /**
   * The walk is fenced to the Backgrounds section rather than run over the
   * whole book: the crafting rules later on head a 12pt block "Alchemist" and
   * another "Blacksmith", which are background names, and unfenced they open a
   * second, empty record for each.
   */
  let inSection = false;

  for (const { page, columns } of pages) {
    for (const lines of columns) {
      for (const line of lines) {
        if (line.font >= SECTION_FONT_MIN) {
          inSection = /^Backgrounds$/i.test(line.text);
          current = null; // "Advancement" and friends end the section.
          if (inSection) read.add(page);
          continue;
        }
        if (inSection) read.add(page);
        if (line.font >= NAME_FONT_MIN) {
          // A 12pt heading that is not on the roll table is a sidebar title,
          // and everything under it belongs to no background.
          current = inSection && rollByName.has(line.text) ? { name: line.text, page, lines: [] } : null;
          if (current) records.push(current);
          continue;
        }
        current?.lines.push(line.text);
      }
    }
  }

  /* --- Parse ---------------------------------------------------------- */

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const badKeys = [];
  const summary = [];
  let written = 0;

  for (const record of records) {
    // Fold wrapped continuations back into the field they belong to. The
    // description is whatever precedes the first label.
    const fields = { description: [] };
    let field = "description";
    for (const text of record.lines) {
      const label = LABELS.find(([, re]) => re.test(text));
      if (label) {
        field = label[0];
        fields[field] = [text.replace(label[1], "")];
      } else {
        (fields[field] ??= []).push(text);
      }
    }
    const value = (k) => (fields[k] ?? []).join(" ").replace(/\s+/g, " ").trim();

    const missing = ["description", ...LABELS.map(([k]) => k)].filter((k) => !value(k));
    if (missing.length) problems.push(`${record.name} (p${record.page}): missing ${missing.join(", ")}`);

    /* Characteristic: one name, a choice ("Mind or Strength"), or "Any". */
    const rawChar = value("characteristic");
    const characteristicAt2 = /^any$/i.test(rawChar)
      ? Object.keys(CROWS.characteristics)
      : rawChar
          .split(/\s+or\s+/i)
          .map((s) => camelKey(s))
          .filter(Boolean);
    for (const key of characteristicAt2) {
      if (!CROWS.characteristics[key]) {
        badKeys.push(`${record.name}: characteristic "${key}" (printed "${rawChar}")`);
      }
    }

    const stamina = Number(value("stamina").match(/-?\d+/)?.[0] ?? NaN);
    if (!Number.isInteger(stamina)) problems.push(`${record.name}: unreadable Stamina "${value("stamina")}"`);

    /* Trait: "Tree: Trait Name" — the tree half has to be a config key. */
    const rawTrait = value("trait");
    const traitMatch = /^([^:]+):\s*(.+)$/.exec(rawTrait);
    const traitTree = traitMatch ? camelKey(traitMatch[1]) : "";
    const traitName = traitMatch ? traitMatch[2].trim() : rawTrait;
    if (!traitMatch) {
      problems.push(`${record.name}: trait "${rawTrait}" is not "Tree: Name"`);
    } else if (!CROWS.traitTrees[traitTree]) {
      badKeys.push(`${record.name}: trait tree "${traitTree}" (printed "${traitMatch[1]}")`);
    } else if (!existsSync(join(TRAITS, `${traitTree}-${slug(traitName)}.json`))) {
      // The granted trait has to be a document the traits pack actually holds,
      // or chargen hands out a trait nothing can place on the sheet.
      problems.push(`${record.name}: trait "${traitTree}-${slug(traitName)}" is not in packs-src/traits`);
    }

    /* Expertises: a bare name is 1 use, "(2 uses)" is 2. */
    const expertises = commaList(value("expertises")).map((entry) => {
      const m = /^(.+?)(?:\s*\((\d+)\s*uses?\))?$/i.exec(entry);
      const key = camelKey(m[1]);
      if (!CROWS.expertises[key]) badKeys.push(`${record.name}: expertise "${key}" (printed "${m[1].trim()}")`);
      return { key, uses: m[2] ? Number(m[2]) : 1 };
    });

    /**
     * Equipment is a comma list that may end in a "spellbooks: a, b, c" tail.
     * The spellbooks are pulled out because they resolve against a different
     * pack and are a usage-die resource, not carried gear.
     */
    const rawEquipment = value("equipment");
    const [head, tail = ""] = rawEquipment.split(/\bspellbooks:\s*/i);
    const spellbooks = fixSpellbooks(commaList(tail).map(unsentence));

    let bonusGold = 0;
    const equipment = [];
    for (const entry of commaList(head)) {
      // Merchant and Noble list coin among their gear; it is money, not an item.
      const gold = /^(\d+)\s+(?:extra\s+)?gold(?:\s+coins?)?$/i.exec(entry);
      if (gold) {
        bonusGold += Number(gold[1]);
        continue;
      }
      // A parenthetical count is a quantity; "(pet)" and "(Historical Lore)"
      // are part of the item's name and stay put.
      const qty = /^(.*?)\s*\((\d+)\)$/.exec(entry);
      equipment.push({
        name: unsentence((qty ? qty[1] : entry).trim()),
        quantity: qty ? Number(qty[2]) : 1
      });
    }

    const roll = rollByName.get(record.name) ?? { first: 0, second: 0 };
    const uses = expertises.reduce((n, e) => n + e.uses, 0);
    // The printed range across all 36 backgrounds. Outside it means a comma
    // list was torn or merged, which is exactly what a bad column split does.
    if (uses < 3 || uses > 9) problems.push(`${record.name}: ${uses} expertise uses, outside the printed 3-9`);

    const out = {
      __key: slug(record.name),
      __folder: "Backgrounds",
      name: record.name,
      type: "background",
      img: "icons/svg/mystery-man.svg",
      system: {
        description: value("description") ? `<p>${value("description")}</p>` : "",
        roll,
        characteristicAt2,
        stamina,
        // `trait` is the printed string the DataModel stores; the split halves
        // are carried alongside so the builder can resolve the traits pack
        // without re-parsing prose.
        trait: rawTrait,
        traitTree,
        traitName,
        expertises,
        equipment,
        spellbooks,
        bonusGold,
        source: "Crows Playtest 2, Characters Book"
      }
    };

    writeFileSync(join(OUT, `${out.__key}.json`), JSON.stringify(out, null, 2) + "\n");
    written++;
    summary.push(
      `${record.name.padEnd(22)} ${roll.first}${roll.second}  ` +
        `sta ${String(stamina).padStart(2)}  ${characteristicAt2.join("/").padEnd(21)} ` +
        `${uses} uses  ${String(equipment.length).padStart(2)} items  ${spellbooks.length} books` +
        (bonusGold ? `  +${bonusGold}g` : "")
    );
  }

  /* --- Report --------------------------------------------------------- */

  for (const line of summary) console.log(line);

  const undescribed = [...rollByName.keys()].filter((n) => !records.some((r) => r.name === n));
  if (undescribed.length) problems.push(`on the table but never described: ${undescribed.join(", ")}`);

  const readPages = [...read].sort((a, b) => a - b);
  console.log(
    `\n${written} backgrounds from pages ${readPages[0]}-${readPages[readPages.length - 1]} ` +
      `-> packs-src/backgrounds/`
  );

  const straddles = readPages.flatMap((p) => straddlesByPage.get(p) ?? []);
  if (straddles.length) {
    console.log(`\n${straddles.length} line(s) cross the column gutter — the split is wrong:`);
    for (const x of straddles.slice(0, 20)) console.log(`  ! ${x}`);
  }
  if (badKeys.length) {
    console.log(`\n${badKeys.length} key(s) not in src/config.mjs:`);
    for (const x of badKeys) console.log(`  ! ${x}`);
  }
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const x of problems) console.log(`  ! ${x}`);
  }
  if (!straddles.length && !badKeys.length && !problems.length) console.log("no problems");
}

main();
