import { invoke } from "@tauri-apps/api/tauri";
import type { BatchMetadata } from "./batchModel";
import type { OutputFormatChoice, Rect, WebpCompressionPreset } from "./appTypes";
export type BatchProgress = { completed: number; total: number; name: string };
export type BatchResult = { path: string; status: "success" | "failed" | "skipped"; error: string | null };
export type BatchRequest = { paths: string[]; output: string; crop: Rect; width: number; height: number; format: OutputFormatChoice; webpCompression: WebpCompressionPreset; collision: "overwrite" | "skip" | "rename" };
export async function scanBatch(paths: string[], folder: string | null, progress: (value: BatchProgress) => void): Promise<BatchMetadata[]> {
  const { appWindow } = await import("@tauri-apps/api/window");
  const stop = await appWindow.listen<BatchProgress>("batch-scan", event => progress(event.payload));
  try { return await invoke("scan_batch", { paths, folder }); } finally { stop(); }
}
export async function runBatch(request: BatchRequest, progress: (value: BatchProgress) => void): Promise<BatchResult[]> {
  const { appWindow } = await import("@tauri-apps/api/window");
  const stop = await appWindow.listen<BatchProgress>("batch-progress", event => progress(event.payload));
  try { return await invoke("run_batch", { request }); } finally { stop(); }
}
