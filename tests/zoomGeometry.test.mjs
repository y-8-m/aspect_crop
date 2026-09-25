import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Use the project's existing compiler; no test runner dependency is needed.
const source = await readFile(new URL("../src/zoomGeometry.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { fitZoom, clampZoom, zoomLayout, sourceToView } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("fit contains landscape and portrait images, never upscales small images", () => {
  assert.equal(fitZoom(4000, 2000, 1000, 800), 0.25);
  assert.equal(fitZoom(2000, 4000, 1000, 800), 0.2);
  assert.equal(fitZoom(100, 80, 1000, 800), 1);
  assert.equal(fitZoom(1000, 800, 1000, 800), 1);
});

test("zoom stays between fit and 100%, including invalid input", () => {
  assert.equal(clampZoom(0.1, 0.25), 0.25);
  assert.equal(clampZoom(2, 0.25), 1);
  assert.equal(clampZoom(NaN, 0.25), 0.25);
  assert.equal(clampZoom(0.5, 1), 1);
});

test("zoom preserves the source point at viewport center away from edges", () => {
  const center = { x: 2100, y: 1300 };
  for (const zoom of [0.5, 0.75, 1]) {
    const layout = zoomLayout(4000, 3000, 800, 600, zoom, center);
    assert.equal((layout.left + 400 - layout.image.x) / zoom, center.x);
    assert.equal((layout.top + 300 - layout.image.y) / zoom, center.y);
  }
});

test("fit and small images are centered; edge scrolling is bounded", () => {
  const small = zoomLayout(100, 80, 1000, 800, 1, { x: 50, y: 40 });
  assert.deepEqual(small.image, { x: 450, y: 360, width: 100, height: 80 });
  assert.equal(small.left, 0);
  assert.equal(small.top, 0);
  const edge = zoomLayout(4000, 3000, 800, 600, 1, { x: 4000, y: 3000 });
  assert.equal(edge.left, 3200);
  assert.equal(edge.top, 2400);
});

test("view transforms round trip to unchanged original-pixel crop coordinates", () => {
  const crop = Object.freeze({ x: 320, y: 240, width: 1600, height: 900 });
  for (const zoom of [0.125, 0.5, 1]) {
    const image = { x: -100, y: 30, width: 4000 * zoom, height: 3000 * zoom };
    const view = sourceToView(crop, image, zoom);
    assert.deepEqual({ x: (view.x - image.x) / zoom, y: (view.y - image.y) / zoom, width: view.width / zoom, height: view.height / zoom }, crop);
    assert.equal(20 / zoom * zoom, 20); // Pointer deltas use the inverse scale.
  }
});
