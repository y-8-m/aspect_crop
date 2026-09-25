import { msg, type Message } from "./i18n";
import type { NativeFileDropPayload } from "./runtimeBridge";

const SAME_SIGNATURE_DEDUPE_WINDOW_MS = 900;
const CROSS_SOURCE_DEDUPE_WINDOW_MS = 140;
const NATIVE_DROP_FALLBACK_DELAY_MS = 450;

type FileDropControllerOptions = {
  runtimeKind: "tauri" | "web";
  dropZone: HTMLDivElement;
  bindNativeDrop?: (listener: (payload: NativeFileDropPayload) => void) => Promise<void>;
  loadPathBatch: (paths: string[]) => Promise<void>;
  loadFile: (file: File) => Promise<string>;
  onStatus: (message: Message, isError?: boolean) => void;
  formatError: (error: unknown) => Message;
  supportedUniquePaths: (paths: string[]) => string[];
};

export type FileDropController = {
  bind(): Promise<void>;
};

export function createFileDropController(options: FileDropControllerOptions): FileDropController {
  let lastDropSignature = "";
  let lastDropAtMs = 0;
  let lastNativeDropAtMs = 0;

  return {
    async bind(): Promise<void> {
      window.addEventListener("dragover", (event) => {
        event.preventDefault();
      });

      window.addEventListener("drop", (event) => {
        event.preventDefault();
      });

      options.dropZone.addEventListener("dragenter", () => {
        options.dropZone.classList.add("drag-active");
      });

      options.dropZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        options.dropZone.classList.add("drag-active");
      });

      options.dropZone.addEventListener("dragleave", (event) => {
        const relatedTarget = event.relatedTarget;
        if (!(relatedTarget instanceof Node) || !options.dropZone.contains(relatedTarget)) {
          options.dropZone.classList.remove("drag-active");
        }
      });

      options.dropZone.addEventListener("drop", (event) => {
        void handleDomDrop(event);
      });

      if (options.runtimeKind !== "tauri" || !options.bindNativeDrop) {
        return;
      }

      try {
        await options.bindNativeDrop((payload) => {
          if (payload.type === "hover") {
            options.dropZone.classList.add("drag-active");
            return;
          }

          if (payload.type === "cancel") {
            options.dropZone.classList.remove("drag-active");
            return;
          }

          lastNativeDropAtMs = Date.now();
          options.dropZone.classList.remove("drag-active");
          const paths = options.supportedUniquePaths(payload.paths);
          if (paths.length === 0) {
            options.onStatus(msg("dropNoPath"), true);
            return;
          }

          void handleDroppedPathBatch(paths);
        });
      } catch (error) {
        console.warn("Failed to bind native file-drop events. Falling back to DOM drop handler.", error);
      }
    }
  };

  async function handleDomDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    options.dropZone.classList.remove("drag-active");

    try {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) {
        if (options.runtimeKind === "tauri") {
          scheduleNativeDropFallbackCheck(() => {
            void handleDroppedFileFallback(files);
          });
          return;
        }

        const loadedName = await runDropAction(dropBatchSignatureFromFiles([files[0]]), async () => {
          return options.loadFile(files[0]);
        });
        if (!loadedName) {
          return;
        }

        if (files.length > 1) {
          options.onStatus(
            msg("loadedWeb", { name: loadedName }),
            true
          );
        } else {
          options.onStatus(msg("loaded", { name: loadedName }));
        }
        return;
      }

      const uriList = event.dataTransfer?.getData("text/uri-list") ?? "";
      const paths = options.supportedUniquePaths(filePathsFromUriList(uriList));
      if (paths.length > 0) {
        if (options.runtimeKind === "tauri") {
          scheduleNativeDropFallbackCheck(() => {
            void handleDroppedPathBatch(paths);
          });
          return;
        }

        options.onStatus(msg("dropPathDesktop"), true);
        return;
      }

      if (options.runtimeKind !== "tauri") {
        options.onStatus(msg("dropNoImage"), true);
        return;
      }

      scheduleNativeDropFallbackCheck(() => {
        options.onStatus(msg("dropNoPayload"), true);
      });
    } catch (error) {
      options.onStatus(options.formatError(error), true);
    }
  }

  async function handleDroppedPathBatch(paths: string[]): Promise<void> {
    try {
      await runDropAction(dropBatchSignatureFromPaths(paths), async () => {
        await options.loadPathBatch(paths);
      });
    } catch (error) {
      options.onStatus(options.formatError(error), true);
    }
  }

  async function handleDroppedFileFallback(files: File[]): Promise<void> {
    const [firstFile] = files;
    if (!firstFile) {
      options.onStatus(msg("dropNoPayload"), true);
      return;
    }

    try {
      const loadedName = await runDropAction(dropBatchSignatureFromFiles([firstFile]), async () => {
        return options.loadFile(firstFile);
      });
      if (!loadedName) {
        return;
      }

      if (files.length > 1) {
        options.onStatus(
          msg("loadedSkipped", { name: loadedName, count: files.length - 1 }),
          true
        );
      } else {
        options.onStatus(msg("loaded", { name: loadedName }));
      }
    } catch (error) {
      options.onStatus(options.formatError(error), true);
    }
  }

  async function runDropAction<T>(signature: string, action: () => Promise<T>): Promise<T | null> {
    if (isDuplicateDrop(signature)) {
      return null;
    }

    markDropSeen(signature);
    return action();
  }

  function isDuplicateDrop(signature: string): boolean {
    const elapsedMs = Date.now() - lastDropAtMs;
    if (elapsedMs < CROSS_SOURCE_DEDUPE_WINDOW_MS) {
      return true;
    }

    return signature === lastDropSignature && elapsedMs < SAME_SIGNATURE_DEDUPE_WINDOW_MS;
  }

  function markDropSeen(signature: string): void {
    lastDropSignature = signature;
    lastDropAtMs = Date.now();
  }

  function dropBatchSignatureFromPaths(paths: string[]): string {
    return `paths:${paths.map((path) => normalizePath(path)).sort().join("|")}`;
  }

  function dropBatchSignatureFromFiles(files: File[]): string {
    return `files:${files
      .map((file) => `${file.name.toLowerCase()}:${file.size}:${file.lastModified}`)
      .sort()
      .join("|")}`;
  }

  function scheduleNativeDropFallbackCheck(onFallback: () => void): void {
    const checkStartedAtMs = Date.now();
    window.setTimeout(() => {
      if (lastNativeDropAtMs >= checkStartedAtMs) {
        return;
      }

      if (lastDropAtMs >= checkStartedAtMs) {
        return;
      }

      onFallback();
    }, NATIVE_DROP_FALLBACK_DELAY_MS);
  }
}

function filePathsFromUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((uri) => {
      try {
        const parsed = new URL(uri);
        if (parsed.protocol !== "file:") {
          return null;
        }

        const decodedPath = decodeURIComponent(parsed.pathname);
        if (/^\/[A-Za-z]:/.test(decodedPath)) {
          return decodedPath.slice(1);
        }

        return decodedPath;
      } catch {
        return null;
      }
    })
    .filter((path): path is string => Boolean(path));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}
