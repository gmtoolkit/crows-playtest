/**
 * Grid-layout PDF extraction, for the printed inventory card decks.
 *
 * The rulebooks are a two-column flow (see pdf-text.mjs). The card decks are
 * not: they are a GRID of cards, five across, and reading them as columns
 * interleaves five different cards into one line —
 * "Hammer Stack 2 Mace Stack 1 Knife Stack 2 Sword Stack 1 Handaxe Stack 2".
 *
 * Cards butt against each other with no empty vertical band between them, so
 * the occupancy-gap trick that finds a column gutter finds nothing here. What
 * DOES work: card text starts at the card's left edge, so a histogram of
 * line-start x across the whole deck shows one sharp peak per card column.
 *
 * Measured on the Playtest 2 annotated deck: peaks at x = 18, 126, 234, 342,
 * 450 — exactly 108pt apart — and rows 188pt apart. The card's crafting and
 * price footer is set at 7.5pt against 11pt body text, which separates the
 * footer from the card body without parsing it.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

/** Items whose baselines are within this many points are the same line. */
const LINE_TOLERANCE = 3;

/**
 * Footer text (crafting requirements, price) is set smaller than the body.
 *
 * Measured across the whole deck: body runs 8-11pt because cards shrink their
 * text to fit a long description, and footers are 6.5-7.5pt. A threshold of 9
 * therefore swallowed real body lines, which split rows mid-card and turned
 * 108 cards into 315 fragments. 7.6 sits in the gap with room for float error.
 */
const FOOTER_MAX_FONT = 7.6;

/**
 * Extract a card-grid PDF into an array of cards.
 *
 * @param {string} path
 * @param {object} [opts]
 * @param {number} [opts.minPeak]  Items needed at an x for it to be a column edge.
 * @returns {Promise<Array<{page:number,row:number,col:number,lines:string[],footer:string[]}>>}
 */
export async function extractCards(path, { minPeak = 20 } = {}) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  let pageWidth = 0;
  let pageHeight = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    pageWidth = Math.max(pageWidth, viewport.width);
    pageHeight = Math.max(pageHeight, viewport.height);

    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
        .map((i) => ({
          text: i.str,
          x: i.transform[4],
          y: viewport.height - i.transform[5],
          width: i.width,
          // transform[3] is the vertical scale, i.e. the rendered font size.
          font: Math.abs(i.transform[3])
        }))
    );
  }

  /**
   * Segment by ROW first, then detect the column pitch within each row.
   *
   * The grid is not fixed per document, and not even per page. Page 6 carries
   * rows of five narrow cards AND a row of three wide ones (the two-slot
   * weapons), so one pitch for the page cuts the wide cards in half and loses
   * their 17+ damage column.
   *
   * What IS reliably uniform is a ROW: every card in it has the same width and
   * ends with the same small-set footer band. Those footer bands run as
   * horizontal stripes across the page, so the regions between them are
   * exactly the card rows — found without knowing anything about columns.
   */
  const cards = [];
  for (const [pageIndex, items] of pages.entries()) {
    for (const region of rowRegions(items)) {
      const columns = detectColumns(region, Math.max(2, Math.round(minPeak / 8)));
      if (!columns.length) continue;

      for (let c = 0; c < columns.length; c++) {
        const x0 = columns[c] - 4; // slack: some glyphs start left of the edge
        const x1 = c === columns.length - 1 ? Infinity : columns[c + 1] - 4;

        const cell = region.filter((i) => i.x >= x0 && i.x < x1);
        if (!cell.length) continue;

        const { lines, footer } = cellToLines(cell);
        if (!lines.length && !footer.length) continue;

        cards.push({ page: pageIndex + 1, col: c, lines, footer });
      }
    }
  }
  await doc.cleanup?.();
  return cards;
}

/* -------------------------------------------- */

/**
 * Card column left edges, from a histogram of where text starts.
 *
 * Only peaks that form an evenly-spaced run are kept — an indented block
 * inside a card also produces a peak, but it will not sit on the card pitch.
 */
function detectColumns(items, minPeak) {
  /**
   * Histogram every text run's x, not the leftmost run per row.
   *
   * "Line starts" sounds more precise and is wrong here: a row of cards is one
   * row of text spanning every column, so taking the minimum x per row records
   * only the FIRST column and leaves the other four with no votes at all.
   */
  const hist = new Map();
  for (const i of items) {
    const bucket = Math.round(i.x / 2) * 2;
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
  }
  if (!hist.size) return [];

  /**
   * Find the card PITCH by autocorrelation, then anchor at the left margin.
   *
   * No count threshold can isolate card edges here. On a weapons page the
   * interior positions ("Attack", "2d10 + S") repeat once per card, so they
   * are just as numerous as the edges AND sit on exactly the same pitch —
   * picking peaks by count or by even spacing selects them just as happily,
   * which clipped the wide cards and lost their 17+ damage column.
   *
   * But that same repetition makes the pitch itself unambiguous: the whole
   * page correlates with itself at one card width. And the first card always
   * begins at the left margin, so the leftmost text anchors the grid. Neither
   * step needs to know which peaks are edges.
   */
  const xs = [...hist.keys()].sort((a, b) => a - b);
  const minX = xs[0];
  const maxX = xs.at(-1);
  const span = maxX - minX;
  if (span < 60) return [minX];

  let bestScore = 0;
  const scores = new Map();
  for (let pitch = 60; pitch <= Math.max(60, span); pitch += 2) {
    let score = 0;
    for (const [x, n] of hist) score += Math.min(n, hist.get(x + pitch) ?? 0);
    scores.set(pitch, score);
    if (score > bestScore) bestScore = score;
  }
  if (!bestScore) return [minX];

  // Prefer the SMALLEST pitch that explains the page nearly as well as the
  // best one: a 2-column reading also correlates on a 4-column page, and
  // taking the larger period would merge every second pair of cards.
  const pitch = [...scores.entries()]
    .filter(([, s]) => s >= bestScore * 0.9)
    .sort((a, b) => a[0] - b[0])[0][0];

  const columns = [];
  for (let x = minX; x <= maxX + 4; x += pitch) columns.push(x);
  return columns;
}

/* -------------------------------------------- */

/**
 * Turn one cell's items into ordered lines, splitting the small-set footer
 * (crafting requirements and price) from the card body.
 *
 * Baselines are clustered BEFORE sorting horizontally — the same trap as the
 * rulebook extractor: a label and its value can differ by a fraction of a
 * point, and y-first ordering emits them out of order.
 */
function cellToLines(cell, { keepOrder = false } = {}) {
  const sorted = [...cell].sort((a, b) => a.y - b.y);

  const clusters = [];
  let cluster = null;
  for (const item of sorted) {
    if (cluster && Math.abs(item.y - cluster.y) <= LINE_TOLERANCE) cluster.items.push(item);
    else {
      cluster = { y: item.y, items: [item] };
      clusters.push(cluster);
    }
  }

  const ordered = [];

  for (const c of clusters) {
    c.items.sort((a, b) => a.x - b.x);
    let text = "";
    let endX = null;
    for (const item of c.items) {
      if (endX !== null && item.x - endX > 1.2) text += " ";
      text += item.text;
      endX = item.x + item.width;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const smallest = Math.min(...c.items.map((i) => i.font));
    ordered.push({ text, isFooter: smallest <= FOOTER_MAX_FONT, y: c.y });
  }

  // Segmentation needs the lines in document order with their font class;
  // callers that just want a cell's contents get them pre-split.
  if (keepOrder) return ordered;

  return {
    lines: ordered.filter((l) => !l.isFooter).map((l) => l.text),
    footer: ordered.filter((l) => l.isFooter).map((l) => l.text)
  };
}

/* -------------------------------------------- */

/**
 * Split a page into card rows using the footer bands as delimiters.
 *
 * Every card ends with a small-set block (crafting requirements, price), and
 * every card in a row ends at roughly the same height, so those blocks form
 * horizontal stripes across the page. A row region is therefore "body lines up
 * to and including the footer stripe that closes them".
 *
 * This is the one segmentation that survives the deck's real variability: card
 * WIDTH changes between rows (five narrow cards, then three wide ones) and card
 * HEIGHT changes between rows, but a row is internally uniform in both.
 *
 * @param {Array<{x:number,y:number,font:number}>} items  One page's items.
 * @returns {Array<Array<object>>} Items grouped by card row.
 */
function rowRegions(items) {
  if (!items.length) return [];

  // Cluster into lines across the full page width, so a footer stripe is seen
  // as one thing rather than as five separate cards' footers.
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const lines = [];
  let line = null;
  for (const item of sorted) {
    if (line && Math.abs(item.y - line.y) <= LINE_TOLERANCE) line.items.push(item);
    else {
      line = { y: item.y, items: [item] };
      lines.push(line);
    }
  }
  for (const l of lines) l.isFooter = Math.min(...l.items.map((i) => i.font)) <= FOOTER_MAX_FONT;

  const regions = [];
  let current = [];
  let inFooter = false;

  for (const l of lines) {
    if (l.isFooter) {
      current.push(...l.items);
      inFooter = true;
      continue;
    }
    // First body line after a footer stripe closes the previous row.
    if (inFooter) {
      if (current.length) regions.push(current);
      current = [];
      inFooter = false;
    }
    current.push(...l.items);
  }
  if (current.length) regions.push(current);

  return regions;
}
