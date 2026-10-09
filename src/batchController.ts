import { batchCounts, batchTargets, createBatch, navigateBatch, snapshotCrop, toggleImage } from "./batchModel";
import { runBatch, scanBatch, type BatchProgress, type BatchRequest } from "./batchRuntime";
import type { OutputFormatChoice, Rect } from "./appTypes";
import type { RuntimeBridge } from "./runtimeBridge";
import { getLanguage, onLanguageChange } from "./i18n";

type Editor = {
  switchMode(batch: boolean): void;
  show(path: string | null, initialize: boolean): Promise<void>;
  crop(): Rect | null;
  aspect(): string;
  format(): OutputFormatChoice;
  lock(locked: boolean): void;
};
export function createBatchController(runtime: RuntimeBridge, editor: Editor) {
  const panel = document.createElement("section");
  panel.className = "batch-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="batch-row"><button data-id="files"></button><button data-id="folder"></button><span data-id="input"></span></div>
    <div data-id="summary"></div>
    <div class="batch-row"><button data-id="prev" aria-label="Previous image">←</button><span data-id="position"></span><button data-id="next" aria-label="Next image">→</button><label><input data-id="include" type="checkbox"><span data-id="include-label"></span></label></div>
    <div data-id="name"></div><div data-id="reason" class="batch-reason"></div>
    <div class="batch-row"><label data-id="output-label" for="batch-output"></label><input id="batch-output" data-id="output" type="text"><button data-id="choose"></button><label data-id="collision-label" for="batch-collision"></label><select id="batch-collision" data-id="collision"><option value="rename"></option><option value="skip"></option><option value="overwrite"></option></select><button data-id="run"></button></div>
    <progress data-id="progress" hidden></progress><div data-id="report" role="status" aria-live="polite"></div><details data-id="details" hidden><summary data-id="details-label"></summary><pre data-id="errors"></pre></details>`;
  document.querySelector(".workspace")!.append(panel);
  const mode = document.createElement("div");
  mode.className = "toolbar-group";
  mode.innerHTML = '<button type="button" aria-pressed="true">Single</button><button type="button" aria-pressed="false">Batch</button>';
  document.querySelector(".toolbar")!.prepend(mode);
  const [singleButton, batchButton] = Array.from(mode.querySelectorAll("button"));
  const el = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`[data-id="${id}"]`)!;
  const output = el<HTMLInputElement>("output");
  const include = el<HTMLInputElement>("include");
  let active = false;
  let busy = false;
  let state = createBatch([]);
  let initialized = false;
  const tr = (ja: string, en: string) => getLanguage() === "ja" ? ja : en;
  function refresh() {
    const counts = batchCounts(state.images);
    const image = state.images[state.index];
    el("files").textContent = tr("複数ファイル選択", "Select images");
    el("folder").textContent = tr("フォルダ選択", "Select folder");
    el("include-label").textContent = tr("クロップ対象に含める", "Include in batch");
    el("output-label").textContent = tr("出力先", "Output folder");
    el("choose").textContent = tr("変更", "Choose");
    el("collision-label").textContent = tr("同名ファイル", "Existing files");
    const options = el<HTMLSelectElement>("collision").options;
    options[0].text = tr("連番を付ける", "Rename"); options[1].text = tr("スキップ", "Skip"); options[2].text = tr("上書き", "Overwrite");
    el("details-label").textContent = tr("ファイル別の結果・読込エラー", "File results / read errors");
    el("summary").textContent = `${state.images.length.toLocaleString()} images　${tr("基準サイズ", "Reference")}: ${state.reference ? `${state.reference.width} × ${state.reference.height} px` : "—"}　${tr("対象", "Included")} ${counts.included} / ${state.images.length}　${tr("除外", "Excluded")} ${counts.excluded}　${tr("サイズ不一致", "Size mismatch")} ${counts["size-mismatch"]}　${tr("読込失敗", "Invalid")} ${counts.invalid}`;
    el("position").textContent = `${image ? state.index + 1 : 0} / ${state.images.length}`;
    el("name").textContent = image?.name ?? "";
    el("reason").textContent = image?.status === "size-mismatch" ? tr("サイズが異なるため処理対象外", "Excluded: different image size") + ` (${image.width} × ${image.height})` : image?.status === "excluded" ? tr("クロップ対象から除外済み", "Excluded from crop") : image?.status === "invalid" ? image.error ?? tr("読込失敗", "Invalid image") : "";
    include.checked = image?.status === "included";
    for (const control of panel.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) control.disabled = busy || runtime.kind !== "tauri";
    include.disabled ||= !image || !["included", "excluded"].includes(image.status);
    el<HTMLButtonElement>("prev").disabled ||= state.index <= 0;
    el<HTMLButtonElement>("next").disabled ||= state.index >= state.images.length - 1;
    el<HTMLButtonElement>("run").disabled ||= !counts.included || !initialized || !output.value.trim();
    el("run").textContent = tr(`${counts.included}枚をクロップ`, `Crop ${counts.included} images`);
    singleButton.disabled = busy;
    batchButton.disabled = busy;
    editor.lock(active && (busy || !image || image.status === "size-mismatch" || image.status === "invalid"));
  }
  function progress(value: BatchProgress) {
    const bar = el<HTMLProgressElement>("progress"); bar.hidden = false; bar.max = value.total || 1; bar.value = value.completed;
    el("report").textContent = `${value.completed} / ${value.total} (${value.total ? Math.round(100 * value.completed / value.total) : 0}%)　${value.name}`;
  }
  async function guarded(action: () => Promise<void>) {
    if (busy) return;
    busy = true; refresh();
    try { await action(); } catch (error) { el("report").textContent = String(error); }
    finally { busy = false; refresh(); }
  }
  async function preview() {
    const image = state.images[state.index];
    try {
      await editor.show(image && image.status !== "invalid" ? image.path : null, !initialized && image?.status === "included");
      if (image?.status === "included") initialized = true;
    } catch (error) {
      await editor.show(null, false);
      el("report").textContent = String(error);
    }
  }
  async function scanIntoSession(paths: string[], folder: string | null = null) {
      el("report").textContent = tr("画像を検証中…", "Validating images…");
      const metadata = await scanBatch(paths, folder, progress);
      state = createBatch(metadata); initialized = false;
      el("input").textContent = folder ?? tr("複数ファイル", "Selected files");
      const first = state.images.findIndex(i => i.status === "included");
      state.index = Math.max(0, first);
      const parent = folder ?? metadata[0]?.path.replace(/[\\/][^\\/]+$/, "");
      output.value = parent ? `${parent}/cropped` : "";
      el("report").textContent = tr("読込完了。← → で確認、Spaceで対象切替", "Loaded. ← → to browse, Space to include/exclude");
      el<HTMLProgressElement>("progress").hidden = true;
      el("errors").textContent = metadata.filter(i => i.error).map(i => `${i.name}: ${i.error}`).join("\n");
      el("details").hidden = !el("errors").textContent;
      await preview();
  }
  async function load(paths: string[], folder: string | null = null) {
    if (!active || busy) return;
    await guarded(() => scanIntoSession(paths, folder));
  }
  function switchMode(value: boolean) {
    if (busy || active === value) return;
    active = value;
    editor.switchMode(value);
    panel.hidden = !value;
    singleButton.setAttribute("aria-pressed", String(!value)); batchButton.setAttribute("aria-pressed", String(value));
    if (value && runtime.kind !== "tauri") el("report").textContent = tr("Batchはデスクトップ版で利用できる", "Batch requires the desktop app");
    refresh();
  }
  async function browse(offset: number) { await guarded(async () => { navigateBatch(state, offset); await preview(); }); }
  function toggle() { if (!busy && state.images[state.index]) { toggleImage(state.images[state.index]); refresh(); } }
  singleButton.onclick = () => switchMode(false); batchButton.onclick = () => switchMode(true);
  el("files").onclick = () => { void guarded(async () => {
    const paths = await runtime.openImageDialog(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
    if (paths.length) await scanIntoSession(paths);
  }); };
  el("folder").onclick = () => { void guarded(async () => {
    const folder = await runtime.openFolderDialog(undefined, tr("入力フォルダ", "Input folder"));
    if (folder) await scanIntoSession([], folder);
  }); };
  el("choose").onclick = () => { void guarded(async () => { const folder = await runtime.openFolderDialog(); if (folder) output.value = folder; }); };
  output.oninput = refresh;
  el("prev").onclick = () => { void browse(-1); }; el("next").onclick = () => { void browse(1); };
  include.onchange = toggle;
  el("run").onclick = () => { void guarded(async () => {
    const crop = editor.crop();
    if (!crop || !state.reference) return;
    const request: BatchRequest = { paths: batchTargets(state), output: output.value.trim(), crop: snapshotCrop(crop), ...state.reference, format: editor.format(), collision: el<HTMLSelectElement>("collision").value as BatchRequest["collision"] };
    const c = request.crop;
    const confirmation = `${tr(`${request.paths.length}枚をクロップ`, `Crop ${request.paths.length} images`)}\n\nx: ${c.x}, y: ${c.y}\n${c.width} × ${c.height} px\n${tr("アスペクト比", "Aspect ratio")}: ${editor.aspect()}\n${tr("出力先", "Output")}: ${request.output}\n${tr("保存形式", "Format")}: ${request.format}\n${tr("同名ファイル", "Existing files")}: ${el<HTMLSelectElement>("collision").selectedOptions[0].text}`;
    if (!window.confirm(confirmation)) return;
    const results = await runBatch(request, progress);
    el("report").textContent = tr("処理完了", "Completed") + "　" + [["success", tr("成功", "Success")], ["failed", tr("失敗", "Failed")], ["skipped", tr("スキップ", "Skipped")]].map(([key, label]) => `${label} ${results.filter(r => r.status === key).length}`).join("　");
    el("details").hidden = false;
    el("errors").textContent = results.map(r => `${r.status}: ${r.path}${r.error ? ` — ${r.error}` : ""}`).join("\n");
  }); };
  onLanguageChange(refresh);
  return {
    active: () => active,
    busy: () => busy,
    editable: () => !active || (!busy && ["included", "excluded"].includes(state.images[state.index]?.status)),
    reference: () => active ? state.reference : null,
    load,
    key(event: KeyboardEvent): boolean {
      if (!active) return false;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.code === "Space") {
        event.preventDefault();
        if (!busy && !event.altKey && !event.ctrlKey && !event.metaKey) {
          if (event.code === "Space") { if (!event.repeat) toggle(); }
          else void browse(event.key === "ArrowLeft" ? -1 : 1);
        }
        return true;
      }
      return !this.editable();
    }
  };
}
