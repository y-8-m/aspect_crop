import { t, LocalizedError } from "./i18n";
import { invoke } from "@tauri-apps/api/tauri";
import { saveDefaultPath } from "./saveFolder";

import type { OutputCrop, OutputFormat, WindowBounds, WebpCompressionPreset } from "./appTypes";
import {
  mimeTypeForFormat,
  outputFormatExtensions,
  outputFormatLabel,
  preferredOutputExtension
} from "./outputFormat";

type TauriDialogApi = typeof import("@tauri-apps/api/dialog");
type TauriWindowApi = typeof import("@tauri-apps/api/window");

export type NativeFileDropPayload =
  | { type: "hover"; paths: string[] }
  | { type: "cancel"; paths: string[] }
  | { type: "drop"; paths: string[] };

export type SaveResult =
  | { kind: "saved"; location: string }
  | { kind: "downloaded"; location: string }
  | { kind: "cancelled" };

export type RuntimeBridge = {
  kind: "tauri" | "web";
  getWindowLabel(): Promise<string>;
  openImageDialog(extensions: string[]): Promise<string[]>;
  readImageBytes(path: string): Promise<Uint8Array>;
  readBatchPreview(path: string): Promise<Uint8Array>;
  openImageWindows(paths: string[], templateBounds: WindowBounds | null): Promise<void>;
  takeStartupPath(): Promise<string | null>;
  openFolderDialog(defaultPath?: string, title?: string): Promise<string | null>;
  isSaveFolderAvailable(path: string): Promise<boolean>;
  saveImage(defaultName: string, bytes: Uint8Array, format: OutputFormat, initialFolder?: string): Promise<SaveResult>;
  saveCroppedImageFromPath(
    sourcePath: string,
    defaultName: string,
    crop: OutputCrop,
    format: OutputFormat,
    initialFolder?: string,
    webpCompression?: WebpCompressionPreset
  ): Promise<SaveResult>;
  saveCroppedImageFromBytes(
    sourceBytes: Uint8Array,
    defaultName: string,
    crop: OutputCrop,
    format: OutputFormat,
    initialFolder?: string,
    webpCompression?: WebpCompressionPreset
  ): Promise<SaveResult>;
  restoreWindowBounds(bounds: WindowBounds): Promise<void>;
  onWindowBoundsChanged(listener: () => void): Promise<void>;
  currentWindowBounds(minWidth: number, minHeight: number): Promise<WindowBounds | null>;
  onNativeFileDrop(listener: (payload: NativeFileDropPayload) => void): Promise<void>;
};

let tauriDialogApiPromise: Promise<TauriDialogApi> | null = null;
let tauriWindowApiPromise: Promise<TauriWindowApi> | null = null;

export function createRuntimeBridge(): RuntimeBridge {
  return detectTauriRuntime() ? createTauriRuntimeBridge() : createWebRuntimeBridge();
}

function createTauriRuntimeBridge(): RuntimeBridge {
  return {
    kind: "tauri",
    async getWindowLabel(): Promise<string> {
      const { appWindow } = await getTauriWindowApi();
      return appWindow.label;
    },
    async openImageDialog(extensions: string[]): Promise<string[]> {
      const { open } = await getTauriDialogApi();
      const selection = await open({
        title: t("open"),
        multiple: true,
        filters: [{ name: t("images"), extensions }]
      });

      if (!selection) {
        return [];
      }

      return Array.isArray(selection) ? selection : [selection];
    },
    async readBatchPreview(path: string): Promise<Uint8Array> {
      return base64ToBytes(await invoke<string>("read_batch_preview", { path }));
    },
    async readImageBytes(path: string): Promise<Uint8Array> {
      const base64 = await invoke<string>("read_image_file", { path });
      return base64ToBytes(base64);
    },
    async openImageWindows(paths: string[], templateBounds: WindowBounds | null): Promise<void> {
      await invoke("open_image_windows", {
        paths,
        templateBounds
      });
    },
    async takeStartupPath(): Promise<string | null> {
      const windowLabel = await this.getWindowLabel();
      return invoke<string | null>("take_window_file_path", { windowLabel });
    },
    async openFolderDialog(defaultPath?: string, title?: string): Promise<string | null> {
      const { open } = await getTauriDialogApi();
      const selection = await open({ directory: true, multiple: false, defaultPath, title: title ?? t("saveFolder") });
      return typeof selection === "string" ? selection : null;
    },
    async isSaveFolderAvailable(path: string): Promise<boolean> {
      return invoke<boolean>("is_save_folder_available", { path });
    },
    async saveImage(defaultName: string, bytes: Uint8Array, format: OutputFormat, initialFolder?: string): Promise<SaveResult> {
      const { save } = await getTauriDialogApi();
      const savePath = await save(saveDialogOptions(defaultName, format, initialFolder));

      if (!savePath) {
        return { kind: "cancelled" };
      }

      const resolvedPath = normalizeSavePath(savePath, format);

      await invoke("save_image_file", {
        path: resolvedPath,
        imageBase64: bytesToBase64(bytes)
      });

      return { kind: "saved", location: resolvedPath };
    },
    async saveCroppedImageFromPath(
      sourcePath: string,
      defaultName: string,
      crop: OutputCrop,
      format: OutputFormat,
      initialFolder?: string,
      webpCompression: WebpCompressionPreset = "balanced"
    ): Promise<SaveResult> {
      const { save } = await getTauriDialogApi();
      const savePath = await save(saveDialogOptions(defaultName, format, initialFolder));

      if (!savePath) {
        return { kind: "cancelled" };
      }

      const resolvedPath = normalizeSavePath(savePath, format);

      await invoke("crop_image_to_file", {
        sourcePath,
        outputPath: resolvedPath,
        crop,
        webpCompression: webpCompression ?? "balanced",
        format
      });

      return { kind: "saved", location: resolvedPath };
    },
    async saveCroppedImageFromBytes(
      sourceBytes: Uint8Array,
      defaultName: string,
      crop: OutputCrop,
      format: OutputFormat,
      initialFolder?: string,
      webpCompression: WebpCompressionPreset = "balanced"
    ): Promise<SaveResult> {
      const { save } = await getTauriDialogApi();
      const savePath = await save(saveDialogOptions(defaultName, format, initialFolder));

      if (!savePath) {
        return { kind: "cancelled" };
      }

      const resolvedPath = normalizeSavePath(savePath, format);

      await invoke("crop_image_data_to_file", {
        sourceBase64: bytesToBase64(sourceBytes),
        outputPath: resolvedPath,
        crop,
        webpCompression: webpCompression ?? "balanced",
        format
      });

      return { kind: "saved", location: resolvedPath };
    },
    async restoreWindowBounds(bounds: WindowBounds): Promise<void> {
      const { appWindow, PhysicalPosition, PhysicalSize } = await getTauriWindowApi();
      await appWindow.setSize(new PhysicalSize(bounds.width, bounds.height));
      await appWindow.setPosition(new PhysicalPosition(bounds.x, bounds.y));
    },
    async onWindowBoundsChanged(listener: () => void): Promise<void> {
      const { appWindow } = await getTauriWindowApi();
      await appWindow.onMoved(listener);
      await appWindow.onResized(listener);
    },
    async currentWindowBounds(minWidth: number, minHeight: number): Promise<WindowBounds | null> {
      const { appWindow } = await getTauriWindowApi();

      if (await appWindow.isMaximized()) {
        return null;
      }

      const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.innerSize()]);
      if (size.width < minWidth || size.height < minHeight) {
        return null;
      }

      return {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height
      };
    },
    async onNativeFileDrop(listener: (payload: NativeFileDropPayload) => void): Promise<void> {
      const { appWindow } = await getTauriWindowApi();
      await appWindow.onFileDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "hover" || payload.type === "cancel") {
          listener({ type: payload.type, paths: [] });
          return;
        }

        listener({ type: "drop", paths: payload.paths });
      });
    }
  };
}

function createWebRuntimeBridge(): RuntimeBridge {
  return {
    kind: "web",
    async openFolderDialog(): Promise<null> { return null; },
    async isSaveFolderAvailable(): Promise<boolean> { return false; },
    async getWindowLabel(): Promise<string> {
      return "main";
    },
    async openImageDialog(): Promise<string[]> {
      return [];
    },
    async readBatchPreview(): Promise<Uint8Array> {
      throw new LocalizedError("desktopPaths");
    },
    async readImageBytes(): Promise<Uint8Array> {
      throw new LocalizedError("desktopPaths");
    },
    async openImageWindows(): Promise<void> {
      throw new LocalizedError("desktopPaths");
    },
    async takeStartupPath(): Promise<string | null> {
      return null;
    },
    async saveImage(defaultName: string, bytes: Uint8Array, format: OutputFormat): Promise<SaveResult> {
      downloadBytes(defaultName, bytes, mimeTypeForFormat(format));
      return { kind: "downloaded", location: defaultName };
    },
    async saveCroppedImageFromPath(): Promise<SaveResult> {
      throw new LocalizedError("nativeSaveOnly");
    },
    async saveCroppedImageFromBytes(): Promise<SaveResult> {
      throw new LocalizedError("nativeSaveOnly");
    },
    async restoreWindowBounds(): Promise<void> {},
    async onWindowBoundsChanged(): Promise<void> {},
    async currentWindowBounds(): Promise<WindowBounds | null> {
      return null;
    },
    async onNativeFileDrop(): Promise<void> {}
  };
}

function detectTauriRuntime(): boolean {
  return typeof window.__TAURI_IPC__ === "function" || "__TAURI_INTERNALS__" in window;
}

async function getTauriDialogApi(): Promise<TauriDialogApi> {
  tauriDialogApiPromise ??= import("@tauri-apps/api/dialog");
  return tauriDialogApiPromise;
}

async function getTauriWindowApi(): Promise<TauriWindowApi> {
  tauriWindowApiPromise ??= import("@tauri-apps/api/window");
  return tauriWindowApiPromise;
}

function downloadBytes(fileName: string, bytes: Uint8Array, mimeType: string): void {
  const blob = new Blob([toArrayBuffer(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function saveDialogOptions(defaultName: string, format: OutputFormat, initialFolder?: string): {
  defaultPath: string;
  title: string;
  filters: { name: string; extensions: string[] }[];
} {
  return {
    defaultPath: saveDefaultPath(defaultName, initialFolder),
    title: t("save"),
    filters: [
      {
        name: outputFormatLabel(format),
        extensions: outputFormatExtensions(format)
      }
    ]
  };
}

function normalizeSavePath(path: string, format: OutputFormat): string {
  const validExtensions = new Set(outputFormatExtensions(format));
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    const currentExtension = fileName.slice(dotIndex + 1).toLowerCase();
    if (validExtensions.has(currentExtension)) {
      return path;
    }

    return `${directory}${fileName.slice(0, dotIndex)}.${preferredOutputExtension(format)}`;
  }

  return `${path}.${preferredOutputExtension(format)}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
