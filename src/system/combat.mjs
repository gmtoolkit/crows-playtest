import { CROWS } from "../config.mjs";

/**
 * Side-based initiative (R p18).
 *
 * Crows has no per-creature initiative. At the start of EVERY round one player
 * rolls 1d10; on a 6 or higher the crows and their allies take their turns
 * first, otherwise their enemies do. Order within a side is chosen by the
 * players (or the Ref) at the table.
 *
 * Rather than overriding `_sortCombatants` — which Foundry passes bare to
 * `Array.sort`, so `this` is undefined inside it — this sets a numeric
 * initiative per side and lets the default descending sort do the work. That
 * also leaves the GM free to nudge a single combatant's initiative to fix the
 * order inside a side.
 */
export class CrowsCombat extends Combat {
  static PLAYER_SIDE = 20;
  static ENEMY_SIDE = 10;

  /** Whether the crows act first this round. */
  get playersFirst() {
    return this.getFlag(CROWS.id, "playersFirst") ?? true;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async startCombat() {
    await this.rollSides({ announce: true });
    return super.startCombat();
  }

  /** @inheritDoc */
  async nextRound() {
    const result = await super.nextRound();
    // Rolled AFTER advancing so the announcement names the round it applies to.
    await this.rollSides({ announce: true });
    return result;
  }

  /* -------------------------------------------- */

  /**
   * Roll for which side acts first and write the result onto every combatant's
   * initiative.
   */
  async rollSides({ announce = false } = {}) {
    const roll = await new Roll(CROWS.combat.initiativeFormula).evaluate();
    const playersFirst = roll.total >= CROWS.combat.playersFirstOn;

    await this.setFlag(CROWS.id, "playersFirst", playersFirst);

    const updates = this.combatants.map((c) => {
      const friendly = this.#isCrowSide(c);
      const first = friendly === playersFirst;
      return { _id: c.id, initiative: first ? CrowsCombat.PLAYER_SIDE : CrowsCombat.ENEMY_SIDE };
    });
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);

    if (announce) {
      await roll.toMessage({
        flavor: game.i18n.localize(playersFirst ? "CROWS.CrowsActFirst" : "CROWS.EnemiesActFirst"),
        speaker: { alias: game.i18n.localize("CROWS.Initiative") }
      });
    }

    return { roll, playersFirst };
  }

  /* -------------------------------------------- */

  /**
   * Is this combatant on the crows' side?
   *
   * A crow-type actor always is. Anything else follows its token disposition,
   * so a friendly NPC hireling acts with the party and a hostile one does not.
   */
  #isCrowSide(combatant) {
    if (combatant.actor?.type === "crow") return true;
    const disposition = combatant.token?.disposition;
    return disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  }

  /* -------------------------------------------- */

  /**
   * New combatants joining mid-fight inherit the current round's side order
   * rather than sitting at the bottom with no initiative.
   */
  async _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    await super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    if (collection !== "combatants" || game.user.id !== userId || !this.started) return;

    const updates = documents
      .filter((c) => c.initiative === null)
      .map((c) => {
        const first = this.#isCrowSide(c) === this.playersFirst;
        return { _id: c.id, initiative: first ? CrowsCombat.PLAYER_SIDE : CrowsCombat.ENEMY_SIDE };
      });
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
  }
}

export default CrowsCombat;
