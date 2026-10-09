import type { OutputFormatChoice, WebpCompressionPreset } from "./appTypes";
import { parseOutputFormatChoice } from "./outputFormat";
import { parseSaveFolderMode, parentFolder, type SaveFolderMode, type SaveFolderSettings } from "./saveFolder";
import type { SaveResult } from "./runtimeBridge";
import type { Language } from "./messages";

export const LANGUAGE_STORAGE_KEY = "aspect-crop.language";

export function loadLanguage(): Language | null {
  const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return value === "ja" || value === "en" ? value : null;
}

export function persistLanguage(language: Language): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

const OUTPUT_FORMAT_STORAGE_KEY = "aspect-crop.output-format";
const SAVE_FOLDER_MODE_KEY = "aspect-crop.save-folder-mode";
const CUSTOM_SAVE_FOLDER_KEY = "aspect-crop.custom-save-folder";
const LAST_SAVE_FOLDER_KEY = "aspect-crop.last-save-folder";

export function loadSaveFolderSettings(): SaveFolderSettings {
  return {
    mode: parseSaveFolderMode(localStorage.getItem(SAVE_FOLDER_MODE_KEY)),
    customFolder: localStorage.getItem(CUSTOM_SAVE_FOLDER_KEY) || null,
    lastFolder: localStorage.getItem(LAST_SAVE_FOLDER_KEY) || null
  };
}

export function persistSaveFolderMode(mode: SaveFolderMode): void {
  localStorage.setItem(SAVE_FOLDER_MODE_KEY, mode);
}

export function persistCustomSaveFolder(path: string): void {
  localStorage.setItem(CUSTOM_SAVE_FOLDER_KEY, path);
}

export function recordSuccessfulSave(result: SaveResult): void {
  if (result.kind !== "saved") return;
  const folder = parentFolder(result.location);
  if (folder) localStorage.setItem(LAST_SAVE_FOLDER_KEY, folder);
}

export function loadOutputFormatChoice(): OutputFormatChoice {
  return parseOutputFormatChoice(localStorage.getItem(OUTPUT_FORMAT_STORAGE_KEY)) ?? "same";
}

export function persistOutputFormatChoice(choice: OutputFormatChoice): void {
  localStorage.setItem(OUTPUT_FORMAT_STORAGE_KEY, choice);
}

const WEBP_COMPRESSION_KEY = "aspect-crop.webp-compression-preset";
export function loadWebpCompression(): WebpCompressionPreset {
  return parseWebpCompression(localStorage.getItem(WEBP_COMPRESSION_KEY));
}
export function parseWebpCompression(value: string | null): WebpCompressionPreset {
  return value === "fast" || value === "smallest" ? value : "balanced";
}
export function persistWebpCompression(preset: WebpCompressionPreset): void {
  localStorage.setItem(WEBP_COMPRESSION_KEY, preset);
}
