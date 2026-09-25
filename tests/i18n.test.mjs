import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compile, dataUrl } from "./loadTs.mjs";

const { messages } = await import(await compile("messages"));
const { detectLanguage, setLanguage, t, msg, translate, applyTranslations, onLanguageChange, LocalizedError, errorMessage } = await import(await compile("i18n"));
const store = await import(await compile("settingsStore"));

test("saved preference takes priority; only a primary Japanese locale defaults to Japanese", () => {
  assert.equal(detectLanguage(null, ["ja-JP", "en-US"]), "ja");
  assert.equal(detectLanguage(null, ["JA_jp"]), "ja");
  assert.equal(detectLanguage(null, ["en-US", "ja-JP"]), "en");
  assert.equal(detectLanguage(null, ["fr-FR"]), "en");
  assert.equal(detectLanguage(null, []), "en");
  assert.equal(detectLanguage("en", ["ja-JP"]), "en");
  assert.equal(detectLanguage("ja", ["en-US"]), "ja");
  assert.equal(detectLanguage("invalid", ["ja-JP"]), "ja");
});

test("language preference persists without modifying save folder settings", () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(store.loadLanguage(), null);
  store.persistSaveFolderMode("custom");
  store.persistCustomSaveFolder("/Pictures");
  store.persistLanguage("ja");
  assert.equal(store.loadLanguage(), "ja");
  assert.equal(store.loadSaveFolderSettings().customFolder, "/Pictures");
  store.persistLanguage("en");
  assert.equal(store.loadLanguage(), "en");
});

test("both dictionaries have matching keys and interpolation parameters", () => {
  assert.deepEqual(Object.keys(messages.ja).sort(), Object.keys(messages.en).sort());
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(messages.en)) {
    assert.ok(messages.ja[key].length > 0, key);
    assert.deepEqual(placeholders(messages.ja[key]), placeholders(messages.en[key]), key);
  }
});

test("messages and errors retranslate without changing their values", () => {
  const message = msg("loaded", { name: "<sample>{name}.png" });
  setLanguage("en");
  assert.equal(translate(message), "Loaded <sample>{name}.png.");
  const error = new LocalizedError("maxRatioValue", { max: 999 });
  setLanguage("ja");
  assert.equal(translate(message), "<sample>{name}.png を読み込みました。");
  assert.equal(translate(errorMessage(error)), "999以下の値を入力してください。");
  assert.equal(t("dropHint"), "画像をドロップするか、「開く」から選択してください。");
  assert.equal(t("exportHelp"), "PNG・BMP・WebPは可逆形式で保存します。JPEGは最高品質で保存します。");
  assert.equal(t("positiveIntegers"), "1以上の整数を入力してください。");
});

test("static DOM labels and accessibility attributes change in place", () => {
  const label = { dataset: { i18n: "settings" }, textContent: "" };
  const attributes = new Map([["data-i18n-title", "open"], ["data-i18n-aria-label", "open"]]);
  const button = { getAttribute: (name) => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value) };
  const root = {
    documentElement: { lang: "en" },
    querySelectorAll: (selector) => selector === "[data-i18n]" ? [label] : ["[data-i18n-title]", "[data-i18n-aria-label]"].includes(selector) ? [button] : []
  };
  const unsubscribe = onLanguageChange(() => applyTranslations(root));
  setLanguage("ja");
  assert.equal(root.documentElement.lang, "ja");
  assert.equal(label.textContent, "設定");
  assert.equal(attributes.get("aria-label"), "画像を開く");
  setLanguage("en");
  assert.equal(label.textContent, "Settings");
  assert.equal(attributes.get("title"), "Open image files");
  unsubscribe();
});

test("every static HTML translation key resolves in both languages", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const [, key] of html.matchAll(/data-i18n(?:-(?:aria-label|title|placeholder|alt))?="([^"]+)"/g)) {
    assert.ok(key in messages.ja && key in messages.en, key);
    assert.ok(!messages.en[key].includes("{"), `Static key must not require parameters: ${key}`);
  }
});

test("native dialog titles and image filters follow the language without changing save options", async () => {
  const dialogs = [];
  globalThis.languageDialogTest = (options) => { dialogs.push(options); return null; };
  globalThis.window = { __TAURI_IPC__: () => {} };
  const dialogUrl = dataUrl("export const open = async options => globalThis.languageDialogTest(options); export const save = open;");
  const invokeUrl = dataUrl("export function invoke() { throw Error('Cancelled dialogs must not write files'); }");
  const runtime = (await import(await compile("runtimeBridge", {
    "@tauri-apps/api/dialog": dialogUrl,
    "@tauri-apps/api/tauri": invokeUrl
  }))).createRuntimeBridge();
  for (const language of ["ja", "en"]) {
    setLanguage(language);
    await runtime.openImageDialog(["png"]);
    assert.equal(dialogs.at(-1).title, messages[language].open);
    assert.equal(dialogs.at(-1).filters[0].name, messages[language].images);
    await runtime.openFolderDialog("/Pictures");
    assert.equal(dialogs.at(-1).title, messages[language].saveFolder);
    assert.equal(dialogs.at(-1).directory, true);
    assert.deepEqual(await runtime.saveImage("crop.png", new Uint8Array(), "png", "/Pictures"), { kind: "cancelled" });
    assert.equal(dialogs.at(-1).title, messages[language].save);
    assert.equal(dialogs.at(-1).defaultPath, "/Pictures/crop.png");
    assert.deepEqual(dialogs.at(-1).filters, [{ name: "PNG", extensions: ["png"] }]);
  }
});
