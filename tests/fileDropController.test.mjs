import assert from "node:assert/strict";
import test from "node:test";
import {compile} from "./loadTs.mjs";

test("native drop routes raw Batch paths and retains Single filtering and drag feedback", async () => {
  const {createFileDropController} = await import(await compile("fileDropController"));
  for (const active of [false, true]) {
    let native;
    const classes = new Set(), single = [], batch = [], statuses = [];
    globalThis.window = {addEventListener() {}};
    const controller = createFileDropController({
      runtimeKind: "tauri",
      dropZone: {addEventListener() {}, classList: {add: c => classes.add(c), remove: c => classes.delete(c)}},
      bindNativeDrop: async listener => {native = listener;},
      batchActive: () => active,
      loadBatchDrop: async paths => batch.push(paths),
      loadPathBatch: async paths => single.push(paths),
      loadFile: async () => assert.fail("Native drops must use paths"),
      supportedUniquePaths: paths => paths.filter(p => p.endsWith(".png")),
      onStatus: (...args) => statuses.push(args), formatError: e => e
    });
    await controller.bind();
    native({type: "hover", paths: []});
    assert.equal(classes.has("drag-active"), true);
    native({type: "cancel", paths: []});
    assert.equal(classes.has("drag-active"), false);
    const paths = ["/a.png", "/b.png", "/folder"];
    native({type: "drop", paths});
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(single, active ? [] : [["/a.png", "/b.png"]]);
    assert.deepEqual(batch, active ? [paths] : []);
    assert.deepEqual(statuses, []);
    native({type: "drop", paths});
    assert.equal(single.length + batch.length, 1, "duplicate native drop suppressed");
  }
  delete globalThis.window;
});
