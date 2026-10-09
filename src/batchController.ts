import { createBatchResults } from "./batchResults";
import { createBatchResultsModal } from "./batchResultsModal";
import { batchCounts, batchTargets, createBatch, navigateBatch, setBatchIndex, snapshotCrop, toggleImage } from "./batchModel";
import { runBatch, scanBatch, type BatchProgress, type BatchRequest } from "./batchRuntime";
import type { OutputFormatChoice, Rect, WebpCompressionPreset } from "./appTypes";
import type { RuntimeBridge } from "./runtimeBridge";
import { outputFormatLabel } from "./outputFormat";
import { getLanguage, onLanguageChange, t } from "./i18n";

type Editor = {
  clear(): void;
  switchMode(batch: boolean): void;
  show(path: string | null, initialize: boolean): Promise<void>;
  crop(): Rect | null;
  aspect(): string;
  format(): OutputFormatChoice;
  webpCompression(): WebpCompressionPreset;
  lock(locked: boolean, busy: boolean): void;
};
export function createBatchController(runtime: RuntimeBridge, editor: Editor) {
  const input = document.createElement("div");
  input.className = "batch-input toolbar-group";
  input.innerHTML = `<button data-id="files"></button><button data-id="folder"></button><button data-id="clear"></button>`;
  document.querySelector(".toolbar-group-open")!.append(input);
  const navigation = document.createElement("div");
  navigation.className = "batch-navigation";
  navigation.innerHTML = `<button data-id="prev">←</button><input data-id="position" class="batch-position" type="text" inputmode="numeric"><span data-id="total"></span><button data-id="next">→</button><label><input data-id="include" type="checkbox"><span data-id="include-label"></span></label><span data-id="name"></span><button data-id="results" hidden></button>`;
  document.querySelector(".editor-utility-bar")!.prepend(navigation);
  const summary = document.createElement("span");
  summary.innerHTML = `<span data-id="summary"></span><span data-id="reason" class="batch-reason"></span><progress data-id="progress" hidden></progress>`;
  document.querySelector("#status-text")!.after(summary);
  const modal = document.createElement("dialog");
  modal.className = "batch-save-modal";
  modal.setAttribute("aria-labelledby", "batch-save-title");
  modal.innerHTML = `<h2 id="batch-save-title" data-id="save-title"></h2><p data-id="crop"></p><p data-id="format"></p><p data-id="webp"></p><div class="batch-row"><label data-id="output-label" for="batch-output"></label><input id="batch-output" data-id="output" type="text"><button data-id="choose"></button></div><div class="batch-row"><label data-id="collision-label" for="batch-collision"></label><select id="batch-collision" data-id="collision"><option value="rename"></option><option value="skip"></option><option value="overwrite"></option></select></div><div class="batch-save-actions"><button data-id="cancel"></button><button data-id="run"></button></div>`;
  document.body.append(modal);
  const surfaces = [input, navigation, summary, modal];
  const controls = new Map(surfaces.flatMap(surface => Array.from(surface.querySelectorAll<HTMLElement>("[data-id]")).map(element => [element.dataset.id!, element] as const)));
  controls.set("report", document.querySelector<HTMLElement>("#status-text")!);
  const mode = document.createElement("div");
  mode.className = "toolbar-group";
  mode.innerHTML = '<button type="button" aria-pressed="true">Single</button><button type="button" aria-pressed="false">Batch</button>';
  document.querySelector(".toolbar")!.prepend(mode);
  const [singleButton, batchButton] = Array.from(mode.querySelectorAll("button"));
  const el = <T extends HTMLElement>(id: string) => controls.get(id)! as T;
  const saveButton = document.querySelector<HTMLButtonElement>("#save-button")!;
  let report = "";
  function setReport(value: string) { report = value; if (active) el("report").textContent = value; }
  const output = el<HTMLInputElement>("output");
  const include = el<HTMLInputElement>("include");
  const results = createBatchResults();
  const resultsModal = createBatchResultsModal();
  const position = el<HTMLInputElement>("position");
  let active = false;
  let busy = false;
  let state = createBatch([]);
  let initialized = false;
  const tr = (ja: string, en: string) => getLanguage() === "ja" ? ja : en;
  function syncOutputFormat() {
    const format = editor.format();
    el("format").textContent = `${t("exportFormat")}: ${format === "same" ? t("sameAsOriginal") : outputFormatLabel(format)}`;
  }
  function refresh() {
    input.hidden = navigation.hidden = summary.hidden = !active;
    el("save-title").textContent = tr("Batch保存", "Save batch");
    el("cancel").textContent = tr("キャンセル", "Cancel");
    syncOutputFormat();
    const counts = batchCounts(state.images);
    const image = state.images[state.index];
    el("files").textContent = tr("複数ファイル選択", "Select images");
    el("folder").textContent = tr("フォルダ選択", "Select folder");
    el("include-label").textContent = tr("対象", "Include");
    el("output-label").textContent = t("batchOutputFolder");
    el("choose").textContent = tr("変更", "Choose");
    el("collision-label").textContent = t("batchCollision");
    const options = el<HTMLSelectElement>("collision").options;
    options[0].text = tr("連番を付ける", "Rename"); options[1].text = tr("スキップ", "Skip"); options[2].text = tr("上書き", "Overwrite");
    el("results").textContent = tr("結果を表示", "View results");
    el("clear").textContent = tr("解除", "Clear");
    el("results").hidden = !results.get().length && !state.images.some(i => i.status === "invalid");
    if (results.get().length) {
      setReport(tr("処理完了：", "Completed: ") + [["success", tr("成功", "Success")], ["failed", tr("失敗", "Failed")], ["skipped", tr("スキップ", "Skipped")]].map(([key, label]) => `${label} ${results.get().filter(r => r.status === key).length}`).join(" / "));
    }
    el("summary").textContent = `${tr("対象", "Included")} ${counts.included} / ${state.images.length}　${tr("除外", "Excluded")} ${counts.excluded}　${tr("サイズ不一致", "Size mismatch")} ${counts["size-mismatch"]}　${tr("読込失敗", "Invalid")} ${counts.invalid}`;
    if (document.activeElement !== position) position.value = String(image ? state.index + 1 : 0);
    position.setAttribute("aria-label", tr("現在の画像番号", "Current image number"));
    el("total").textContent = `/ ${state.images.length}`;
    el("prev").setAttribute("aria-label", tr("前の画像", "Previous image"));
    el("next").setAttribute("aria-label", tr("次の画像", "Next image"));
    el("name").textContent = image?.name ?? "";
    el("reason").textContent = image?.status === "size-mismatch" ? tr("サイズが異なるため処理対象外", "Excluded: different image size") + ` (${image.width} × ${image.height})` : image?.status === "excluded" ? tr("クロップ対象から除外済み", "Excluded from crop") : image?.status === "invalid" ? image.error ?? tr("読込失敗", "Invalid image") : "";
    include.checked = image?.status === "included";
    for (const control of surfaces.flatMap(surface => Array.from(surface.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")))) control.disabled = busy || runtime.kind !== "tauri";
    position.disabled ||= !state.images.length;
    el<HTMLButtonElement>("clear").disabled ||= !state.images.length;
    include.disabled ||= !image || !["included", "excluded"].includes(image.status);
    el<HTMLButtonElement>("prev").disabled ||= state.index <= 0;
    el<HTMLButtonElement>("next").disabled ||= state.index >= state.images.length - 1;
    el<HTMLButtonElement>("run").disabled ||= !counts.included || !initialized || !output.value.trim();
    el("run").textContent = t("batchSave", { count: counts.included.toLocaleString(getLanguage()) });
    singleButton.disabled = busy;
    batchButton.disabled = busy;
    if (active) saveButton.disabled = busy || !counts.included || !initialized;
    editor.lock(active && (busy || !image || image.status === "size-mismatch" || image.status === "invalid"), busy);
  }
  function progress(value: BatchProgress) {
    const bar = el<HTMLProgressElement>("progress"); bar.hidden = false; bar.max = value.total || 1; bar.value = value.completed;
    setReport(`${value.completed} / ${value.total} (${value.total ? Math.round(100 * value.completed / value.total) : 0}%)　${value.name}`);
  }
  async function guarded(action: () => Promise<void>) {
    if (busy) return;
    busy = true; refresh();
    try { await action(); } catch (error) { setReport(String(error)); }
    finally { busy = false; refresh(); }
  }
  async function preview() {
    const image = state.images[state.index];
    try {
      await editor.show(image && image.status !== "invalid" ? image.path : null, !initialized && image?.status === "included");
      if (image?.status === "included") initialized = true;
    } catch (error) {
      await editor.show(null, false);
      // Scanning only reads headers, so a corrupt image can first fail here; exclude it from the run.
      if (image && image.status !== "invalid") { image.status = "invalid"; image.error = String(error); }
      setReport(String(error));
    }
  }
  function clearResults() {
    results.clear(); resultsModal.clear(); el("results").hidden = true;
    const bar = el<HTMLProgressElement>("progress"); bar.hidden = true; bar.value = 0;
    setReport("");
  }
  async function scanIntoSession(paths: string[], folder: string | null = null) {
      clearResults();
      state = createBatch([]); initialized = false; editor.clear();
      input.title = "";
      setReport(tr("画像を検証中…", "Validating images…"));
      const metadata = await scanBatch(paths, folder, progress);
      state = createBatch(metadata); initialized = false;
      input.title = folder ?? tr("複数ファイル", "Selected files");
      const first = state.images.findIndex(i => i.status === "included");
      setBatchIndex(state, first + 1);
      const parent = folder ?? metadata[0]?.path.replace(/[\\/][^\\/]+$/, "");
      output.value = parent ? `${parent}/cropped` : "";
      setReport(tr("読込完了。← → で確認、Spaceで対象切替", "Loaded. ← → to browse, Space to include/exclude"));
      el<HTMLProgressElement>("progress").hidden = true;
      el("results").hidden = !state.images.some(i => i.status === "invalid");
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
    if (value) setReport(report);
    singleButton.setAttribute("aria-pressed", String(!value)); batchButton.setAttribute("aria-pressed", String(value));
    if (value && runtime.kind !== "tauri") setReport(tr("Batchはデスクトップ版で利用できる", "Batch requires the desktop app"));
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
  async function commitPosition() {
    if (busy) return;
    const oldIndex = state.index;
    setBatchIndex(state, position.value);
    position.value = String(state.images.length ? state.index + 1 : 0);
    if (oldIndex !== state.index) await guarded(preview);
  }
  position.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); void commitPosition(); } };
  position.onblur = () => { void commitPosition(); };
  el("clear").onclick = () => {
    if (busy) return;
    state = createBatch([]); initialized = false; clearResults();
    input.title = ""; editor.clear(); refresh();
  };
  el("results").onclick = () => resultsModal.open(results.get(), state.images);
  el("cancel").onclick = () => modal.close();
  el("run").onclick = () => { if (!modal.open || !output.value.trim()) return; void guarded(async () => {
    const crop = editor.crop();
    if (!crop || !state.reference) return;
    const request: BatchRequest = { paths: batchTargets(state), output: output.value.trim(), crop: snapshotCrop(crop), ...state.reference, format: editor.format(), webpCompression: editor.webpCompression(), collision: el<HTMLSelectElement>("collision").value as BatchRequest["collision"] };
    modal.close();
    clearResults();
    const completed = await runBatch(request, progress);
    results.replace(completed);
    el("results").hidden = false;
  }); };
  refresh();
  onLanguageChange(refresh);
  return {
    syncOutputFormat,
    openSave() {
      if (!active || busy || !initialized || !batchTargets(state).length) return;
      refresh();
      const crop = editor.crop();
      if (!crop) return;
      el("crop").textContent = `${tr("対象", "Images")}: ${batchTargets(state).length.toLocaleString(getLanguage())}　${tr("クロップ", "Crop")}: ${crop.width} × ${crop.height} px (x: ${crop.x}, y: ${crop.y})　${editor.aspect()}`;
      const usesWebp = editor.format() === "webp" || (editor.format() === "same" && batchTargets(state).some(path => /\.webp$/i.test(path)));
      el("webp").hidden = !usesWebp;
      el("webp").textContent = `${t("webpCompression")}: ${t(editor.webpCompression() === "fast" ? "webpFast" : editor.webpCompression() === "smallest" ? "webpSmallest" : "webpBalanced")}`;
      modal.showModal();
    },
    modalKey(event: KeyboardEvent) { return modal.open || resultsModal.key(event); },
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
