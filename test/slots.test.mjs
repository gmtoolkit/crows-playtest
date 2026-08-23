import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  occupancy,
  canPlace,
  firstFit,
  magicSlotOverload,
  canDrawFromPack,
  slotsUsed,
  CONTAINER_SIZES
} from "../src/system/slots.mjs";

const place = (id, container, index, span = 1, magicSlot = null) => ({ id, container, index, span, magicSlot });

describe("container sizes match the printed sheet (R p10)", () => {
  test("2 hand, 4 belt, 10 backpack, 6 magic", () => {
    assert.deepEqual(CONTAINER_SIZES, { hand: 2, belt: 4, backpack: 10, magic: 6 });
  });
});

describe("occupancy", () => {
  test("a multi-slot item covers every slot it spans", () => {
    const map = occupancy([place("pole", "backpack", 2, 3)], "backpack");
    assert.deepEqual([...map.keys()].sort((a, b) => a - b), [2, 3, 4]);
  });

  test("items in other containers are ignored", () => {
    const map = occupancy([place("sword", "hand", 0)], "backpack");
    assert.equal(map.size, 0);
  });

  test("unplaced items are ignored", () => {
    const map = occupancy([place("loose", "backpack", null)], "backpack");
    assert.equal(map.size, 0);
  });
});

describe("placement rules", () => {
  test("an empty slot accepts an item", () => {
    assert.equal(canPlace({ placements: [], itemId: "x", container: "backpack", index: 0 }).ok, true);
  });

  test("an occupied slot rejects it", () => {
    const r = canPlace({
      placements: [place("rope", "backpack", 3)],
      itemId: "x",
      container: "backpack",
      index: 3
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "occupied");
    assert.deepEqual(r.blockedBy, ["rope"]);
  });

  test("a multi-slot item is blocked if ANY covered slot is taken", () => {
    // Slots 2,3,4 needed; only slot 4 is taken.
    const r = canPlace({
      placements: [place("rope", "backpack", 4)],
      itemId: "pole",
      container: "backpack",
      index: 2,
      span: 3
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.blockedBy, ["rope"]);
  });

  test("an item cannot run off the end of a container", () => {
    // Backpack slots 9 and 10 (indices 8,9); a 3-span item starting at 8 overflows.
    const r = canPlace({ placements: [], itemId: "pole", container: "backpack", index: 8, span: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "doesNotFit");
  });

  test("a 2-slot item fits exactly at the end", () => {
    assert.equal(canPlace({ placements: [], itemId: "x", container: "backpack", index: 8, span: 2 }).ok, true);
  });

  test("an item cannot span two different containers", () => {
    // There is no way to express hand+belt: a placement names ONE container,
    // and overflow past that container's size is refused.
    const r = canPlace({ placements: [], itemId: "pole", container: "hand", index: 1, span: 2 });
    assert.equal(r.ok, false, "a 2-slot item cannot start in the last hand slot");
    assert.equal(r.reason, "doesNotFit");
  });

  test("non-adjacent placement is impossible by construction", () => {
    // "you can't place your 10-foot pole in backpack slots 2 and 7" — a
    // placement is an index plus a span, so a gap cannot be represented.
    const map = occupancy([place("pole", "backpack", 1, 2)], "backpack");
    assert.deepEqual([...map.keys()].sort((a, b) => a - b), [1, 2], "spans are always consecutive");
  });

  test("hands refuse stacks", () => {
    const r = canPlace({ placements: [], itemId: "potions", container: "hand", index: 0, quantity: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "noStackingInHands");
  });

  test("hands accept a single item", () => {
    assert.equal(canPlace({ placements: [], itemId: "sword", container: "hand", index: 0, quantity: 1 }).ok, true);
  });

  test("belt and backpack accept stacks", () => {
    assert.equal(canPlace({ placements: [], itemId: "p", container: "belt", index: 0, quantity: 5 }).ok, true);
    assert.equal(canPlace({ placements: [], itemId: "p", container: "backpack", index: 0, quantity: 5 }).ok, true);
  });

  test("an item does not collide with itself when moving", () => {
    const placements = [place("pole", "backpack", 2, 3)];
    // Moving the pole one slot left overlaps its own current footprint.
    assert.equal(canPlace({ placements, itemId: "pole", container: "backpack", index: 1, span: 3 }).ok, true);
  });
});

describe("first fit", () => {
  test("finds the lowest free slot", () => {
    const placements = [place("a", "backpack", 0), place("b", "backpack", 1)];
    assert.equal(firstFit({ placements, itemId: "x", container: "backpack" }), 2);
  });

  test("needs a consecutive run for a bulky item", () => {
    // Free singles at 1 and 3, but no run of two until index 4.
    const placements = [place("a", "backpack", 0), place("b", "backpack", 2)];
    assert.equal(firstFit({ placements, itemId: "x", span: 2, container: "backpack" }), 3);
  });

  test("returns null when nothing fits", () => {
    const placements = Array.from({ length: 10 }, (_, i) => place(`i${i}`, "backpack", i));
    assert.equal(firstFit({ placements, itemId: "x", container: "backpack" }), null);
  });

  test("a full-but-fragmented pack rejects a 3-slot item", () => {
    // Alternating gaps: no run of 3 anywhere.
    const placements = [0, 2, 4, 6, 8].map((i) => place(`i${i}`, "backpack", i));
    assert.equal(firstFit({ placements, itemId: "x", span: 3, container: "backpack" }), null);
    assert.equal(firstFit({ placements, itemId: "x", span: 1, container: "backpack" }), 1);
  });
});

describe("magic item slots (R p11)", () => {
  test("one item per slot is fine", () => {
    const placements = [place("ring", "magic", null, 1, "finger"), place("hat", "magic", null, 1, "head")];
    assert.deepEqual(magicSlotOverload(placements), []);
  });

  test("two items in one slot is an overload", () => {
    const placements = [place("ring1", "magic", null, 1, "finger"), place("ring2", "magic", null, 1, "finger")];
    assert.deepEqual(magicSlotOverload(placements), ["finger"]);
  });

  test("only the doubled slot is reported", () => {
    const placements = [
      place("ring1", "magic", null, 1, "finger"),
      place("ring2", "magic", null, 1, "finger"),
      place("hat", "magic", null, 1, "head")
    ];
    assert.deepEqual(magicSlotOverload(placements), ["finger"]);
  });
});

describe("Draw From Pack (R p11)", () => {
  test("a roll at or above the slot number succeeds", () => {
    // Index 2 is slot 3 on the sheet.
    assert.equal(canDrawFromPack(3, 2), true);
    assert.equal(canDrawFromPack(2, 2), false);
  });

  test("slot 1 comes out on almost anything", () => {
    assert.equal(canDrawFromPack(1, 0), true);
  });

  test("slot 10 needs a 10", () => {
    assert.equal(canDrawFromPack(9, 9), false);
    assert.equal(canDrawFromPack(10, 9), true);
  });

  test("a bulky item only needs to beat its LOWEST slot", () => {
    // A 3-slot item in slots 5,6,7: a roll of 5 reaches it.
    assert.equal(canDrawFromPack(5, 4, 3), true);
    assert.equal(canDrawFromPack(4, 4, 3), false);
  });
});

describe("slot accounting", () => {
  test("counts spans, not item count", () => {
    const placements = [place("pole", "backpack", 0, 3), place("rope", "backpack", 3, 1)];
    assert.equal(slotsUsed(placements, "backpack"), 4);
  });

  test("ignores other containers", () => {
    const placements = [place("sword", "hand", 0), place("rope", "backpack", 0)];
    assert.equal(slotsUsed(placements, "hand"), 1);
  });
});
