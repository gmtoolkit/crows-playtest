/**
 * Extract the 23 trait trees from the Characters Book into
 * `packs-src/traits/*.json`.
 *
 * The printed trees are a 3-column grid of boxes joined by black bars, and the
 * bars ARE the rules: "You can only purchase a starting trait on a trait tree
 * or a trait connected by a line to another trait you already have on the same
 * tree" (C p7). So the connectors have to be read, not assumed — inferring
 * "anything in the row above unlocks this" would silently invent purchase
 * paths the book does not grant.
 *
 * Boxes and bars both come out of the PDF's vector operators rather than its
 * text: op 22 draws a rectangle (a trait box), op 20 draws a line (a
 * connector) whose real position lives in the current transform matrix, so the
 * CTM is tracked through save/restore/transform to place them.
 *
 * Text is then assigned to whichever box contains it. Trait names are set at
 * 10pt against 9pt for everything else, which separates the title from the
 * cost line and the description without parsing prose.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, "packs-src", "traits");

const args = process.argv.slice(2);
const srcIndex = args.indexOf("--src");
const SRC =
  srcIndex >= 0
    ? args[srcIndex + 1]
    : "C:/Users/Cliff/Downloads/MCDM Crows Public Playtest August-Sept 2026/MCDM Crows Public Playtest August-Sept 2026";

const BOOK = join(SRC, "02 Crows Characters Book for Playtest 2.pdf");

/** Trait names are set larger than their cost line and description. */
const NAME_FONT_MIN = 9.6;

/** Tree titles are larger still. */
const TITLE_FONT_MIN = 11.5;

/* -------------------------------------------- */

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5]
];

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Pull the trait boxes and connector bars off a page.
 *
 * pdfjs hands back a minimal bounding box for each path; for a line that box
 * is degenerate ([0,0,w,0]) because its placement is in the transform matrix,
 * hence the CTM bookkeeping.
 */
function extractShapes(ops, pageHeight) {
  const boxes = [];
  const lines = [];

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i];

    if (fn === OPS.save) {
      stack.push([...ctm]);
      continue;
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === OPS.transform) {
      ctm = mul(ctm, a);
      continue;
    }
    if (fn !== OPS.constructPath) continue;

    const kind = a[0];
    const bbox = a[2];
    if (!bbox) continue;

    const [x0, y0] = apply(ctm, bbox[0], bbox[1]);
    const [x1, y1] = apply(ctm, bbox[2], bbox[3]);

    const rect = {
      x: Math.min(x0, x1),
      y: pageHeight - Math.max(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0)
    };

    // A trait box has real area; a connector is a thin bar.
    if (rect.w > 40 && rect.h > 40) boxes.push(rect);
    else if (rect.w > 2 || rect.h > 2) lines.push(rect);
  }

  return { boxes, lines };
}

/* -------------------------------------------- */

function slug(s) {
  return s
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

const inside = (box, x, y) => x >= box.x - 2 && x <= box.x + box.w + 2 && y >= box.y - 2 && y <= box.y + box.h + 2;

/* -------------------------------------------- */

async function main() {
  if (!existsSync(BOOK)) {
    console.error(`Characters Book not found at:\n  ${BOOK}\nPass --src "/path/to/packet".`);
    process.exit(1);
  }

  const doc = await getDocument({ data: new Uint8Array(readFileSync(BOOK)), useSystemFonts: true }).promise;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const problems = [];
  let written = 0;
  let treeCount = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items = content.items
      .filter((i) => i.str.trim())
      .map((i) => ({
        text: i.str,
        x: i.transform[4],
        y: vp.height - i.transform[5],
        font: Math.abs(i.transform[3])
      }));

    // A trait-tree page opens with the tree name set larger than anything else.
    const title = items.find((i) => i.font >= TITLE_FONT_MIN);
    if (!title) continue;

    const ops = await page.getOperatorList();
    const { boxes, lines } = extractShapes(ops, vp.height);
    if (boxes.length < 3) continue; // not a tree page

    treeCount++;
    const treeName = title.text.trim();
    // "Blackmsithing" is a typo in the printed book. The key has to match
    // CROWS.traitTrees or the tree loses its label and its expertise link, so
    // it is corrected here while the printed name is left alone.
    const TREE_KEY_FIXES = { blackmsithing: "blacksmithing" };
    const rawKey = slug(treeName);
    const treeKey = TREE_KEY_FIXES[rawKey] ?? rawKey;

    /* --- Assign text to boxes ---------------------------------------- */

    const traits = [];
    for (const box of boxes) {
      const contained = items
        .filter((i) => inside(box, i.x, i.y))
        .sort((a, b) => a.y - b.y || a.x - b.x);
      if (!contained.length) continue;

      // Name lines are the larger font at the top of the box.
      const nameParts = [];
      const rest = [];
      for (const i of contained) {
        if (i.font >= NAME_FONT_MIN && !rest.length) nameParts.push(i.text.trim());
        else rest.push(i);
      }
      const name = nameParts.join(" ").replace(/\s+/g, " ").trim();
      if (!name) continue;

      const costLine = rest.find((i) => /XP Cost:/i.test(i.text));
      const m = costLine ? /XP Cost:\s*([\d,]+)\s*(\(Starting\))?/i.exec(costLine.text) : null;

      const description = rest
        .filter((i) => i !== costLine)
        .map((i) => i.text.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      traits.push({
        name,
        cost: m ? Number(m[1].replace(/,/g, "")) : 0,
        starting: !!m?.[2],
        description,
        box
      });
    }

    if (!traits.length) {
      problems.push(`${treeName} (page ${p}): boxes found but no trait text`);
      continue;
    }

    /* --- Grid position ------------------------------------------------ */

    const cols = [...new Set(traits.map((t) => Math.round(t.box.x)))].sort((a, b) => a - b);
    const rows = [...new Set(traits.map((t) => Math.round(t.box.y)))].sort((a, b) => a - b);
    for (const t of traits) {
      t.column = cols.findIndex((c) => Math.abs(c - t.box.x) < 6);
      t.row = rows.findIndex((r) => Math.abs(r - t.box.y) < 6);
    }

    /* --- Prerequisites, read off the connector bars ------------------- */

    /**
     * A bar joins the traits it physically touches. Vertical bars link a box
     * to the one below it; the horizontal bars are what let one purchase open
     * two branches, which is exactly the structure a same-column-only guess
     * would have thrown away.
     */
    const touches = (t, line) => {
      const bx0 = t.box.x - 3;
      const bx1 = t.box.x + t.box.w + 3;
      const by0 = t.box.y - 3;
      const by1 = t.box.y + t.box.h + 3;
      const lx0 = line.x;
      const lx1 = line.x + line.w;
      const ly0 = line.y;
      const ly1 = line.y + line.h;
      return lx1 >= bx0 && lx0 <= bx1 && ly1 >= by0 && ly0 <= by1;
    };

    for (const t of traits) t.prerequisites = new Set();

    /**
     * Connectors form a GRAPH, not a set of independent bars.
     *
     * A single trait rarely touches a single bar. The common shape is
     * box -> short vertical stub -> long horizontal rail -> stub -> box, and
     * the rail touches no box at all, sitting in the gap between rows. Testing
     * bars one at a time therefore found only the plain vertical links and
     * missed every branch — which is exactly the structure that lets one
     * purchase open two options, so losing it would have quietly narrowed the
     * tree.
     *
     * So: union touching segments into components, then link every box a
     * component reaches.
     */
    const segTouches = (a, b) => {
      const pad = 2.5;
      return (
        a.x <= b.x + b.w + pad &&
        b.x <= a.x + a.w + pad &&
        a.y <= b.y + b.h + pad &&
        b.y <= a.y + a.h + pad
      );
    };

    const parent = lines.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i, j) => {
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[a] = b;
    };

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (segTouches(lines[i], lines[j])) union(i, j);
      }
    }

    const components = new Map();
    lines.forEach((line, i) => {
      const key = find(i);
      components.set(key, [...(components.get(key) ?? []), line]);
    });

    for (const segments of components.values()) {
      const reached = traits.filter((t) => segments.some((line) => touches(t, line)));
      if (reached.length < 2) continue;
      for (const a of reached) {
        for (const b of reached) {
          // The higher trait unlocks the lower one.
          if (a.row < b.row) b.prerequisites.add(a.name);
        }
      }
    }

    // Safety net: a non-starting trait with no connector reaching it still has
    // the implied vertical link, and a trait nothing can unlock is unbuyable.
    for (const t of traits) {
      if (t.starting || t.prerequisites.size) continue;
      const above = traits.find((o) => o.column === t.column && o.row === t.row - 1);
      if (above) {
        t.prerequisites.add(above.name);
        problems.push(`${treeName}: no connector found into "${t.name}", assumed the trait above it`);
      }
    }

    /* --- Write -------------------------------------------------------- */

    for (const t of traits) {
      const doc = {
        __key: `${treeKey}-${slug(t.name)}`,
        __folder: treeName,
        name: t.name,
        type: "trait",
        img: "icons/svg/upgrade.svg",
        system: {
          tree: treeKey,
          cost: t.cost,
          starting: t.starting,
          prerequisites: [...t.prerequisites],
          row: t.row,
          column: t.column,
          description: t.description ? `<p>${t.description}</p>` : "",
          source: "Crows Playtest 2, Characters Book"
        }
      };
      writeFileSync(join(OUT, `${doc.__key}.json`), JSON.stringify(doc, null, 2) + "\n");
      written++;
    }

    console.log(
      `${treeName}: ${traits.length} traits, ${rows.length} rows x ${cols.length} cols, ` +
        `${lines.length} connectors, ${traits.filter((t) => t.starting).length} starting`
    );
  }

  console.log(`\n${written} traits across ${treeCount} trees -> packs-src/traits/`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const x of problems) console.log(`  ! ${x}`);
  }
}

main();
