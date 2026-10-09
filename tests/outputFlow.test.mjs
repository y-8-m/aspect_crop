import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { compile } from "./loadTs.mjs";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const functions = names => ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join("\n");
const run = (code, context) => vm.runInContext(ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2020}}).outputText, context);
const batchDeclaration = ast.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(ast) === "batch");
const switchMode = batchDeclaration.initializer.arguments[1].properties.find(node => node.name?.getText(ast) === "switchMode").getText(ast);
const store = await import(await compile("settingsStore"));
const format = await import(await compile("outputFormat"));
const folder = await import(await compile("saveFolder"));

function storage() {
  const values = new Map();
  globalThis.localStorage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
  store.persistSaveFolderMode("custom"); store.persistCustomSaveFolder("/single-only");
  store.recordSuccessfulSave({kind: "saved", location: "/last/image.png"});
}

test("actual mode switch keeps output format shared and hides only Single folder settings", () => {
  storage();
  const settings = store.loadSaveFolderSettings();
  const singleSection = {hidden: false};
  const state = {image: null, imageName: "", imageSource: null, crop: null, selectedAspectId: "square", isAspectSwapped: false, aspect: 1, outputFormatChoice: "png", webpCompression: "fast"};
  const context = vm.createContext({statusText: {classList: {remove() {}}}, translate: value => value, currentStatus: "Ready", state, must: selector => {assert.equal(selector, "#single-save-settings"); return singleSection;}, clearPreview() {}, refreshClearImage() {}, openButton: {}, saveButton: {}, previewButton: {}, syncAspectUi() {}, editorZoom: {setImage() {}}, dropHint: {classList: {toggle() {}}}, renderCropState() {}});
  run(`${functions(["captureEditor"])}\nlet singleSession = captureEditor(); let batchSession = captureEditor(); const editor = {${switchMode}};`, context);
  run("editor.switchMode(true)", context);
  assert.equal(singleSection.hidden, true);
  assert.equal(state.outputFormatChoice, "png");
  assert.equal(state.webpCompression, "fast");
  assert.deepEqual(store.loadSaveFolderSettings(), settings);
  state.outputFormatChoice = "webp";
  state.webpCompression = "smallest";
  run("editor.switchMode(false)", context);
  assert.equal(singleSection.hidden, false);
  assert.equal(state.outputFormatChoice, "webp");
  assert.equal(state.webpCompression, "smallest");
  assert.deepEqual(store.loadSaveFolderSettings(), settings);
  delete globalThis.localStorage;
});

test("Single save uses _crop default name, initial folder and completion without extra confirmation", async () => {
  storage();
  const calls = [], statuses = [];
  const crop = {x: 2, y: 3, width: 10, height: 20};
  const context = vm.createContext({
    state: {image: {}, crop, imageName: "IMG_1234.png", imageSource: {kind: "path", path: "/source/IMG_1234.png"}, outputFormatChoice: "png", webpCompression: "fast"},
    isTauriRuntime: true, ...format, ...folder, ...store,
    roundedOutputCrop: () => crop,
    runtime: {isSaveFolderAvailable: async path => path === "/single-only", saveCroppedImageFromPath: async (...args) => {calls.push(args); return {kind: "saved", location: "/chosen/renamed.png"};}},
    msg: (key, params) => ({key, params}), setStatus: status => statuses.push(status),
    window: {confirm() {assert.fail("Single must not add a confirmation dialog");}}
  });
  run(functions(["saveCroppedImage", "applySaveResult", "resolvedOutputFormat", "buildDefaultFileName", "imageExtension", "fileNameFromPath"]), context);
  await run("saveCroppedImage()", context);
  assert.deepEqual(calls, [["/source/IMG_1234.png", "IMG_1234_crop.png", crop, "png", "/single-only", "fast"]]);
  assert.equal(statuses[0].key, "saved");
  assert.equal(statuses[0].params.path, "/chosen/renamed.png");
  assert.equal(store.loadSaveFolderSettings().lastFolder, "/chosen");
  assert.equal(store.loadSaveFolderSettings().customFolder, "/single-only");
  delete globalThis.localStorage;
});

test("settings remain available without a Batch image but lock during execution", () => {
  const lock = batchDeclaration.initializer.arguments[1].properties.find(node => node.name?.getText(ast) === "lock").getText(ast);
  const elements = new Map();
  const addRatioButton = {disabled: false};
  const context = vm.createContext({addRatioButton, must: selector => {if (!elements.has(selector)) elements.set(selector, {}); return elements.get(selector);}});
  run(`const editor = {${lock}}; editor.lock(true, false);`, context);
  assert.equal(addRatioButton.disabled, false);
  assert.equal(elements.get("#preview-button").inert, true);
  run("editor.lock(true, true)", context);
  assert.equal(addRatioButton.disabled, true);
  run("editor.lock(false, false)", context);
  assert.equal(addRatioButton.disabled, false);
  assert.equal(elements.get("#preview-button").inert, false);
});


test("WebP compression defaults, persistence and invalid storage fallback", () => {
  storage();
  assert.equal(store.loadWebpCompression(), "balanced");
  store.persistWebpCompression("smallest");
  assert.equal(store.loadWebpCompression(), "smallest");
  localStorage.setItem("aspect-crop.webp-compression-preset", "invalid");
  assert.equal(store.loadWebpCompression(), "balanced");
  delete globalThis.localStorage;
});

test("Single resolves same + WebP before passing the preset for path and memory saves", async () => {
  storage();
  for (const kind of ["path", "memory"]) {
    for (const [choice, name, expected] of [["webp", "a.png", "webp"], ["same", "a.WEBP", "webp"], ["same", "a.png", "png"]]) {
      const calls = [];
      const crop = {x: 0, y: 0, width: 2, height: 2};
      const context = vm.createContext({
        state: {image: {}, crop, imageName: name, imageSource: kind === "path" ? {kind, path: `/source/${name}`} : {kind, bytes: new Uint8Array([1])}, outputFormatChoice: choice, webpCompression: "smallest"},
        isTauriRuntime: true, ...format, ...folder, ...store, roundedOutputCrop: () => crop,
        runtime: {isSaveFolderAvailable: async () => true, saveCroppedImageFromPath: async (...args) => {calls.push(args); return {kind: "cancelled"};}, saveCroppedImageFromBytes: async (...args) => {calls.push(args); return {kind: "cancelled"};}},
        msg: key => key, setStatus() {}
      });
      run(functions(["saveCroppedImage", "applySaveResult", "resolvedOutputFormat", "buildDefaultFileName", "imageExtension", "fileNameFromPath"]), context);
      await run("saveCroppedImage()", context);
      assert.equal(calls[0][3], expected);
      assert.equal(calls[0][5], "smallest");
    }
  }
  delete globalThis.localStorage;
});
