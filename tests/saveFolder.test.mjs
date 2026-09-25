import assert from "node:assert/strict";
import test from "node:test";
import { compile, dataUrl } from "./loadTs.mjs";

const folderUrl = await compile("saveFolder");
const formatUrl = await compile("outputFormat");
const storeUrl = await compile("settingsStore", { "./saveFolder": folderUrl, "./outputFormat": formatUrl });
const { resolveSaveFolder, parentFolder, saveDefaultPath } = await import(folderUrl);
const store = await import(storeUrl);
const settings = { mode: "source", customFolder: "/custom", lastFolder: "/last" };

test("source is default; modes and paths persist independently", () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(store.loadSaveFolderSettings(), { mode: "source", customFolder: null, lastFolder: null });
  store.persistSaveFolderMode("custom");
  store.persistCustomSaveFolder("/fixed folder/日本語");
  store.recordSuccessfulSave({ kind: "saved", location: "/actual/image.png" });
  assert.deepEqual(store.loadSaveFolderSettings(), { mode: "custom", customFolder: "/fixed folder/日本語", lastFolder: "/actual" });
  store.recordSuccessfulSave({ kind: "cancelled" });
  store.recordSuccessfulSave({ kind: "downloaded", location: "file.png" });
  assert.equal(store.loadSaveFolderSettings().lastFolder, "/actual");
});

test("all modes follow their fallback order, including invalid history", async () => {
  for (const [mode, expected] of [["source", ["/source"]], ["last", ["/last", "/custom", "/source"]], ["custom", ["/custom", "/source"]]]) {
    for (let index = 0; index < expected.length; index++) {
      const checked = [];
      const result = await resolveSaveFolder({ ...settings, mode }, "/source/image.png", async (path) => {
        checked.push(path);
        return path === expected[index];
      });
      assert.equal(result, expected[index]);
      assert.deepEqual(checked, expected.slice(0, index + 1));
    }
  }
  assert.equal(await resolveSaveFolder({ ...settings, mode: "last", lastFolder: null }, "/source/image.png", async () => true), "/custom");
  assert.equal(await resolveSaveFolder({ ...settings, mode: "custom", customFolder: null }, "/source/image.png", async () => true), "/source");
});

test("unavailable paths or unknown source paths let the OS choose a default", async () => {
  assert.equal(await resolveSaveFolder({ ...settings, mode: "last" }, "/source/image.png", async () => { throw Error("Disconnected"); }), undefined);
  assert.equal(await resolveSaveFolder(settings, null, async () => true), undefined);
});

test("paths retain filenames, root folders, spaces and Unicode", () => {
  assert.equal(parentFolder("/image.png"), "/");
  assert.equal(parentFolder("C:\\image.png"), "C:\\");
  assert.equal(parentFolder("image.png"), null);
  assert.equal(saveDefaultPath("crop.png", "/"), "/crop.png");
  assert.equal(saveDefaultPath("crop.png", "C:\\"), "C:\\crop.png");
  assert.equal(saveDefaultPath("crop.png", "/some folder/画像/"), "/some folder/画像/crop.png");
  assert.equal(saveDefaultPath("crop.png"), "crop.png");
});

test("native save routes retain dialog filters and record only successfully written destinations", async () => {
  const dialogUrl = dataUrl("export const save = options => globalThis.saveHarness.save(options); export const open = options => globalThis.saveHarness.open(options);");
  const invokeUrl = dataUrl("export const invoke = (command, args) => globalThis.saveHarness.invoke(command, args);");
  const runtimeUrl = await compile("runtimeBridge", { "./saveFolder": folderUrl, "./outputFormat": formatUrl, "@tauri-apps/api/dialog": dialogUrl, "@tauri-apps/api/tauri": invokeUrl });
  globalThis.window = { __TAURI_IPC__: () => {} };
  const runtime = (await import(runtimeUrl)).createRuntimeBridge();
  let selected = "/actual/renamed.png";
  let fail = false;
  const writes = [];
  globalThis.saveHarness = {
    save: async (options) => {
      assert.equal(options.defaultPath, "/initial/crop.png");
      assert.deepEqual(options.filters, [{ name: "PNG", extensions: ["png"] }]);
      return selected;
    },
    open: async (options) => { assert.equal(options.directory, true); return "/chosen"; },
    invoke: async (command, args) => { if (fail) throw Error("Write failed"); writes.push({ command, args }); }
  };
  assert.equal(await runtime.openFolderDialog(), "/chosen");
  const crop = { x: 10, y: 20, width: 30, height: 40 };
  const routes = [
    () => runtime.saveImage("crop.png", new Uint8Array([1]), "png", "/initial"),
    () => runtime.saveCroppedImageFromPath("/source/image.png", "crop.png", crop, "png", "/initial"),
    () => runtime.saveCroppedImageFromBytes(new Uint8Array([1]), "crop.png", crop, "png", "/initial")
  ];
  for (const route of routes) {
    store.recordSuccessfulSave({ kind: "saved", location: "/old/image.png" });
    selected = null;
    const count = writes.length;
    store.recordSuccessfulSave(await route());
    assert.equal(writes.length, count);
    assert.equal(store.loadSaveFolderSettings().lastFolder, "/old");
    selected = "/actual/renamed.png";
    fail = true;
    await assert.rejects(async () => store.recordSuccessfulSave(await route()), /Write failed/);
    assert.equal(store.loadSaveFolderSettings().lastFolder, "/old");
    fail = false;
    store.recordSuccessfulSave(await route());
    assert.equal(store.loadSaveFolderSettings().lastFolder, "/actual");
    assert.equal(writes.at(-1).args.outputPath ?? writes.at(-1).args.path, selected);
  }
});
