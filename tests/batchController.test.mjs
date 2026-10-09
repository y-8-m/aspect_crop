import assert from "node:assert/strict";
import test from "node:test";
import { compile, dataUrl } from "./loadTs.mjs";

class Element {
  children = new Map(); value = ""; textContent = ""; hidden = false; disabled = false;
  options = [{}, {}, {}]; selectedOptions = [{text: "Rename"}];
  buttons = [];
  set innerHTML(value) {
    for (const match of value.matchAll(/data-id="([^"]+)"/g)) this.children.set(match[1], new Element());
    if (value.includes('aria-pressed')) this.buttons = [new Element(), new Element()];
  }
  querySelector(selector) { return this.children.get(selector.match(/data-id="([^"]+)"/)?.[1]); }
  querySelectorAll(selector) { return selector === "button" ? this.buttons : [...this.children.values()]; }
  append(value) { this.appended = value; }
  prepend(value) { this.prepended = value; }
  setAttribute() {}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test("controller preserves navigation, session results and mode-specific save conditions", async () => {
  const workspace = new Element(), toolbar = new Element();
  const singlePreferences = new Map([["aspect-crop.save-folder-mode", "custom"], ["aspect-crop.custom-save-folder", "/single-only"]]);
  globalThis.localStorage = {getItem: key => singlePreferences.get(key) ?? null, setItem() {assert.fail("Batch conditions must not overwrite persistent Single settings");}};
  globalThis.document = {createElement: () => new Element(), querySelector: s => s === ".workspace" ? workspace : toolbar, activeElement: null};
  const confirmations = [];
  globalThis.window = {confirm: text => { confirmations.push(text); return true; }};
  const requests = [];
  globalThis.batchTestRun = (request, progress) => { requests.push(request); progress({completed: 1, total: 1, name: "a.png"}); return [{path: "/a.png", status: "success", error: null}]; };
  const opened = [];
  let modalClears = 0;
  globalThis.batchTestModal = {open: (rows, images) => opened.push({rows, images}), clear: () => modalClears++, key: () => false};
  const {createBatchController} = await import(await compile("batchController", {
    "./batchResultsModal": dataUrl('export const createBatchResultsModal = () => globalThis.batchTestModal;'),
    "./batchRuntime": dataUrl(`export const scanBatch = async () => [
      {path: "/a.png", name: "a.png", width: 100, height: 100, error: null},
      {path: "/b.png", name: "b.png", width: 100, height: 100, error: null},
      {path: "/bad.png", name: "bad.png", width: 0, height: 0, error: "broken"}];
      export const runBatch = async (request, progress) => globalThis.batchTestRun(request, progress);`)
  }));
  const previews = []; let clears = 0;
  let outputFormat = "png";
  const controller = createBatchController({kind: "tauri", openImageDialog: async () => ["/a.png"], openFolderDialog: async () => "/new"}, {
    switchMode() {}, show: async path => {previews.push(path);}, clear() {clears++;}, crop: () => ({x: 0,y: 0,width: 100,height: 100}), aspect: () => "1:1", format: () => outputFormat, lock() {}
  });
  const panel = workspace.appended;
  const el = id => panel.children.get(id);
  toolbar.prepended.buttons[1].onclick();
  await controller.load(["/a.png"]);
  assert.equal(el("run").textContent, "Save 2 images");
  assert.equal(el("format").textContent, "Output Format: PNG");
  el("output").value = "/batch-only";
  for (const collision of ["rename", "skip", "overwrite"]) {
    el("collision").value = collision;
    toolbar.prepended.buttons[0].onclick();
    outputFormat = "webp";
    controller.syncOutputFormat();
    toolbar.prepended.buttons[1].onclick();
    assert.equal(el("output").value, "/batch-only");
    assert.equal(el("collision").value, collision);
    assert.equal(el("format").textContent, "Output Format: WebP");
    el("include").onchange(); // Exclude current image; broken images are already excluded.
    el("run").onclick(); await tick();
    assert.deepEqual(requests.at(-1), {paths: ["/b.png"], output: "/batch-only", crop: {x:0,y:0,width:100,height:100}, width:100, height:100, format:"webp", collision});
    assert.match(confirmations.at(-1), /Save 1 images/);
    assert.match(confirmations.at(-1), /x: 0, y: 0/);
    assert.match(confirmations.at(-1), /100 × 100 px/);
    assert.match(confirmations.at(-1), /Aspect ratio: 1:1/);
    assert.match(confirmations.at(-1), /Output Folder: \/batch-only/);
    assert.match(confirmations.at(-1), /Output Format: WebP/);
    assert.match(confirmations.at(-1), /Existing Files:/);
    assert.equal(el("progress").value, 1);
    assert.match(el("report").textContent, /Completed/);
    el("include").onchange();
  }
  const count = previews.length;
  el("position").value = "2";
  assert.equal(previews.length, count);
  el("position").onkeydown({key: "Enter", preventDefault() {}}); await tick();
  assert.equal(previews.at(-1), "/b.png");
  assert.equal(el("position").value, "2");
  el("position").value = ""; el("position").onblur(); await tick();
  assert.equal(el("position").value, "2");
  el("position").value = "1"; el("position").onblur(); await tick();
  assert.equal(previews.at(-1), "/a.png");
  for (const reload of [() => el("files").onclick(), () => el("folder").onclick(), () => el("clear").onclick()]) {
    el("run").onclick(); await tick();
    el("results").onclick(); assert.equal(opened.at(-1).rows.length, 1);
    reload(); await tick();
    el("results").onclick(); assert.equal(opened.at(-1).rows.length, 0);
  }
  assert.equal(controller.reference(), null);
  assert.equal(el("position").value, "0");
  assert.equal(el("position").disabled, true);
  assert.equal(el("input").textContent, "");
  assert.equal(el("report").textContent, "");
  assert.equal(el("progress").hidden, true);
  assert.equal(el("results").hidden, true);
  assert.equal(el("output").value, "/new/cropped");
  assert.ok(clears >= 4); assert.ok(modalClears >= 4);
  assert.equal(singlePreferences.get("aspect-crop.custom-save-folder"), "/single-only");
  delete globalThis.localStorage;
  delete globalThis.batchTestRun;
  delete globalThis.batchTestModal; delete globalThis.document; delete globalThis.window;
});
