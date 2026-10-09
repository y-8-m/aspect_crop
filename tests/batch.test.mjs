import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "./loadTs.mjs";
const { createBatch, toggleImage, batchCounts, navigateBatch, batchTargets, snapshotCrop } = await import(await compile("batchModel"));
const image = (name, width = 1920, height = 1080, error = null) => ({ path: `/images/${name}`, name, width, height, error });
test("first healthy image is reference; equal sizes included, mismatches and broken images excluded", () => {
  const state = createBatch([image("broken.png", 0, 0, "decode error"), image("a.png"), image("b.png"), image("small.png", 1280, 720)]);
  assert.deepEqual(state.reference, { width: 1920, height: 1080 });
  assert.deepEqual(state.images.map(i => i.status), ["invalid", "included", "included", "size-mismatch"]);
  assert.equal(createBatch([]).reference, null);
});
test("toggle is reversible only for valid matching images; counts and targets reflect state", () => {
  const state = createBatch([image("a.png"), image("b.png"), image("small.png", 1280, 720), image("broken.png", 0, 0, "error")]);
  toggleImage(state.images[1]); toggleImage(state.images[2]); toggleImage(state.images[3]);
  assert.deepEqual(batchCounts(state.images), { included: 1, excluded: 1, "size-mismatch": 1, invalid: 1 });
  assert.deepEqual(batchTargets(state), ["/images/a.png"]);
  toggleImage(state.images[1]);
  assert.equal(state.images[1].status, "included");
});
test("navigation and exclusions cannot mutate the one shared source-pixel rectangle", () => {
  const state = createBatch([image("a.png"), image("b.png"), image("small.png", 1280, 720)]);
  const crop = Object.freeze({ x: 100, y: 40, width: 1600, height: 900 });
  const requestCrop = snapshotCrop(crop);
  for (const offset of [1, 1, -1, -1, -1, 100]) {
    navigateBatch(state, offset); toggleImage(state.images[state.index]);
    assert.deepEqual(snapshotCrop(crop), requestCrop);
  }
  assert.equal(state.index, 2);
  assert.deepEqual(requestCrop, { x: 100, y: 40, width: 1600, height: 900 });
});
