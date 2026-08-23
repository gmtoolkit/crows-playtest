import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { canTake, canBrowse, purseAfter, MODES } from "../src/system/acquisition.mjs";

describe("who may take equipment off the shelf", () => {
  test("a player may ALWAYS browse, in either mode", () => {
    // The rule the whole design rests on. A player who cannot see the
    // catalogue cannot plan, save up, or ask for anything by name.
    assert.equal(canBrowse(), true);
  });

  describe("purchase mode", () => {
    const mode = MODES.purchase;

    test("a player with enough coin buys it, and the cost is the price", () => {
      const v = canTake({ isGM: false, mode, coin: 100, price: 40 });
      assert.equal(v.ok, true);
      assert.equal(v.cost, 40);
    });

    test("exactly enough coin is enough", () => {
      assert.equal(canTake({ isGM: false, mode, coin: 40, price: 40 }).ok, true);
    });

    test("one short is refused, and says HOW short", () => {
      // "You cannot" is not actionable; "you are 1 short" is.
      const v = canTake({ isGM: false, mode, coin: 39, price: 40 });
      assert.equal(v.ok, false);
      assert.equal(v.reason, "tooExpensive");
      assert.equal(v.short, 1);
    });

    test("a free item needs no coin", () => {
      assert.equal(canTake({ isGM: false, mode, coin: 0, price: 0 }).ok, true);
    });

    test("no free slot refuses even when the coin is there", () => {
      const v = canTake({ isGM: false, mode, coin: 999, price: 10, hasRoom: false });
      assert.equal(v.ok, false);
      assert.equal(v.reason, "noRoom");
    });

    test("someone else's crow is refused before anything else is considered", () => {
      const v = canTake({ isGM: false, mode, coin: 999, price: 1, isOwner: false });
      assert.equal(v.ok, false);
      assert.equal(v.reason, "notYours");
    });
  });

  describe("Ref-only mode", () => {
    const mode = MODES.gm;

    test("a player is refused however rich they are", () => {
      const v = canTake({ isGM: false, mode, coin: 100000, price: 1 });
      assert.equal(v.ok, false);
      assert.equal(v.reason, "gmOnly");
    });

    test("and the refusal costs them nothing", () => {
      assert.equal(canTake({ isGM: false, mode, coin: 100, price: 40 }).cost, 0);
    });
  });

  describe("the Ref", () => {
    test("is never gated by coin or mode", () => {
      for (const mode of [MODES.purchase, MODES.gm]) {
        const v = canTake({ isGM: true, mode, coin: 0, price: 99999 });
        assert.equal(v.ok, true, `GM blocked in ${mode} mode`);
        assert.equal(v.cost, 0, "granting never charges");
      }
    });

    test("is still stopped by a full inventory, because slots are the rules", () => {
      // The Ref can hand out anything, but a crow with no room cannot hold it.
      const v = canTake({ isGM: true, mode: MODES.gm, hasRoom: false });
      assert.equal(v.ok, false);
      assert.equal(v.reason, "noRoom");
    });
  });
});

describe("the purse after a purchase", () => {
  test("subtracts the cost", () => {
    assert.equal(purseAfter(100, 40), 60);
  });

  test("never goes negative, whatever a caller does", () => {
    // A caller must gate on canTake first; this is the belt to that braces.
    assert.equal(purseAfter(10, 40), 0);
  });

  test("survives nonsense input", () => {
    assert.equal(purseAfter(undefined, 5), 0);
    assert.equal(purseAfter(50, undefined), 50);
  });
});
