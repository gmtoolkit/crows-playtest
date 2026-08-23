/**
 * Extract the 71 creature stat blocks from The Ref Book into
 * `packs-src/creatures/*.json`.
 *
 * The printed block is regular enough to parse reliably once the PDF's columns
 * are resolved (see tools/lib/pdf-text.mjs):
 *
 *   Blood Creature B
 *   Size: Small Power: 3 Type: Blood
 *   Stamina: 15 Speed: 6, climb 6 (U)
 *   Agility: 2 Mind: -1 Strength: 1
 *   Attack Range 12-16 17+
 *   Bite (+2) Melee 1 3 dam* 4 dam*
 *   *Tendril Snare
 *   When this creature gets a tier 3 result...
 *
 * Attacks become embedded `attack` items and named riders become `feature`
 * items, so both are rollable and reusable rather than trapped in prose. The
 * asterisk convention is preserved: an attack marked `4 dam*` links to the
 * `*Tendril Snare` feature via `noteRef`.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPages, flatten } from "./lib/pdf-text.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, "packs-src", "creatures");

const args = process.argv.slice(2);
const srcIndex = args.indexOf("--src");
const SRC =
  srcIndex >= 0
    ? args[srcIndex + 1]
    : "C:/Users/Cliff/Downloads/MCDM Crows Public Playtest August-Sept 2026/MCDM Crows Public Playtest August-Sept 2026";

const REF_BOOK = join(SRC, "03 Crows The Ref Book for Playtest 2.pdf");

/* -------------------------------------------- */

const SIZE_MAP = {
  tiny: "tiny",
  small: "small",
  medium: "medium",
  large: "large",
  huge: "huge",
  "holy shit": "holyShit",
  "holy shit!": "holyShit"
};

const TYPE_MAP = {
  animal: { category: "animal", monsterType: "" },
  human: { category: "human", monsterType: "" },
  blood: { category: "monster", monsterType: "blood" },
  undead: { category: "monster", monsterType: "undead" },
  angel: { category: "monster", monsterType: "angel" },
  demon: { category: "monster", monsterType: "demon" },
  plant: { category: "monster", monsterType: "plant" },
  unique: { category: "monster", monsterType: "unique" }
};

/** Illustrations shipped in the packet, keyed by creature name. */
const ART = {
  "Blood Creature A": "blood-creature-a",
  "Blood Creature B": "blood-creature-b",
  "Blood Creature C": "blood-creature-c",
  "Undead A": "undead-a",
  "Undead B": "undead-b",
  "Undead Creature C": "undead-c",
  "Undead Creature D": "undead-d",
  "Undead Creature E": "undead-e",
  "Undead Creature F": "undead-f",
  "Undead Creature G": "undead-g",
  "Undead Creature H": "undead-h"
};

const NOISE = /^(©\s*2026|MCDM Productions|\d{1,3}$|<<<PAGE)/i;

/* -------------------------------------------- */

/**
 * PDF kerning occasionally joins a value to the next label ("5Slots: 10",
 * "Rustswords(+5)*Melee 1") because the glyph gap falls under the
 * space-insertion threshold. Re-separating at known label boundaries is safer
 * than loosening that threshold, which would inject spaces inside words.
 */
function normalise(line) {
  return line
    .replace(/(?<=[\w)*])(?=(?:Size|Power|Type|Stamina|Speed|Slots|Reactions|Agility|Mind|Strength):)/g, " ")
    .replace(/(?<=[)*])(?=(?:Melee|Ranged|Range)\b)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `Size: Medium Power: 4 Type: Animal` */
const RE_LINE1 = /^Size:\s*(.+?)\s+Power:\s*(-?\d+)\s+Type:\s*(\w+)/i;
/** `Stamina: 10 Speed: 5, climb 5 Slots: 10` (Slots/Reactions optional) */
const RE_LINE2 = /^Stamina:\s*(\d+)\s+Speed:\s*(.+?)(?:\s*Slots:\s*(\d+))?(?:\s*Reactions:\s*(\d+))?$/i;
/** `Agility: 1 Mind: -1 Strength: 2` */
const RE_LINE3 = /^Agility:\s*(-?\d+)\s+Mind:\s*(-?\d+)\s+Strength:\s*(-?\d+)/i;
/** The attack table header. */
const RE_ATTACK_HEADER = /^Attack\s+Range\s+12-16\s+17\+/i;
/** `Punch (+2) Melee 1 3 dam 5 dam`, `Claws (+2) Melee 1 (2 tar) 2 dam 3 dam` */
const RE_ATTACK =
  /^(.+?)\s*\(([+-]\d+)\)(\*{0,2})\s*(Melee|Ranged|Range)\s+(\d+)(?:\s*\((\d+)\s*tar\))?\s+(.+)$/i;

/** Pull the two damage columns out of an attack row's tail. */
function splitDamage(tail) {
  const tokens = [...tail.matchAll(/(\d+(?:d\d+)?)\s*(P)?\s*dam(\*{0,2})/gi)];
  if (tokens.length >= 2) {
    const [a, b] = tokens.slice(-2);
    return {
      tier2: `${a[1]}${a[2] ? " P" : ""} dam`,
      tier3: `${b[1]}${b[2] ? " P" : ""} dam`,
      piercing: !!(a[2] || b[2]),
      riderTiers: [a[3] ? 2 : null, b[3] ? 3 : null].filter(Boolean)
    };
  }
  // Some rows print an effect rather than damage.
  return { tier2: tail.trim(), tier3: "", piercing: false, riderTiers: [] };
}

/** Speed line: `6, climb 6 (U)` or `5` or `7, fly 8`. */
function parseSpeed(text) {
  const speed = { walk: 0, climb: 0, fly: 0, swim: 0, burrow: 0, upsideDown: false };
  if (/\(U\)/i.test(text)) speed.upsideDown = true;
  const clean = text.replace(/\(U\)/gi, "");

  for (const part of clean.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(climb|fly|swim|burrow)?\s*(\d+)$/i.exec(t);
    if (!m) continue;
    const key = (m[1] ?? "walk").toLowerCase();
    speed[key] = Number(m[2]);
  }
  return speed;
}

/**
 * Words that open a sentence, never a feature title.
 *
 * Feature prose wraps mid-sentence, and a wrapped line like "When this
 * creature's sword attack kills a" is short, capitalised, and unpunctuated —
 * indistinguishable from a title by shape alone. It was being promoted to a
 * feature, which both invented a phantom feature AND left the real one
 * ("Exploding Sword") with an empty description.
 */
const SENTENCE_OPENERS = new Set([
  "when", "if", "the", "a", "an", "this", "these", "while", "each", "after",
  "once", "as", "at", "on", "in", "for", "any", "you", "they", "their", "it",
  "whenever", "during", "before", "unless", "until", "creature", "roll"
]);

/** A plausible feature title: short, title-cased, not a wrapped sentence. */
function isFeatureTitle(line) {
  if (!line || line.length > 64) return false;
  if (NOISE.test(line)) return false;
  if (/[.;,]$/.test(line)) return false;

  const bare = line.replace(/^\*+/, "").trim();
  if (!/^[A-Z]/.test(bare)) return false;

  const words = bare.split(/\s+/);
  if (words.length > 7) return false;
  if (SENTENCE_OPENERS.has(words[0].toLowerCase())) return false;

  /**
   * Test title-casing on the name ONLY, with any usage parenthetical removed.
   * "Insect Breath (3/day; only once per turn)" is unmistakably a title, but
   * counting "only", "once" and "turn)" as lowercase words dragged it below
   * the threshold and silently dropped the feature.
   */
  const withoutParens = bare.replace(/\([^)]*\)/g, "").trim();
  if (!withoutParens) return false;

  const significant = withoutParens.split(/\s+/).filter((w) => w.length > 3);
  const capitalised = significant.filter((w) => /^[A-Z]/.test(w)).length;
  return significant.length === 0 || capitalised / significant.length >= 0.6;
}

/* -------------------------------------------- */

function slug(s) {
  return s
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/* -------------------------------------------- */

async function main() {
  if (!existsSync(REF_BOOK)) {
    console.error(`The Ref Book not found at:\n  ${REF_BOOK}\nPass --src "/path/to/packet".`);
    process.exit(1);
  }

  const cache = join(root, "tools", ".cache", "ref.txt");
  let lines;
  if (existsSync(cache)) {
    lines = readFileSync(cache, "utf8").split("\n");
  } else {
    lines = flatten(await extractPages(REF_BOOK)).map(normalise);
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, lines.join("\n"));
  }

  // Index every stat block by the line holding its `Size:` row.
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (RE_LINE1.test(lines[i])) starts.push(i);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const problems = [];
  let written = 0;

  /**
   * Section headings and preamble markers that mean "this creature's stat
   * block is over".
   *
   * Without these, feature collection ran from the end of one block all the
   * way to the next `Size:` line, swallowing the next creature's name, its
   * description, chapter headings, and whole encounter tables. The Ring
   * Collector picked up fifteen phantom features that way, including most of
   * the Undead chapter.
   */
  const SECTION_HEADINGS = new Set([
    "Animals",
    "Humans",
    "Monsters",
    "Uniques",
    "Undead",
    "Blood Creatures",
    "Demons",
    "Angels",
    "Plants",
    "Likes",
    "Hates",
    "Monster Names",
    "No Darkness Penalty",
    "Hates And Likes",
    "Suspicious Circumstances",
    "Ending the Fight",
    "Potential Pets",
    "Wild Animals",
    "Creature Stats",
    "Slots",
    "Power",
    "Reactions",
    "X/Rest",
    "Attacks That Grab",
    "Draft Animal"
  ]);
  const RE_PREAMBLE = /^(Colloquial names|Common names)\s*:/i;
  const RE_TABLE_HEADING = /(Encounters|Encounter Table)$/i;

  for (let s = 0; s < starts.length; s++) {
    const i = starts[s];
    const hardEnd = s + 1 < starts.length ? starts[s + 1] - 1 : lines.length;
    const name = lines[i - 1]?.trim();

    // Stop at whichever comes first: the next creature's preamble, a chapter
    // heading, or the next stat block.
    let end = hardEnd;
    const nextName = s + 1 < starts.length ? lines[starts[s + 1] - 1]?.trim() : null;
    for (let j = i + 3; j < hardEnd; j++) {
      const line = lines[j]?.trim();
      if (!line) continue;
      if (
        (nextName && line === nextName) ||
        RE_PREAMBLE.test(line) ||
        SECTION_HEADINGS.has(line) ||
        RE_TABLE_HEADING.test(line) ||
        // A heading immediately followed by "Common names:" starts the NEXT
        // creature, even when it is spelled differently from its stat title
        // ("Undead G" heading vs "Undead Creature G" stat block).
        RE_PREAMBLE.test(lines[j + 1]?.trim() ?? "")
      ) {
        end = j;
        break;
      }
    }

    if (!name || NOISE.test(name)) {
      problems.push(`no name before line ${i}: ${lines[i]}`);
      continue;
    }

    const m1 = RE_LINE1.exec(lines[i]);
    const m2 = RE_LINE2.exec(lines[i + 1] ?? "");
    const m3 = RE_LINE3.exec(lines[i + 2] ?? "");

    if (!m2 || !m3) {
      problems.push(`${name}: could not read stat lines (${lines[i + 1]} | ${lines[i + 2]})`);
      continue;
    }

    const typeKey = m1[3].toLowerCase();
    const typeInfo = TYPE_MAP[typeKey];
    if (!typeInfo) problems.push(`${name}: unknown Type "${m1[3]}"`);

    const sizeKey = SIZE_MAP[m1[1].trim().toLowerCase()];
    if (!sizeKey) problems.push(`${name}: unknown Size "${m1[1]}"`);

    /* --- Preamble: colloquial names and description ------------------- */

    let colloquial = "";
    const descriptionLines = [];
    // Monsters repeat their name as a heading above a description block.
    for (let j = i - 2; j >= Math.max(0, i - 40); j--) {
      const line = lines[j];
      if (!line || NOISE.test(line)) continue;
      if (RE_LINE1.test(line)) break;
      // The books use both "Colloquial names:" (blood creatures) and
      // "Common names:" (undead). Matching only the first silently dropped
      // every undead description.
      if (RE_PREAMBLE.test(line)) {
        colloquial = line.replace(RE_PREAMBLE, "").trim();
        break;
      }
      if (line === name) break;
      descriptionLines.unshift(line);
    }
    // Only keep a description when it sits under a repeated name heading.
    const hasHeading = lines.slice(Math.max(0, i - 40), i - 1).includes(name);
    const description = hasHeading || colloquial ? descriptionLines.join(" ").trim() : "";

    /* --- Body: expertises, equipment, attacks, features --------------- */

    let expertises = "";
    let equipment = "";
    let armorDefense = 0;
    let armorSource = "";
    const attacks = [];
    const features = [];
    let current = null;
    let inAttacks = false;

    for (let j = i + 3; j < end; j++) {
      const line = lines[j]?.trim();
      if (!line || NOISE.test(line)) continue;
      if (line === name) continue;

      /**
       * Armed humans print their Armor Defense as a line of its own:
       * "AD: 24 (heavy armor, shield, sword)". This is real data — the pool
       * that absorbs damage before Stamina — and was being filed as a
       * description-less "feature" instead of reaching system.ad.
       */
      const adLine = /^AD:\s*(\d+)\s*(?:\((.+)\))?$/i.exec(line);
      if (adLine) {
        armorDefense = Number(adLine[1]);
        armorSource = adLine[2] ?? "";
        continue;
      }

      // Some blocks qualify the label: "Expertises (2 uses all): Athletics…".
      if (/^Expertises\b[^:]{0,30}:/i.test(line)) {
        expertises = line.replace(/^Expertises\b[^:]{0,30}:\s*/i, "");
        continue;
      }
      if (/^Equipment:/i.test(line)) {
        equipment = line.replace(/^Equipment:\s*/i, "");
        continue;
      }
      if (RE_ATTACK_HEADER.test(line)) {
        inAttacks = true;
        continue;
      }

      const atk = inAttacks ? RE_ATTACK.exec(line) : null;
      if (atk) {
        const dmg = splitDamage(atk[7]);
        attacks.push({
          name: atk[1].trim(),
          bonus: Number(atk[2]),
          rangeType: /melee/i.test(atk[4]) ? "melee" : "ranged",
          rangeValue: Number(atk[5]),
          targets: atk[6] ? Number(atk[6]) : 1,
          markers: atk[3] ?? "",
          ...dmg
        });
        continue;
      }

      // Past the attack table, everything is named features and their prose.
      if (isFeatureTitle(line)) {
        inAttacks = false;
        current = { name: line.replace(/^\*+/, "").trim(), markers: (line.match(/^\*+/) ?? [""])[0], text: [] };
        features.push(current);
      } else if (current) {
        current.text.push(line);
      }
    }

    /* --- Link asterisked attacks to their rider features -------------- */

    for (const attack of attacks) {
      if (!attack.markers) continue;
      const match =
        features.find((f) => f.markers === attack.markers) ??
        features.find((f) => f.markers) ??
        null;
      if (match) attack.noteRef = match.name;
    }

    /* --- Build the document ------------------------------------------ */

    const art = ART[name];
    const doc = {
      __key: slug(name),
      __folder:
        typeInfo?.category === "animal"
          ? "Animals"
          : typeInfo?.category === "human"
            ? "Humans"
            : typeInfo?.monsterType === "unique"
              ? "Uniques"
              : `${(typeInfo?.monsterType ?? "monster").replace(/^./, (c) => c.toUpperCase())} Creatures`,
      name,
      type: "creature",
      img: art ? `systems/crows/assets/art/${art}.webp` : "icons/svg/mystery-man.svg",
      prototypeToken: {
        name,
        texture: { src: art ? `systems/crows/assets/art/${art}-token.webp` : "icons/svg/mystery-man.svg" },
        width: sizeKey === "large" ? 2 : sizeKey === "huge" ? 3 : sizeKey === "holyShit" ? 4 : 1,
        height: sizeKey === "large" ? 2 : sizeKey === "huge" ? 3 : sizeKey === "holyShit" ? 4 : 1,
        disposition: typeInfo?.category === "monster" ? -1 : 0,
        actorLink: false,
        sight: {
          enabled: true,
          // Monsters take no penalty from darkness (F p30); humans and animals
          // need light like a crow does.
          range: typeInfo?.category === "monster" ? 60 : 0,
          visionMode: "basic"
        }
      },
      system: {
        category: typeInfo?.category ?? "monster",
        monsterType: typeInfo?.monsterType ?? "",
        size: sizeKey ?? "medium",
        power: Number(m1[2]),
        stamina: { value: Number(m2[1]), max: Number(m2[1]) },
        speed: parseSpeed(m2[2]),
        reactions: m2[4] ? Number(m2[4]) : 1,
        characteristics: {
          agility: { value: Number(m3[1]) },
          mind: { value: Number(m3[2]) },
          strength: { value: Number(m3[3]) }
        },
        // Armed humans carry Armor Defense; it absorbs before Stamina.
        ad: { value: armorDefense, max: armorDefense },
        // Humans and animals take wounds; the printed Slots figure is their cap.
        wounds: { value: 0, max: m2[3] ? Number(m2[3]) : 10 },
        colloquialNames: colloquial,
        description: description ? `<p>${description}</p>` : "",
        secrets: [armorSource && `<p><strong>Armor Defense:</strong> ${armorDefense} (${armorSource})</p>`, expertises && `<p><strong>Expertises:</strong> ${expertises}</p>`, equipment && `<p><strong>Equipment:</strong> ${equipment}</p>`]
          .filter(Boolean)
          .join(""),
        source: "Crows Playtest 2, The Ref Book"
      },
      items: [
        ...attacks.map((a) => ({
          name: a.name,
          type: "attack",
          img: "icons/svg/sword.svg",
          system: {
            characteristic: "none",
            bonus: a.bonus,
            range: { type: a.rangeType, value: a.rangeValue },
            targets: a.targets,
            tier2: a.tier2,
            tier3: a.tier3,
            piercing: a.piercing,
            riderTiers: a.riderTiers,
            noteRef: a.noteRef ?? "",
            source: "Crows Playtest 2, The Ref Book"
          }
        })),
        ...features.map((f) => ({
          name: f.name,
          type: "feature",
          img: "icons/svg/aura.svg",
          system: {
            description: f.text.length ? `<p>${f.text.join(" ")}</p>` : "",
            // "Vanish (1/Rest)" prints its budget in the title.
            uses: (() => {
              const m = /\((\d+)\s*\/\s*(Rest|DT|Round|Day)\)/i.exec(f.name);
              return m
                ? { value: Number(m[1]), max: Number(m[1]), per: m[2].toLowerCase() === "dt" ? "dt" : m[2].toLowerCase() }
                : { value: 0, max: 0, per: "rest" };
            })(),
            affectsTurnEconomy: /extra action|additional action/i.test(f.name + f.text.join(" ")),
            source: "Crows Playtest 2, The Ref Book"
          }
        }))
      ]
    };

    writeFileSync(join(OUT, `${doc.__key}.json`), JSON.stringify(doc, null, 2) + "\n");
    written++;
  }

  console.log(`${written} creatures -> packs-src/creatures/`);
  if (problems.length) {
    console.log(`\n${problems.length} problems:`);
    for (const p of problems) console.log(`  ! ${p}`);
  }
}

main();
