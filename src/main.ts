import type {
  AspectPreset,
  DragState,
  Handle,
  LoadedImageSource,
  OutputCrop,
  OutputFormat,
  PathBatchSource,
  Point,
  Rect,
  WindowBounds
} from "./appTypes";
import {
  largestCropRect,
  minCropSize,
  moveCrop,
  pointInRect,
  recalcCropForAspect,
  resizeCrop,
  scaleCropFromCenter
} from "./cropGeometry";
import { createFileDropController } from "./fileDropController";
import { ensureNonAnimatedImage } from "./imageAnimationGuard";
import { createModalController } from "./modalController";
import {
  browserEncodingOptions,
  isBrowserEncodedFormat,
  outputFormatLabel,
  parseOutputFormatChoice,
  preferredOutputExtension,
  resolveOutputFormatChoice
} from "./outputFormat";
import { createRuntimeBridge, type SaveResult } from "./runtimeBridge";
import { loadOutputFormatChoice, persistOutputFormatChoice, loadSaveFolderSettings, persistSaveFolderMode, persistCustomSaveFolder, recordSuccessfulSave } from "./settingsStore";
import { parseSaveFolderMode, resolveSaveFolder } from "./saveFolder";
import { createZoomViewport } from "./zoomViewport";
import { sourceToView } from "./zoomGeometry";

const HANDLE_SIZE = 12;
const MULTI_IMAGE_CONFIRM_THRESHOLD = 10;
const MAX_ASPECT_INPUT = 999;
const LEGACY_CUSTOM_ASPECT_STORAGE_KEY = "photo-trimer.custom-aspect-presets";
const LEGACY_SELECTED_ASPECT_STORAGE_KEY = "photo-trimer.selected-aspect-preset";
const LEGACY_WINDOW_BOUNDS_STORAGE_KEY = "photo-trimer.window-bounds";
const CUSTOM_ASPECT_STORAGE_KEY = "aspect-crop.custom-aspect-presets";
const SELECTED_ASPECT_STORAGE_KEY = "aspect-crop.selected-aspect-preset";
const WINDOW_BOUNDS_STORAGE_KEY = "aspect-crop.window-bounds";
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
const WINDOW_BOUNDS_SAVE_DELAY_MS = 180;
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;
const BUILT_IN_ASPECT_PRESETS: AspectPreset[] = [
  { id: "16:9", label: "16:9", width: 16, height: 9, builtIn: true },
  { id: "4:5", label: "4:5", width: 4, height: 5, builtIn: true },
  { id: "5:7", label: "5:7", width: 5, height: 7, builtIn: true },
  { id: "4:3", label: "4:3", width: 4, height: 3, builtIn: true },
  { id: "3:5", label: "3:5", width: 3, height: 5, builtIn: true },
  { id: "3:2", label: "3:2", width: 3, height: 2, builtIn: true },
  { id: "2:1", label: "2:1", width: 2, height: 1, builtIn: true },
  { id: "1:1", label: "1:1", width: 1, height: 1, builtIn: true }
];
const DEFAULT_ASPECT_PRESET_ID = BUILT_IN_ASPECT_PRESETS[0]?.id ?? "16:9";

let windowBoundsSaveTimer: number | null = null;
let isSyncingCropDimensionInputs = false;
const runtime = createRuntimeBridge();
const isTauriRuntime = runtime.kind === "tauri";
const initialAspectPresets = mergeAspectPresets(BUILT_IN_ASPECT_PRESETS, loadCustomAspectPresets());
const initialSelectedAspectId = loadSelectedAspectPresetId(initialAspectPresets);
const initialOutputFormatChoice = loadOutputFormatChoice();

const canvas = must<HTMLCanvasElement>("#editor-canvas");
const dropZone = must<HTMLDivElement>("#drop-zone");
const dropHint = must<HTMLParagraphElement>("#drop-hint");
const fileInput = must<HTMLInputElement>("#file-input");
const openButton = must<HTMLButtonElement>("#open-button");
const ratioSelect = must<HTMLSelectElement>("#ratio-select");
const landscapeRatioLabel = must<HTMLSpanElement>("#landscape-ratio-label");
const portraitRatioLabel = must<HTMLSpanElement>("#portrait-ratio-label");
const orientationToggle = must<HTMLDivElement>("#orientation-toggle");
const landscapeOrientationButton = must<HTMLButtonElement>("#landscape-orientation-button");
const portraitOrientationButton = must<HTMLButtonElement>("#portrait-orientation-button");
const addRatioButton = must<HTMLButtonElement>("#add-ratio-button");
const previewButton = must<HTMLButtonElement>("#preview-button");
const saveButton = must<HTMLButtonElement>("#save-button");
const statusText = must<HTMLSpanElement>("#status-text");
const imageSizeText = must<HTMLSpanElement>("#image-size");
const cropSizeText = must<HTMLSpanElement>("#crop-size");
const cropWidthInput = must<HTMLInputElement>("#crop-width-input");
const cropHeightInput = must<HTMLInputElement>("#crop-height-input");
const previewModal = must<HTMLDivElement>("#preview-modal");
const previewImage = must<HTMLImageElement>("#preview-image");
const closePreview = must<HTMLButtonElement>("#close-preview");
const ratioModal = must<HTMLDivElement>("#ratio-modal");
const closeRatioModal = must<HTMLButtonElement>("#close-ratio-modal");
const outputFormatSelect = must<HTMLSelectElement>("#output-format-select");
const saveFolderSettings = must<HTMLFieldSetElement>("#save-folder-settings");
const customSaveFolder = must<HTMLInputElement>("#custom-save-folder");
const changeSaveFolder = must<HTMLButtonElement>("#change-save-folder");
const saveFolderHelp = must<HTMLParagraphElement>("#save-folder-help");
const ratioForm = must<HTMLFormElement>("#ratio-form");
const ratioWidthInput = must<HTMLInputElement>("#ratio-width-input");
const ratioHeightInput = must<HTMLInputElement>("#ratio-height-input");
const ratioFormError = must<HTMLParagraphElement>("#ratio-form-error");
const customRatioList = must<HTMLDivElement>("#custom-ratio-list");
const customRatioEmpty = must<HTMLParagraphElement>("#custom-ratio-empty");

const ctx = get2dContext(canvas);

const state = {
  image: null as HTMLImageElement | null,
  imageName: "",
  imageSource: null as LoadedImageSource | null,
  aspectPresets: initialAspectPresets,
  selectedAspectId: initialSelectedAspectId,
  outputFormatChoice: initialOutputFormatChoice,
  isAspectSwapped: false,
  aspect: aspectValueFromPresetId(initialSelectedAspectId, initialAspectPresets),
  crop: null as Rect | null,
  imageRect: null as Rect | null,
  drag: null as DragState | null,
  previewUrl: null as string | null
};

const editorZoom = createZoomViewport({
  viewport: must<HTMLElement>("#editor-viewport"),
  surface: must<HTMLElement>("#editor-surface"),
  controls: must<HTMLElement>("#editor-zoom-controls"),
  slider: must<HTMLInputElement>("#editor-zoom"),
  output: must<HTMLOutputElement>("#editor-zoom-value"),
  onChange: (image, width, height) => {
    state.imageRect = state.image ? image : null;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (state.drag) {
      if (canvas.hasPointerCapture(state.drag.pointerId)) canvas.releasePointerCapture(state.drag.pointerId);
      state.drag = null;
    }
    resizeCanvas();
  }
});

const previewViewport = must<HTMLElement>("#preview-viewport");
const previewZoom = createZoomViewport({
  viewport: previewViewport,
  surface: must<HTMLElement>("#preview-surface"),
  controls: must<HTMLElement>("#preview-zoom-controls"),
  slider: must<HTMLInputElement>("#preview-zoom"),
  output: must<HTMLOutputElement>("#preview-zoom-value"),
  onChange: (image) => {
    previewImage.style.width = `${image.width}px`;
    previewImage.style.height = `${image.height}px`;
    previewImage.style.left = `${image.x + previewViewport.scrollLeft}px`;
    previewImage.style.top = `${image.y + previewViewport.scrollTop}px`;
  }
});
previewImage.addEventListener("load", () => {
  previewZoom.setImage(previewImage.naturalWidth, previewImage.naturalHeight);
});

const modalController = createModalController({
  previewModal,
  previewImage,
  closePreviewButton: closePreview,
  ratioModal,
  closeRatioButton: closeRatioModal,
  ratioInitialFocus: outputFormatSelect,
  prepareRatioModal: () => {
    syncOutputFormatSelect();
    syncSaveFolderSettings();
    setRatioFormValues(currentAspectDimensions());
    clearRatioFormError();
    renderCustomAspectList();
  },
  onCloseRatio: () => {
    clearRatioFormError();
    ratioForm.reset();
  }
});

const fileDropController = createFileDropController({
  runtimeKind: runtime.kind,
  dropZone,
  bindNativeDrop: isTauriRuntime ? (listener) => runtime.onNativeFileDrop(listener) : undefined,
  loadPathBatch: async (paths) => {
    await openPathBatch(paths, "drop");
  },
  loadFile: async (file) => {
    await loadImageFromFile(file);
    return state.imageName;
  },
  onStatus: setStatus,
  formatError: asMessage,
  supportedUniquePaths
});

syncOutputFormatSelect();
syncAspectUi();
setupEvents();
void setupWindowStatePersistence();
resizeCanvas();
render();
void loadStartupImageIfAny();

function setupEvents(): void {
  saveFolderSettings.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== "save-folder-mode") return;
    persistSaveFolderMode(parseSaveFolderMode(input.value));
    syncSaveFolderSettings();
  });
  changeSaveFolder.addEventListener("click", async () => {
    changeSaveFolder.disabled = true;
    let errorMessage = "";
    try {
      const settings = loadSaveFolderSettings();
      const initial = await resolveSaveFolder({ ...settings, mode: "custom" },
        state.imageSource?.kind === "path" ? state.imageSource.path : null,
        (path) => runtime.isSaveFolderAvailable(path));
      const selected = await runtime.openFolderDialog(initial);
      if (selected) {
        if (await runtime.isSaveFolderAvailable(selected)) persistCustomSaveFolder(selected);
        else errorMessage = "このフォルダは利用できません。別のフォルダを選択してください。";
      }
    } catch (error) {
      errorMessage = asMessage(error);
    } finally {
      syncSaveFolderSettings();
      if (errorMessage) saveFolderHelp.textContent = errorMessage;
    }
  });
  openButton.addEventListener("click", () => {
    if (isTauriRuntime) {
      void openImagesFromDialog();
      return;
    }

    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files ?? []);
    const [file] = files;
    if (!file) {
      return;
    }

    try {
      await loadImageFromFile(file);
      if (files.length > 1) {
        setStatus(
          `Loaded ${state.imageName}. Additional files were ignored outside the desktop runtime.`,
          true
        );
      } else {
        setStatus(`Loaded ${state.imageName}.`);
      }
    } catch (error) {
      setStatus(asMessage(error), true);
    } finally {
      fileInput.value = "";
    }
  });

  ratioSelect.addEventListener("change", () => {
    applyAspectPreset(ratioSelect.value);
  });

  outputFormatSelect.addEventListener("change", () => {
    const choice = parseOutputFormatChoice(outputFormatSelect.value);
    if (!choice) {
      syncOutputFormatSelect();
      return;
    }

    state.outputFormatChoice = choice;
    persistOutputFormatChoice(choice);
  });

  cropWidthInput.addEventListener("input", () => {
    previewCropDimensionInput("width");
  });

  cropHeightInput.addEventListener("input", () => {
    previewCropDimensionInput("height");
  });

  cropWidthInput.addEventListener("change", () => {
    commitCropDimensionInput("width");
  });

  cropHeightInput.addEventListener("change", () => {
    commitCropDimensionInput("height");
  });

  landscapeOrientationButton.addEventListener("click", () => {
    setAspectOrientation("landscape");
  });

  portraitOrientationButton.addEventListener("click", () => {
    setAspectOrientation("portrait");
  });

  addRatioButton.addEventListener("click", () => {
    modalController.openRatio();
  });

  previewButton.addEventListener("click", async () => {
    if (!state.image || !state.crop) {
      return;
    }

    try {
      const previewUrl = await makePreviewUrl();
      if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl);
      }
      state.previewUrl = previewUrl;
      modalController.openPreview(previewUrl);
    } catch (error) {
      setStatus(asMessage(error), true);
    }
  });

  saveButton.addEventListener("click", async () => {
    if (!state.image || !state.crop) {
      return;
    }

    try {
      await saveCroppedImage();
    } catch (error) {
      setStatus(asMessage(error), true);
    }
  });

  ratioForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCustomAspectRatio();
  });
  customRatioList.addEventListener("click", onCustomRatioListClick);

  window.addEventListener("resize", () => {
    resizeCanvas();
  });
  window.addEventListener("keydown", onKeyDown);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onCanvasWheel, { passive: false });

  void fileDropController.bind();
}

async function setupWindowStatePersistence(): Promise<void> {
  if (!isTauriRuntime) {
    return;
  }

  if ((await runtime.getWindowLabel()) === "main") {
    await restoreWindowBounds();
  }

  await runtime.onWindowBoundsChanged(() => {
    scheduleWindowBoundsPersist();
  });
}

async function loadStartupImageIfAny(): Promise<void> {
  if (!isTauriRuntime) {
    return;
  }

  try {
    const startupPath = await runtime.takeStartupPath();
    if (!startupPath) {
      return;
    }

    await loadImageFromPath(startupPath);
    setStatus(`Loaded ${state.imageName} from startup file.`);
  } catch (error) {
    setStatus(asMessage(error), true);
  }
}

async function openImagesFromDialog(): Promise<void> {
  try {
    const paths = await runtime.openImageDialog(Array.from(SUPPORTED_IMAGE_EXTENSIONS));
    if (paths.length === 0) {
      return;
    }

    await openPathBatch(paths, "open");
  } catch (error) {
    setStatus(asMessage(error), true);
  }
}

async function openPathBatch(rawPaths: string[], source: PathBatchSource): Promise<void> {
  if (!isTauriRuntime) {
    throw new Error("Opening image paths requires the desktop app runtime.");
  }

  const paths = supportedUniquePaths(rawPaths);
  if (paths.length === 0) {
    throw new Error("No supported image files were found.");
  }

  if (!confirmLargeImageBatch(paths.length, source)) {
    setStatus("Opening was cancelled.");
    return;
  }

  const reuseCurrentWindow = shouldReuseCurrentWindow(paths.length);
  const currentPath = reuseCurrentWindow ? paths[0] : null;
  const extraPaths = reuseCurrentWindow ? paths.slice(1) : paths;

  if (currentPath) {
    await loadImageFromPath(currentPath);
  }

  if (extraPaths.length > 0) {
    await runtime.openImageWindows(extraPaths, await currentWindowBounds());
  }

  setStatus(buildBatchStatusMessage(currentPath, extraPaths.length, source, reuseCurrentWindow));
}

function applyAspectPreset(presetId: string): void {
  const preset = storedAspectPresetById(presetId);
  if (!preset) {
    return;
  }

  state.selectedAspectId = preset.id;
  state.isAspectSwapped = false;
  syncAspectChange();
}

async function submitCustomAspectRatio(): Promise<void> {
  const width = parseIntegerInput(ratioWidthInput.value);
  const height = parseIntegerInput(ratioHeightInput.value);

  if (!width || !height) {
    setRatioFormError("Use whole numbers greater than 0.");
    return;
  }

  if (width > MAX_ASPECT_INPUT || height > MAX_ASPECT_INPUT) {
    setRatioFormError(`Values up to ${MAX_ASPECT_INPUT} are supported.`);
    return;
  }

  const ensuredPreset = ensureAspectPreset(width, height);
  applyAspectPreset(ensuredPreset.preset.id);
  modalController.closeRatio();
  setStatus(
    ensuredPreset.created
      ? `Added custom aspect ratio ${ensuredPreset.preset.label}.`
      : `${ensuredPreset.preset.label} is already available, so it was selected.`
  );
}

function deleteCustomAspectPreset(presetId: string): void {
  const preset = storedAspectPresetById(presetId);
  if (!preset) {
    return;
  }

  if (preset.builtIn) {
    setRatioFormError("Built-in aspect ratios cannot be deleted.");
    return;
  }

  const confirmed = window.confirm(`Delete custom aspect ratio ${preset.label}?`);
  if (!confirmed) {
    return;
  }

  const customPresets = customAspectPresets();
  const deletedIndex = customPresets.findIndex((candidate) => candidate.id === preset.id);
  state.aspectPresets = state.aspectPresets.filter((candidate) => candidate.id !== preset.id);
  persistCustomAspectPresets();

  const fallbackId = fallbackAspectPresetIdAfterDelete(deletedIndex);
  state.selectedAspectId = fallbackId;
  state.isAspectSwapped = false;
  syncAspectChange();
  setRatioFormValues(selectedAspectPreset());
  setStatus(`Deleted custom aspect ratio ${preset.label}.`);
}

function setAspectOrientation(targetOrientation: "landscape" | "portrait"): void {
  const preset = selectedAspectPreset();
  if (preset.width === preset.height) {
    setStatus(`${preset.label} stays the same when width and height are swapped.`);
    return;
  }

  state.isAspectSwapped = targetOrientation !== baseAspectOrientation(preset);
  syncAspectChange();

  const activeRatio = currentAspectDimensions();
  setStatus(`Using ${activeRatio.width}:${activeRatio.height}.`);
}

function moveCustomAspectPreset(presetId: string, direction: -1 | 1): void {
  const preset = storedAspectPresetById(presetId);
  if (!preset) {
    return;
  }

  if (preset.builtIn) {
    setRatioFormError("Built-in aspect ratios stay in the default order.");
    return;
  }

  const customPresets = customAspectPresets();
  const currentIndex = customPresets.findIndex((candidate) => candidate.id === preset.id);
  const targetIndex = currentIndex + direction;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= customPresets.length) {
    return;
  }

  const reordered = [...customPresets];
  const [movedPreset] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, movedPreset);

  state.aspectPresets = mergeAspectPresets(BUILT_IN_ASPECT_PRESETS, reordered);
  persistCustomAspectPresets();
  syncAspectUi();
  setRatioFormValues(selectedAspectPreset());

  const directionLabel = direction < 0 ? "up" : "down";
  setStatus(`Moved custom aspect ratio ${preset.label} ${directionLabel}.`);
}

function renderAspectOptions(): void {
  ratioSelect.innerHTML = "";

  const builtInPresets = state.aspectPresets.filter((preset) => preset.builtIn);
  const customPresets = state.aspectPresets.filter((preset) => !preset.builtIn);

  appendPresetGroup(ratioSelect, "Default", builtInPresets);
  appendPresetGroup(ratioSelect, "Custom", customPresets);

  const selectedPreset = selectedAspectPreset();
  ratioSelect.title = "";
  ratioSelect.value = selectedPreset.id;
}

function appendPresetGroup(target: HTMLSelectElement, label: string, presets: AspectPreset[]): void {
  if (presets.length === 0) {
    return;
  }

  const group = document.createElement("optgroup");
  group.label = label;

  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    group.append(option);
  }

  target.append(group);
}

function ensureAspectPreset(width: number, height: number): { preset: AspectPreset; created: boolean } {
  const reduced = reduceRatio(width, height);
  const label = aspectRatioLabel(reduced.width, reduced.height);
  const existingPreset = storedAspectPresetByRatio(reduced.width, reduced.height);
  if (existingPreset) {
    return { preset: existingPreset, created: false };
  }

  const customPreset: AspectPreset = {
    id: label,
    label,
    width: reduced.width,
    height: reduced.height,
    builtIn: false
  };

  state.aspectPresets = mergeAspectPresets(state.aspectPresets, [customPreset]);
  persistCustomAspectPresets();

  return { preset: customPreset, created: true };
}

function syncSwapRatioButton(preset: AspectPreset): void {
  const isSquare = preset.width === preset.height;
  const landscape = landscapeAspectDimensions(preset);
  const portrait = portraitAspectDimensions(preset);
  const activeOrientation = isSquare ? "square" : currentAspectDimensions().width > currentAspectDimensions().height ? "landscape" : "portrait";

  landscapeRatioLabel.textContent = aspectRatioLabel(landscape.width, landscape.height);
  portraitRatioLabel.textContent = aspectRatioLabel(portrait.width, portrait.height);
  orientationToggle.dataset.activeOrientation = activeOrientation;

  landscapeOrientationButton.classList.toggle("is-active", activeOrientation === "landscape");
  portraitOrientationButton.classList.toggle("is-active", activeOrientation === "portrait");

  landscapeOrientationButton.disabled = isSquare;
  portraitOrientationButton.disabled = isSquare;

  landscapeOrientationButton.title = isSquare
    ? "Width and height are already the same."
    : `Use ${landscapeRatioLabel.textContent}`;
  portraitOrientationButton.title = isSquare
    ? "Width and height are already the same."
    : `Use ${portraitRatioLabel.textContent}`;

  landscapeOrientationButton.setAttribute(
    "aria-label",
    isSquare ? `Aspect ratio ${preset.label} is square.` : `Use ${landscapeRatioLabel.textContent}`
  );
  portraitOrientationButton.setAttribute(
    "aria-label",
    isSquare ? `Aspect ratio ${preset.label} is square.` : `Use ${portraitRatioLabel.textContent}`
  );
}

function storedAspectPresetByRatio(width: number, height: number): AspectPreset | null {
  const label = aspectRatioLabel(width, height);
  return state.aspectPresets.find((preset) => preset.label === label) ?? null;
}

function aspectRatioLabel(width: number, height: number): string {
  return `${width}:${height}`;
}

function renderCustomAspectList(): void {
  const presets = customAspectPresets();
  customRatioList.innerHTML = "";
  customRatioEmpty.classList.toggle("hidden", presets.length > 0);
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < presets.length; index += 1) {
    const preset = presets[index];
    const row = document.createElement("div");
    row.className = "custom-ratio-row";

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "custom-ratio-item";
    if (preset.id === state.selectedAspectId) {
      selectButton.classList.add("is-selected");
    }
    selectButton.textContent = preset.label;
    selectButton.dataset.action = "select";
    selectButton.dataset.presetId = preset.id;

    const actions = document.createElement("div");
    actions.className = "custom-ratio-actions";

    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "secondary-button";
    upButton.textContent = "↑";
    upButton.title = `Move ${preset.label} up`;
    upButton.dataset.action = "move-up";
    upButton.dataset.presetId = preset.id;
    upButton.disabled = index === 0;

    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "secondary-button";
    downButton.textContent = "↓";
    downButton.title = `Move ${preset.label} down`;
    downButton.dataset.action = "move-down";
    downButton.dataset.presetId = preset.id;
    downButton.disabled = index === presets.length - 1;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "Delete";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.presetId = preset.id;

    actions.append(upButton, downButton, deleteButton);
    row.append(selectButton, actions);
    fragment.append(row);
  }

  customRatioList.append(fragment);
}

function setRatioFormValues(dimensions: { width: number; height: number }): void {
  ratioWidthInput.value = String(dimensions.width);
  ratioHeightInput.value = String(dimensions.height);
}

function customAspectPresets(): AspectPreset[] {
  return state.aspectPresets.filter((preset) => !preset.builtIn);
}

function fallbackAspectPresetIdAfterDelete(deletedIndex: number): string {
  const remainingCustomPresets = customAspectPresets();
  if (remainingCustomPresets.length === 0) {
    return initialAspectPresetId(state.aspectPresets);
  }

  const fallbackIndex = clamp(deletedIndex, 0, remainingCustomPresets.length - 1);
  return remainingCustomPresets[fallbackIndex]?.id ?? initialAspectPresetId(state.aspectPresets);
}

async function loadImageFromFile(file: File): Promise<void> {
  ensureSupportedFileInput(file);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  ensureNonAnimatedImage(bytes, imageExtension(file.name));
  const image = await decodeImage(bytes);

  applyLoadedImage(image, file.name, { kind: "memory", bytes });
}

async function loadImageFromPath(path: string): Promise<void> {
  if (!isTauriRuntime) {
    throw new Error("Loading image paths requires the desktop app runtime.");
  }

  ensureSupportedPath(path);
  const bytes = await runtime.readImageBytes(path);
  ensureNonAnimatedImage(bytes, imageExtension(path));
  const image = await decodeImage(bytes);

  applyLoadedImage(image, fileNameFromPath(path), { kind: "path", path });
}

function applyLoadedImage(
  image: HTMLImageElement,
  imageName: string,
  imageSource: LoadedImageSource
): void {
  state.image = image;
  state.imageName = imageName;
  state.imageSource = imageSource;
  updateAfterLoad();
}

function updateAfterLoad(): void {
  resetCropToLargest();
  state.drag = null;
  clearPreview();
  previewButton.disabled = false;
  saveButton.disabled = false;
  dropHint.classList.add("hidden");
  editorZoom.setImage(state.image!.naturalWidth, state.image!.naturalHeight, true);
  previewZoom.setImage(0, 0, true);
  updateMetaLabels();
}

async function decodeImage(bytes: Uint8Array): Promise<HTMLImageElement> {
  const blob = new Blob([toArrayBuffer(bytes)]);
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unsupported or broken image file."));
      element.src = url;
    });

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function onPointerDown(event: PointerEvent): void {
  if (!state.crop || !state.imageRect || !state.image) {
    return;
  }

  const point = getCanvasPoint(event);
  const cropInCanvas = imageRectToCanvasRect(state.crop);
  const handle = pickHandle(point, cropInCanvas);

  if (!handle && !pointInRect(point, cropInCanvas)) {
    return;
  }

  state.drag = {
    mode: handle ? "resize" : "move",
    pointerId: event.pointerId,
    startPoint: point,
    startCrop: { ...state.crop },
    handle: handle ?? undefined
  };

  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  if (!state.crop || !state.imageRect || !state.image) {
    canvas.style.cursor = "default";
    return;
  }

  const point = getCanvasPoint(event);
  const cropInCanvas = imageRectToCanvasRect(state.crop);
  const hoverHandle = pickHandle(point, cropInCanvas);

  if (!state.drag) {
    canvas.style.cursor = pointerCursor(hoverHandle, pointInRect(point, cropInCanvas));
    return;
  }

  if (state.drag.pointerId !== event.pointerId) {
    return;
  }

  const scale = getCanvasScale();
  const dx = (point.x - state.drag.startPoint.x) / scale;
  const dy = (point.y - state.drag.startPoint.y) / scale;

  const imageWidth = state.image.naturalWidth;
  const imageHeight = state.image.naturalHeight;

  if (state.drag.mode === "move") {
    state.crop = moveCrop(state.drag.startCrop, dx, dy, imageWidth, imageHeight);
  } else if (state.drag.handle) {
    state.crop = resizeCrop(
      state.drag.startCrop,
      state.drag.handle,
      dx,
      dy,
      imageWidth,
      imageHeight,
      state.aspect,
      state.aspectPresets
    );
  }

  renderCropState();
}

function onPointerUp(event: PointerEvent): void {
  if (!state.drag || state.drag.pointerId !== event.pointerId) {
    return;
  }

  state.drag = null;
  canvas.releasePointerCapture(event.pointerId);
  canvas.style.cursor = "default";
}

function onCanvasWheel(event: WheelEvent): void {
  if (!state.image || !state.crop) {
    return;
  }

  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.03 : 0.97;
  state.crop = scaleCropFromCenter(
    state.crop,
    factor,
    state.image.naturalWidth,
    state.image.naturalHeight,
    state.aspect,
    state.aspectPresets
  );
  renderCropState();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && modalController.handleEscape()) {
    return;
  }

  if (modalController.isPreviewOpen() || modalController.isRatioOpen()) return;

  if (!state.image || !state.crop) {
    return;
  }

  if (isEditableTarget(event.target)) {
    return;
  }

  const step = event.shiftKey ? 10 : 1;
  const imageWidth = state.image.naturalWidth;
  const imageHeight = state.image.naturalHeight;

  switch (event.key) {
    case "ArrowLeft":
      event.preventDefault();
      state.crop = moveCrop(state.crop, -step, 0, imageWidth, imageHeight);
      break;
    case "ArrowRight":
      event.preventDefault();
      state.crop = moveCrop(state.crop, step, 0, imageWidth, imageHeight);
      break;
    case "ArrowUp":
      event.preventDefault();
      state.crop = moveCrop(state.crop, 0, -step, imageWidth, imageHeight);
      break;
    case "ArrowDown":
      event.preventDefault();
      state.crop = moveCrop(state.crop, 0, step, imageWidth, imageHeight);
      break;
    case "+":
    case "=":
      event.preventDefault();
      state.crop = scaleCropFromCenter(
        state.crop,
        1.04,
        imageWidth,
        imageHeight,
        state.aspect,
        state.aspectPresets
      );
      break;
    case "-":
    case "_":
      event.preventDefault();
      state.crop = scaleCropFromCenter(
        state.crop,
        0.96,
        imageWidth,
        imageHeight,
        state.aspect,
        state.aspectPresets
      );
      break;
    default:
      return;
  }

  renderCropState();
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  render();
}

function render(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  ctx.clearRect(0, 0, width, height);

  if (!state.image) {
    state.imageRect = null;
    return;
  }

  const imageRect = state.imageRect;
  if (!imageRect) return;

  ctx.drawImage(state.image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);

  if (!state.crop) {
    return;
  }

  const cropRect = imageRectToCanvasRect(state.crop);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
  ctx.fill("evenodd");
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 2;
  ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  drawHandles(cropRect);
  ctx.restore();
}

function drawHandles(cropRect: Rect): void {
  const half = HANDLE_SIZE / 2;
  const points = handlePoints(cropRect);

  ctx.fillStyle = "#0f766e";
  for (const point of Object.values(points)) {
    ctx.fillRect(point.x - half, point.y - half, HANDLE_SIZE, HANDLE_SIZE);
  }
}

function handlePoints(rect: Rect): Record<Handle, Point> {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return {
    n: { x: centerX, y: rect.y },
    s: { x: centerX, y: rect.y + rect.height },
    e: { x: rect.x + rect.width, y: centerY },
    w: { x: rect.x, y: centerY },
    nw: { x: rect.x, y: rect.y },
    ne: { x: rect.x + rect.width, y: rect.y },
    sw: { x: rect.x, y: rect.y + rect.height },
    se: { x: rect.x + rect.width, y: rect.y + rect.height }
  };
}

function pickHandle(point: Point, rect: Rect): Handle | null {
  const half = HANDLE_SIZE / 2;
  const points = handlePoints(rect);

  for (const [handle, target] of Object.entries(points) as [Handle, Point][]) {
    if (
      point.x >= target.x - half &&
      point.x <= target.x + half &&
      point.y >= target.y - half &&
      point.y <= target.y + half
    ) {
      return handle;
    }
  }

  return null;
}

function pointerCursor(handle: Handle | null, insideRect: boolean): string {
  if (handle === "n" || handle === "s") {
    return "ns-resize";
  }

  if (handle === "e" || handle === "w") {
    return "ew-resize";
  }

  if (handle === "nw" || handle === "se") {
    return "nwse-resize";
  }

  if (handle === "ne" || handle === "sw") {
    return "nesw-resize";
  }

  if (insideRect) {
    return "move";
  }

  return "default";
}

function getCanvasPoint(event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function getCanvasScale(): number {
  if (!state.imageRect || !state.image) {
    return 1;
  }

  return state.imageRect.width / state.image.naturalWidth;
}

function imageRectToCanvasRect(rect: Rect): Rect {
  if (!state.imageRect || !state.image) {
    return rect;
  }

  const scale = state.imageRect.width / state.image.naturalWidth;

  return sourceToView(rect, state.imageRect, scale);
}

function resetCropToLargest(): void {
  if (!state.image) {
    state.crop = null;
    return;
  }

  state.crop = largestCropRect(
    state.image.naturalWidth,
    state.image.naturalHeight,
    state.aspect,
    state.aspectPresets
  );
}

function updateMetaLabels(): void {
  if (!state.image || !state.crop) {
    imageSizeText.textContent = "Image: -";
    cropSizeText.textContent = "Crop: -";
    syncCropDimensionInputs();
    return;
  }

  const roundedCrop = roundedOutputCrop();
  imageSizeText.textContent = `Image: ${state.image.naturalWidth} x ${state.image.naturalHeight}`;
  cropSizeText.textContent = `Crop: ${roundedCrop.width} x ${roundedCrop.height}`;
  syncCropDimensionInputs(roundedCrop);
}

function roundedOutputCrop(): OutputCrop {
  if (!state.image || !state.crop) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const x = clamp(Math.round(state.crop.x), 0, state.image.naturalWidth - 1);
  const y = clamp(Math.round(state.crop.y), 0, state.image.naturalHeight - 1);
  const width = clamp(Math.round(state.crop.width), 1, state.image.naturalWidth - x);
  const height = clamp(Math.round(state.crop.height), 1, state.image.naturalHeight - y);

  return { x, y, width, height };
}

async function makePreviewUrl(): Promise<string> {
  const bytes = await makeImageBytes("png");
  const blob = new Blob([toArrayBuffer(bytes)], { type: "image/png" });
  return URL.createObjectURL(blob);
}

function clearPreview(): void {
  modalController.closePreview();
  previewImage.removeAttribute("src");

  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
}

function renderCroppedCanvas(): HTMLCanvasElement {
  if (!state.image || !state.crop) {
    throw new Error("No image loaded.");
  }

  const crop = roundedOutputCrop();
  const buffer = document.createElement("canvas");
  buffer.width = crop.width;
  buffer.height = crop.height;

  const bufferContext = buffer.getContext("2d");
  if (!bufferContext) {
    throw new Error("2D context unavailable for export.");
  }

  bufferContext.drawImage(
    state.image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  return buffer;
}

async function makeImageBytes(format: OutputFormat): Promise<Uint8Array> {
  if (!isBrowserEncodedFormat(format)) {
    throw new Error(`${outputFormatLabel(format)} export requires the desktop app runtime.`);
  }

  const buffer = renderCroppedCanvas();
  const options = browserEncodingOptions(format);

  const blob = await new Promise<Blob>((resolve, reject) => {
    buffer.toBlob((result) => {
      if (!result) {
        reject(new Error(`Failed to create ${outputFormatLabel(format)} image.`));
        return;
      }

      if (result.type !== options.mimeType) {
        reject(new Error(`${outputFormatLabel(format)} export is unavailable in this runtime.`));
        return;
      }

      resolve(result);
    }, options.mimeType, options.quality);
  });

  return new Uint8Array(await blob.arrayBuffer());
}

function previewCropDimensionInput(changedDimension: "width" | "height"): void {
  if (isSyncingCropDimensionInputs || !state.image || !state.crop) {
    return;
  }

  const rawValue = changedDimension === "width" ? cropWidthInput.value : cropHeightInput.value;
  const parsedValue = parseIntegerInput(rawValue);
  if (!parsedValue) {
    return;
  }

  const pairedValue =
    changedDimension === "width"
      ? Math.max(1, Math.round(parsedValue / state.aspect))
      : Math.max(1, Math.round(parsedValue * state.aspect));

  isSyncingCropDimensionInputs = true;
  if (changedDimension === "width") {
    cropHeightInput.value = String(pairedValue);
  } else {
    cropWidthInput.value = String(pairedValue);
  }
  isSyncingCropDimensionInputs = false;
}

function commitCropDimensionInput(changedDimension: "width" | "height"): void {
  if (isSyncingCropDimensionInputs || !state.image || !state.crop) {
    return;
  }

  const rawValue = changedDimension === "width" ? cropWidthInput.value : cropHeightInput.value;
  const parsedValue = parseIntegerInput(rawValue);
  if (!parsedValue) {
    syncCropDimensionInputs();
    return;
  }

  const targetWidth = changedDimension === "width" ? parsedValue : parsedValue * state.aspect;
  const targetHeight = changedDimension === "height" ? parsedValue : parsedValue / state.aspect;
  resizeCropToDimensions(targetWidth, targetHeight);
}

function resizeCropToDimensions(targetWidth: number, targetHeight: number): void {
  if (!state.image || !state.crop) {
    return;
  }

  const imageWidth = state.image.naturalWidth;
  const imageHeight = state.image.naturalHeight;
  const centerX = state.crop.x + state.crop.width / 2;
  const centerY = state.crop.y + state.crop.height / 2;
  const largest = largestCropRect(imageWidth, imageHeight, state.aspect, state.aspectPresets);
  const { minWidth, minHeight } = minCropSize(
    state.aspect,
    imageWidth,
    imageHeight,
    state.aspectPresets
  );

  const requestedWidth = Math.max(targetWidth, targetHeight * state.aspect);
  let width = clamp(requestedWidth, minWidth, largest.width);
  let height = width / state.aspect;

  if (height < minHeight) {
    height = minHeight;
    width = height * state.aspect;
  }

  if (height > largest.height) {
    height = largest.height;
    width = height * state.aspect;
  }

  const x = clamp(centerX - width / 2, 0, imageWidth - width);
  const y = clamp(centerY - height / 2, 0, imageHeight - height);

  state.crop = { x, y, width, height };
  renderCropState();
}

function renderCropState(): void {
  render();
  updateMetaLabels();
}

function syncCropDimensionInputs(roundedCrop?: Rect): void {
  isSyncingCropDimensionInputs = true;

  if (!state.image || !state.crop) {
    cropWidthInput.disabled = true;
    cropHeightInput.disabled = true;
    cropWidthInput.value = "";
    cropHeightInput.value = "";
    isSyncingCropDimensionInputs = false;
    return;
  }

  const crop = roundedCrop ?? roundedOutputCrop();
  cropWidthInput.disabled = false;
  cropHeightInput.disabled = false;
  cropWidthInput.value = String(crop.width);
  cropHeightInput.value = String(crop.height);
  isSyncingCropDimensionInputs = false;
}

function setStatus(message: string, isError = false): void {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function get2dContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = target.getContext("2d");
  if (!context) {
    throw new Error("2D context not available.");
  }
  return context;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function selectedAspectPreset(): AspectPreset {
  return storedAspectPresetById(state.selectedAspectId) ?? state.aspectPresets[0] ?? BUILT_IN_ASPECT_PRESETS[0];
}

function aspectValueFromPresetId(presetId: string, presets: AspectPreset[]): number {
  const preset = presets.find((candidate) => candidate.id === presetId) ?? presets[0];
  return preset ? preset.width / preset.height : 1;
}

function storedAspectPresetById(presetId: string): AspectPreset | null {
  return state.aspectPresets.find((preset) => preset.id === presetId) ?? null;
}

function syncAspectChange(): void {
  syncAspectUi();

  if (!state.image || !state.crop) {
    return;
  }

  state.crop = recalcCropForAspect(
    state.crop,
    state.aspect,
    state.image.naturalWidth,
    state.image.naturalHeight,
    state.aspectPresets
  );
  renderCropState();
}

function syncAspectUi(): void {
  const preset = selectedAspectPreset();
  state.selectedAspectId = preset.id;
  state.aspect = effectiveAspectValue(preset);
  persistSelectedAspectPresetId(preset.id);
  renderAspectOptions();
  renderCustomAspectList();
  syncSwapRatioButton(preset);
}

function onCustomRatioListClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button[data-action][data-preset-id]");
  if (!button || button.disabled) {
    return;
  }

  const presetId = button.dataset.presetId;
  const action = button.dataset.action;
  if (!presetId || !action) {
    return;
  }

  if (action === "select") {
    applyAspectPreset(presetId);
    setRatioFormValues(selectedAspectPreset());
    clearRatioFormError();
    return;
  }

  if (action === "move-up") {
    moveCustomAspectPreset(presetId, -1);
    return;
  }

  if (action === "move-down") {
    moveCustomAspectPreset(presetId, 1);
    return;
  }

  if (action === "delete") {
    deleteCustomAspectPreset(presetId);
  }
}

function currentAspectDimensions(): { width: number; height: number } {
  const preset = selectedAspectPreset();
  if (!state.isAspectSwapped || preset.width === preset.height) {
    return { width: preset.width, height: preset.height };
  }

  return { width: preset.height, height: preset.width };
}

function effectiveAspectValue(preset: AspectPreset): number {
  const dimensions = currentAspectDimensionsForPreset(preset);
  return dimensions.width / dimensions.height;
}

function currentAspectDimensionsForPreset(preset: AspectPreset): { width: number; height: number } {
  if (!state.isAspectSwapped || preset.width === preset.height) {
    return { width: preset.width, height: preset.height };
  }

  return { width: preset.height, height: preset.width };
}

function landscapeAspectDimensions(preset: AspectPreset): { width: number; height: number } {
  return preset.width >= preset.height
    ? { width: preset.width, height: preset.height }
    : { width: preset.height, height: preset.width };
}

function portraitAspectDimensions(preset: AspectPreset): { width: number; height: number } {
  const landscape = landscapeAspectDimensions(preset);
  return { width: landscape.height, height: landscape.width };
}

function baseAspectOrientation(preset: AspectPreset): "landscape" | "portrait" {
  return preset.width >= preset.height ? "landscape" : "portrait";
}

function initialAspectPresetId(presets: AspectPreset[]): string {
  return presets.find((preset) => preset.id === DEFAULT_ASPECT_PRESET_ID)?.id ?? presets[0]?.id ?? "1:1";
}

function mergeAspectPresets(basePresets: AspectPreset[], extraPresets: AspectPreset[]): AspectPreset[] {
  const merged = new Map<string, AspectPreset>();

  for (const preset of [...basePresets, ...extraPresets]) {
    if (!merged.has(preset.id)) {
      merged.set(preset.id, preset);
    }
  }

  return Array.from(merged.values());
}

function loadSelectedAspectPresetId(presets: AspectPreset[]): string {
  const storedId = loadStorageValue(SELECTED_ASPECT_STORAGE_KEY, LEGACY_SELECTED_ASPECT_STORAGE_KEY);
  if (!storedId) {
    return initialAspectPresetId(presets);
  }

  return presets.some((preset) => preset.id === storedId) ? storedId : initialAspectPresetId(presets);
}

function loadCustomAspectPresets(): AspectPreset[] {
  const raw = loadStorageValue(CUSTOM_ASPECT_STORAGE_KEY, LEGACY_CUSTOM_ASPECT_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const customPresets: AspectPreset[] = [];
    for (const entry of parsed) {
      if (!isAspectPresetRecord(entry)) {
        continue;
      }

      const width = parseIntegerInput(String(entry.width));
      const height = parseIntegerInput(String(entry.height));
      if (!width || !height) {
        continue;
      }

      const reduced = reduceRatio(width, height);
      const id = `${reduced.width}:${reduced.height}`;
      customPresets.push({
        id,
        label: id,
        width: reduced.width,
        height: reduced.height,
        builtIn: false
      });
    }

    return customPresets;
  } catch {
    return [];
  }
}

function persistCustomAspectPresets(): void {
  const customPresets = state.aspectPresets
    .filter((preset) => !preset.builtIn)
    .map((preset) => ({
      id: preset.id,
      label: preset.label,
      width: preset.width,
      height: preset.height,
      builtIn: false
    }));

  localStorage.setItem(CUSTOM_ASPECT_STORAGE_KEY, JSON.stringify(customPresets));
}

function persistSelectedAspectPresetId(presetId: string): void {
  localStorage.setItem(SELECTED_ASPECT_STORAGE_KEY, presetId);
}

function loadWindowBounds(): WindowBounds | null {
  const raw = loadStorageValue(WINDOW_BOUNDS_STORAGE_KEY, LEGACY_WINDOW_BOUNDS_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as WindowBounds).x !== "number" ||
      typeof (parsed as WindowBounds).y !== "number" ||
      typeof (parsed as WindowBounds).width !== "number" ||
      typeof (parsed as WindowBounds).height !== "number"
    ) {
      return null;
    }

    const bounds = parsed as WindowBounds;
    if (bounds.width < MIN_WINDOW_WIDTH || bounds.height < MIN_WINDOW_HEIGHT) {
      return null;
    }

    return bounds;
  } catch {
    return null;
  }
}

function persistWindowBounds(bounds: WindowBounds): void {
  localStorage.setItem(WINDOW_BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
}

function loadStorageValue(key: string, legacyKey: string): string | null {
  const currentValue = localStorage.getItem(key);
  if (currentValue !== null) {
    return currentValue;
  }

  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue === null) {
    return null;
  }

  localStorage.setItem(key, legacyValue);
  localStorage.removeItem(legacyKey);
  return legacyValue;
}

async function restoreWindowBounds(): Promise<void> {
  const bounds = loadWindowBounds();
  if (!bounds) {
    return;
  }

  try {
    await runtime.restoreWindowBounds(bounds);
  } catch (error) {
    console.warn("Failed to restore window bounds.", error);
  }
}

function scheduleWindowBoundsPersist(): void {
  if (!isTauriRuntime) {
    return;
  }

  if (windowBoundsSaveTimer !== null) {
    window.clearTimeout(windowBoundsSaveTimer);
  }

  windowBoundsSaveTimer = window.setTimeout(() => {
    windowBoundsSaveTimer = null;
    void persistCurrentWindowBounds();
  }, WINDOW_BOUNDS_SAVE_DELAY_MS);
}

async function persistCurrentWindowBounds(): Promise<void> {
  const bounds = await currentWindowBounds();
  if (!bounds) {
    return;
  }

  persistWindowBounds(bounds);
}

async function currentWindowBounds(): Promise<WindowBounds | null> {
  try {
    return await runtime.currentWindowBounds(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
  } catch (error) {
    console.warn("Failed to read current window bounds.", error);
    return null;
  }
}

async function saveCroppedImage(): Promise<void> {
  if (!state.image || !state.crop) {
    return;
  }

  const outputFormat = resolvedOutputFormat();
  const defaultName = buildDefaultFileName(state.imageName || "cropped", outputFormat);
  const crop = roundedOutputCrop();
  const source = state.imageSource;
  const initialFolder = isTauriRuntime ? await resolveSaveFolder(
    loadSaveFolderSettings(),
    source?.kind === "path" ? source.path : null,
    (path) => runtime.isSaveFolderAvailable(path)
  ) : undefined;
  let result: SaveResult;

  if (isTauriRuntime && source?.kind === "path") {
    result = await runtime.saveCroppedImageFromPath(
      source.path,
      defaultName,
      crop,
      outputFormat,
      initialFolder
    );
  } else if (isTauriRuntime && source?.kind === "memory") {
    result = await runtime.saveCroppedImageFromBytes(
      source.bytes,
      defaultName,
      crop,
      outputFormat,
      initialFolder
    );
  } else {
    const bytes = await makeImageBytes(outputFormat);
    result = await runtime.saveImage(defaultName, bytes, outputFormat, initialFolder);
  }

  applySaveResult(result);
}

function applySaveResult(result: SaveResult): void {
  recordSuccessfulSave(result);
  if (result.kind === "saved") {
    setStatus(`Saved: ${result.location}`);
    return;
  }

  if (result.kind === "downloaded") {
    setStatus(`Downloaded ${result.location}.`);
  }
}

function syncSaveFolderSettings(): void {
  const settings = loadSaveFolderSettings();
  saveFolderSettings.disabled = !isTauriRuntime;
  for (const input of saveFolderSettings.querySelectorAll<HTMLInputElement>('input[name="save-folder-mode"]')) {
    input.checked = input.value === settings.mode;
  }
  const disabled = !isTauriRuntime || settings.mode !== "custom";
  customSaveFolder.value = settings.customFolder ?? "";
  customSaveFolder.title = settings.customFolder ?? "フォルダ未指定";
  customSaveFolder.disabled = disabled;
  changeSaveFolder.disabled = disabled;
  must<HTMLElement>("#custom-save-folder-row").classList.toggle("is-disabled", disabled);
  saveFolderHelp.textContent = isTauriRuntime
    ? "保存ダイアログで別のフォルダへ変更することもできます。"
    : "この設定はデスクトップ版で利用できます。ブラウザ版の保存先はブラウザの設定に従います。";
}

function isAspectPresetRecord(value: unknown): value is Partial<AspectPreset> {
  return typeof value === "object" && value !== null;
}

function parseIntegerInput(rawValue: string): number | null {
  if (!/^\d+$/.test(rawValue.trim())) {
    return null;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function reduceRatio(width: number, height: number): { width: number; height: number } {
  const divisor = greatestCommonDivisor(width, height);
  return {
    width: width / divisor,
    height: height / divisor
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }

  return Math.max(1, a);
}

function setRatioFormError(message: string): void {
  ratioFormError.textContent = message;
  ratioFormError.classList.remove("hidden");
}

function clearRatioFormError(): void {
  ratioFormError.textContent = "";
  ratioFormError.classList.add("hidden");
}

function ensureSupportedFileInput(file: File): void {
  const mimeOk = !file.type || file.type.startsWith("image/");
  const extension = imageExtension(file.name);
  const extensionOk = extension ? SUPPORTED_IMAGE_EXTENSIONS.has(extension) : false;

  if (!mimeOk || !extensionOk) {
    throw new Error("Unsupported file format. Use PNG/JPEG/WEBP/GIF/BMP.");
  }
}

function ensureSupportedPath(path: string): void {
  const extension = imageExtension(path);
  if (!extension || !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported file format. Use PNG/JPEG/WEBP/GIF/BMP.");
  }
}

function imageExtension(pathLike: string): string | null {
  const fileName = fileNameFromPath(pathLike);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return null;
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/g);
  return parts[parts.length - 1] || "image";
}

function syncOutputFormatSelect(): void {
  outputFormatSelect.value = state.outputFormatChoice;
}

function resolvedOutputFormat(): OutputFormat {
  return resolveOutputFormatChoice(state.outputFormatChoice, imageExtension(state.imageName));
}

function buildDefaultFileName(originalName: string, format: OutputFormat): string {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${base}_crop.${preferredOutputExtension(format)}`;
}

function asMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  return typeof value === "string" ? value : "Unknown error.";
}

function supportedUniquePaths(paths: string[]): string[] {
  const uniquePaths = new Map<string, string>();

  for (const path of paths) {
    if (!path) {
      continue;
    }

    const normalizedPath = normalizePath(path);
    if (uniquePaths.has(normalizedPath)) {
      continue;
    }

    const extension = imageExtension(path);
    if (!extension || !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }

    uniquePaths.set(normalizedPath, path);
  }

  return Array.from(uniquePaths.values());
}

function confirmLargeImageBatch(count: number, source: PathBatchSource): boolean {
  if (count <= MULTI_IMAGE_CONFIRM_THRESHOLD) {
    return true;
  }

  const action = source === "drop" ? "drop" : "open";
  return window.confirm(
    `${count} images will be loaded. Each image opens in its own window. Continue with this ${action}?`
  );
}

function shouldReuseCurrentWindow(pathCount: number): boolean {
  return pathCount === 1 || !state.image;
}

function buildBatchStatusMessage(
  currentPath: string | null,
  extraWindowCount: number,
  source: PathBatchSource,
  reusedCurrentWindow: boolean
): string {
  if (currentPath && extraWindowCount === 0) {
    return `Loaded ${fileNameFromPath(currentPath)}.`;
  }

  if (currentPath) {
    return `Loaded ${fileNameFromPath(currentPath)}. Opened ${extraWindowCount} additional window(s).`;
  }

  const action = source === "drop" ? "drop" : "selection";
  if (!reusedCurrentWindow) {
    return `Opened ${extraWindowCount} new window(s) from the ${action}. Current window was left as-is.`;
  }

  return `Opened ${extraWindowCount} new window(s).`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
