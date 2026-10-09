import { getLanguage, onLanguageChange } from "./i18n";
import { filterBatchResults, type ResultFilter } from "./batchResults";
import type { BatchResult } from "./batchRuntime";
import type { BatchImage } from "./batchModel";

export function createBatchResultsModal() {
  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "batch-results-title");
  modal.innerHTML = `<div class="modal-content batch-results-content"><header class="modal-header"><h2 id="batch-results-title"></h2><button type="button">×</button></header><div class="batch-results-body"><p data-summary></p><select aria-label="Filter"></select><div data-list></div></div></div>`;
  document.body.append(modal);
  const closeButton = modal.querySelector("button")!;
  const filter = modal.querySelector("select")!;
  let results: BatchResult[] = [];
  let errors: BatchImage[] = [];
  let previousFocus: HTMLElement | null = null;
  const tr = (ja: string, en: string) => getLanguage() === "ja" ? ja : en;
  function render() {
    modal.querySelector("h2")!.textContent = tr("ファイル別の結果・読込エラー", "File results / read errors");
    closeButton.setAttribute("aria-label", tr("閉じる", "Close"));
    const selected = filter.value || "all";
    filter.replaceChildren(...[["all", tr("すべて", "All")], ["failed", tr("失敗のみ", "Failed only")], ["skipped", tr("スキップのみ", "Skipped only")]].map(([value, label]) => new Option(label, value)));
    filter.value = selected;
    filter.setAttribute("aria-label", tr("結果フィルタ", "Result filter"));
    modal.querySelector("[data-summary]")!.textContent = [["success", tr("成功", "Success")], ["failed", tr("失敗", "Failed")], ["skipped", tr("スキップ", "Skipped")]].map(([status, label]) => `${label} ${results.filter(r => r.status === status).length}`).join(" / ");
    const list = modal.querySelector("[data-list]")!;
    const fragment = document.createDocumentFragment();
    for (const result of filterBatchResults(results, selected as ResultFilter)) {
      const row = document.createElement("p");
      row.textContent = `${{success: "✓", failed: "✕", skipped: "−"}[result.status]} ${result.path}${result.status === "skipped" ? tr(" — スキップ", " — Skipped") : ""}${result.error ? `\n${result.error}` : ""}`;
      fragment.append(row);
    }
    if (selected !== "skipped" && errors.length) {
      const heading = document.createElement("h3"); heading.textContent = tr("読込エラー", "Read errors"); fragment.append(heading);
      for (const error of errors) {
        const row = document.createElement("p"); row.textContent = `✕ ${error.path}\n${error.error ?? tr("読込失敗", "Invalid image")}`; fragment.append(row);
      }
    }
    list.replaceChildren(fragment);
  }
  function close() { modal.classList.add("hidden"); previousFocus?.focus(); }
  closeButton.onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  filter.onchange = render;
  onLanguageChange(() => { if (!modal.classList.contains("hidden")) render(); });
  return {
    open(value: BatchResult[], images: BatchImage[]) {
      results = value; errors = images.filter(i => i.status === "invalid");
      previousFocus = document.activeElement as HTMLElement;
      filter.value = "all"; render(); modal.classList.remove("hidden"); closeButton.focus();
    },
    clear() { if (!modal.classList.contains("hidden")) close(); results = []; errors = []; modal.querySelector("[data-list]")!.replaceChildren(); },
    key(event: KeyboardEvent) {
      if (modal.classList.contains("hidden")) return false;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        event.preventDefault();
        (document.activeElement === closeButton ? filter : closeButton).focus();
      }
      return true;
    }
  };
}
