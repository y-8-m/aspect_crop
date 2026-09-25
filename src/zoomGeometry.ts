import type { Point, Rect } from "./appTypes";

export function fitZoom(imageWidth: number, imageHeight: number, width: number, height: number): number {
  return Math.min(width / imageWidth, height / imageHeight, 1);
}

export function clampZoom(zoom: number, fit: number): number {
  return Math.max(fit, Math.min(Number.isFinite(zoom) ? zoom : fit, 1));
}

export function zoomLayout(
  imageWidth: number, imageHeight: number, width: number, height: number,
  zoom: number, center: Point
): { image: Rect; width: number; height: number; left: number; top: number } {
  const image = {
    x: Math.max(0, (width - imageWidth * zoom) / 2),
    y: Math.max(0, (height - imageHeight * zoom) / 2),
    width: imageWidth * zoom,
    height: imageHeight * zoom
  };
  const surfaceWidth = Math.max(width, image.width);
  const surfaceHeight = Math.max(height, image.height);
  return {
    image, width: surfaceWidth, height: surfaceHeight,
    left: Math.max(0, Math.min(surfaceWidth - width, image.x + center.x * zoom - width / 2)),
    top: Math.max(0, Math.min(surfaceHeight - height, image.y + center.y * zoom - height / 2))
  };
}

export function sourceToView(rect: Rect, image: Rect, zoom: number): Rect {
  return {
    x: image.x + rect.x * zoom,
    y: image.y + rect.y * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom
  };
}
