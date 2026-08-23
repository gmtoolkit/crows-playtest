import { CROWS } from "../config.mjs";

/** Template partials preloaded once at init. */
const PARTIALS = [
  "systems/crows/templates/partials/slot.hbs",
  "systems/crows/templates/partials/card-face.hbs",
  "systems/crows/templates/partials/characteristic.hbs",
  "systems/crows/templates/partials/expertise-row.hbs",
  "systems/crows/templates/partials/attack-row.hbs"
];

export function registerHandlebars() {
  foundry.applications.handlebars.loadTemplates(PARTIALS);

  /** Signed rendering: characteristics read as "+2" / "-1", never a bare "2". */
  Handlebars.registerHelper("crowsSigned", (value) => {
    const n = Number(value) || 0;
    return n >= 0 ? `+${n}` : `${n}`;
  });

  /** Localised label for a config key, e.g. {{crowsLabel "expertises" key}}. */
  Handlebars.registerHelper("crowsLabel", (group, key) => {
    const entry = CROWS[group]?.[key];
    const label = typeof entry === "string" ? entry : entry?.label;
    return label ? game.i18n.localize(label) : key;
  });

  /** Repeat a block N times with @index available — used for slot grids. */
  Handlebars.registerHelper("crowsTimes", function (n, options) {
    let out = "";
    for (let i = 0; i < n; i++) out += options.fn(this, { data: { index: i, number: i + 1 } });
    return out;
  });

  /** Render a usage-dice pool as filled and spent pips. */
  Handlebars.registerHelper("crowsUsagePips", (value, max) => {
    const v = Number(value) || 0;
    const m = Number(max) || 0;
    if (!m) return "";
    const filled = '<span class="ud-pip filled"></span>'.repeat(Math.min(v, m));
    const spent = '<span class="ud-pip"></span>'.repeat(Math.max(0, m - v));
    return new Handlebars.SafeString(filled + spent);
  });

  Handlebars.registerHelper("crowsEq", (a, b) => a === b);
  Handlebars.registerHelper("crowsOr", (...args) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper("crowsAnd", (...args) => args.slice(0, -1).every(Boolean));
  Handlebars.registerHelper("crowsGt", (a, b) => Number(a) > Number(b));
}
