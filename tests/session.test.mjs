import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { compile } from "./loadTs.mjs";
const { clearEditorImage } = await import(await compile("editorSession"));
const { largestCropRect } = await import(await compile("cropGeometry"));
const { setBatchIndex, createBatch } = await import(await compile("batchModel"));
const { filterBatchResults, createBatchResults } = await import(await compile("batchResults"));

test("one-based direct navigation clamps, truncates and preserves position for invalid input", () => {
  const state = createBatch(Array.from({length: 10}, (_, i) => ({path: `${i}`, name: `${i}`, width: 100, height: 100, error: null})));
  for (const [input, expected] of [[1,0],[10,9],[0,0],[110,9],[3.9,2],["",2],[" ",2],["bad",2],[NaN,2],[Infinity,2],["4x",2],[-3,0]]) {
    setBatchIndex(state, input); assert.equal(state.index, expected, String(input));
  }
  const empty = createBatch([]); setBatchIndex(empty, 10); assert.equal(empty.index, 0);
});
test("clearing editor image drops dependent state and retains settings", () => {
  const state = {image: {}, imageName: "a.png", imageSource: {}, crop: {}, drag: {}, imageRect: {}, aspect: 1.5, outputFormatChoice: "png"};
  clearEditorImage(state);
  assert.deepEqual(state, {image: null, imageName: "", imageSource: null, crop: null, drag: null, imageRect: null, aspect: 1.5, outputFormatChoice: "png"});
  assert.deepEqual(createBatch([]), {images: [], index: 0, reference: null});
});
test("results filters and session result reset", () => {
  const rows = ["success", "failed", "skipped"].map(status => ({path: status, status, error: null}));
  assert.deepEqual(filterBatchResults(rows, "all"), rows);
  assert.deepEqual(filterBatchResults(rows, "failed"), [rows[1]]);
  assert.deepEqual(filterBatchResults(rows, "skipped"), [rows[2]]);
  const store = createBatchResults(); store.replace(rows); store.clear(); assert.deepEqual(store.get(), []);
});

// Execute the actual main.ts functions with their editor dependencies supplied.
// This verifies the shared Single/Batch path, rather than a duplicate reset algorithm.
const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const functions = ["editorDimensions", "resetCropToLargest", "syncAspectChange"].map(name => {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}\n", start) + 2;
  return source.slice(start, end);
}).join("\n");
for (const reference of [null, {width: 1200, height: 800}]) {
  test(`aspect changes reset to largest ${reference ? "Batch reference" : "Single image"} crop`, () => {
    const state = {image: {naturalWidth: 640, naturalHeight: 480}, crop: {x: 50, y: 60, width: 100, height: 100}, aspect: 1, aspectPresets: [], drag: {}};
    let cleared = false;
    const context = vm.createContext({state, batch: {reference: () => reference}, largestCropRect, syncAspectUi: () => {state.aspect = 2;}, clearPreview: () => {cleared = true;}, renderCropState: () => {}});
    vm.runInContext(ts.transpileModule(functions, {compilerOptions: {target: ts.ScriptTarget.ES2020}}).outputText, context);
    vm.runInContext("syncAspectChange()", context);
    assert.deepEqual(state.crop, reference ? {x: 0, y: 100, width: 1200, height: 600} : {x: 0, y: 80, width: 640, height: 320});
    assert.equal(state.drag, null); assert.equal(cleared, true);
    state.crop = {x: 5, y: 5, width: 40, height: 20};
    vm.runInContext("syncAspectChange()", context);
    assert.equal(state.crop.width, 40, "unchanged ratio preserves crop");
  });
}
