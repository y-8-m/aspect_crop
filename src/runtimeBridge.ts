import { invoke } from "@tauri-apps/api/tauri";

import type { OutputCrop, WindowBounds } from "./appTypes";

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
  openImageWindows(paths: string[], templateBounds: WindowBounds | null): Promise<void>;
  takeStartupPath(): Promise<string | null>;
  savePng(defaultName: string, bytes: Uint8Array): Promise<SaveResult>;
  saveCroppedPngFromPath(sourcePath: string, defaultName: string, crop: OutputCrop): Promise<SaveResult>;
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
        multiple: true,
        filters: [{ name: "Images", extensions }]
      });

      if (!selection) {
        return [];
      }

      return Array.isArray(selection) ? selection : [selection];
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
    async savePng(defaultName: string, bytes: Uint8Array): Promise<SaveResult> {
      const { save } = await getTauriDialogApi();
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PNG Image", extensions: ["png"] }]
      });

      if (!savePath) {
        return { kind: "cancelled" };
      }

      await invoke("save_png_file", {
        path: savePath,
        pngBase64: bytesToBase64(bytes)
      });

      return { kind: "saved", location: savePath };
    },
    async saveCroppedPngFromPath(
      sourcePath: string,
      defaultName: string,
      crop: OutputCrop
    ): Promise<SaveResult> {
      const { save } = await getTauriDialogApi();
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PNG Image", extensions: ["png"] }]
      });

      if (!savePath) {
        return { kind: "cancelled" };
      }

      await invoke("crop_image_to_png_file", {
        sourcePath,
        outputPath: savePath,
        crop
      });

      return { kind: "saved", location: savePath };
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
    async getWindowLabel(): Promise<string> {
      return "main";
    },
    async openImageDialog(): Promise<string[]> {
      return [];
    },
    async readImageBytes(): Promise<Uint8Array> {
      throw new Error("Reading image paths requires the desktop app runtime.");
    },
    async openImageWindows(): Promise<void> {
      throw new Error("Opening image paths requires the desktop app runtime.");
    },
    async takeStartupPath(): Promise<string | null> {
      return null;
    },
    async savePng(defaultName: string, bytes: Uint8Array): Promise<SaveResult> {
      downloadBytes(defaultName, bytes, "image/png");
      return { kind: "downloaded", location: defaultName };
    },
    async saveCroppedPngFromPath(): Promise<SaveResult> {
      throw new Error("Native crop-save requires the desktop app runtime.");
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
