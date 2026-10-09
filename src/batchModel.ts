import type { Rect } from "./appTypes";

export type BatchImageStatus = "included" | "excluded" | "size-mismatch" | "invalid";
export type BatchImage = { path: string; name: string; width: number; height: number; error: string | null; status: BatchImageStatus };
export type BatchMetadata = Omit<BatchImage, "status">;
export type BatchState = { images: BatchImage[]; index: number; reference: { width: number; height: number } | null };
export function createBatch(images: BatchMetadata[]): BatchState {
  const reference = images.find(image => !image.error && image.width > 0 && image.height > 0) ?? null;
  return { reference: reference && { width: reference.width, height: reference.height }, index: 0,
    images: images.map(image => ({ ...image, status: image.error || !image.width || !image.height ? "invalid" :
      image.width === reference?.width && image.height === reference?.height ? "included" : "size-mismatch" })) };
}
export function toggleImage(image: BatchImage): void {
  if (image.status === "included") image.status = "excluded";
  else if (image.status === "excluded") image.status = "included";
}
export function batchCounts(images: BatchImage[]): Record<BatchImageStatus, number> {
  const counts = { included: 0, excluded: 0, "size-mismatch": 0, invalid: 0 };
  for (const image of images) counts[image.status]++;
  return counts;
}
export function navigateBatch(state: BatchState, offset: number): void {
  state.index = Math.max(0, Math.min(state.images.length - 1, state.index + offset));
}
export function batchTargets(state: BatchState): string[] {
  return state.images.filter(image => image.status === "included").map(image => image.path);
}
export function snapshotCrop(crop: Rect): Rect {
  return { x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.width), height: Math.round(crop.height) };
}

// Accept the one-based position displayed by the UI; keep internal indices zero-based.
export function setBatchIndex(state: BatchState, position: string | number): void {
  if (typeof position === "string" && !position.trim()) return;
  const value = Number(position);
  if (!Number.isFinite(value)) return;
  state.index = Math.max(0, Math.min(state.images.length - 1, Math.trunc(value) - 1));
}
