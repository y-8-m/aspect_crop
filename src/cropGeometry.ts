import type { AspectPreset, Handle, Rect } from "./appTypes";

const MIN_SHORT_SIDE = 64;

export function fitRect(
  imageWidth: number,
  imageHeight: number,
  maxWidth: number,
  maxHeight: number
): Rect {
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: (maxWidth - width) / 2,
    y: (maxHeight - height) / 2,
    width,
    height
  };
}

export function pointInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function largestCropRect(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const units = aspectUnitsForAspect(aspect, aspectPresets);
  const unitScale = Math.floor(Math.min(imageWidth / units.width, imageHeight / units.height));

  let width: number;
  let height: number;

  if (unitScale >= 1) {
    width = units.width * unitScale;
    height = units.height * unitScale;
  } else if (imageWidth / imageHeight > aspect) {
    height = imageHeight;
    width = imageHeight * aspect;
  } else {
    width = imageWidth;
    height = imageWidth / aspect;
  }

  return {
    x: (imageWidth - width) / 2,
    y: (imageHeight - height) / 2,
    width,
    height
  };
}

export function recalcCropForAspect(
  current: Rect,
  aspect: number,
  imageWidth: number,
  imageHeight: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  const targetArea = current.width * current.height;

  let width = Math.sqrt(targetArea * aspect);
  let height = width / aspect;

  const largest = largestCropRect(imageWidth, imageHeight, aspect, aspectPresets);

  if (width > largest.width || height > largest.height) {
    width = largest.width;
    height = largest.height;
  }

  const { minWidth, minHeight } = minCropSize(aspect, imageWidth, imageHeight, aspectPresets);
  width = clamp(width, minWidth, largest.width);
  height = width / aspect;

  if (height < minHeight) {
    height = minHeight;
    width = height * aspect;
  }

  let x = centerX - width / 2;
  let y = centerY - height / 2;

  x = clamp(x, 0, imageWidth - width);
  y = clamp(y, 0, imageHeight - height);

  return {
    x,
    y,
    width,
    height
  };
}

export function moveCrop(
  crop: Rect,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number
): Rect {
  return {
    x: clamp(crop.x + dx, 0, imageWidth - crop.width),
    y: clamp(crop.y + dy, 0, imageHeight - crop.height),
    width: crop.width,
    height: crop.height
  };
}

export function scaleCropFromCenter(
  crop: Rect,
  factor: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const { minWidth, minHeight } = minCropSize(aspect, imageWidth, imageHeight, aspectPresets);

  const maxWidthByHorizontal = 2 * Math.min(centerX, imageWidth - centerX);
  const maxWidthByVertical = 2 * Math.min(centerY, imageHeight - centerY) * aspect;
  const maxWidth = Math.max(1, Math.min(maxWidthByHorizontal, maxWidthByVertical));
  const safeMinWidth = Math.min(maxWidth, Math.max(minWidth, minHeight * aspect));

  const width = clamp(crop.width * factor, safeMinWidth, maxWidth);
  const height = width / aspect;
  const x = centerX - width / 2;
  const y = centerY - height / 2;

  return {
    x: clamp(x, 0, imageWidth - width),
    y: clamp(y, 0, imageHeight - height),
    width,
    height
  };
}

export function resizeCrop(
  crop: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  switch (handle) {
    case "nw":
    case "ne":
    case "sw":
    case "se":
      return resizeCorner(crop, handle, dx, dy, imageWidth, imageHeight, aspect, aspectPresets);
    case "w":
      return resizeLeft(crop, dx, imageWidth, imageHeight, aspect, aspectPresets);
    case "e":
      return resizeRight(crop, dx, imageWidth, imageHeight, aspect, aspectPresets);
    case "n":
      return resizeTop(crop, dy, imageWidth, imageHeight, aspect, aspectPresets);
    case "s":
      return resizeBottom(crop, dy, imageWidth, imageHeight, aspect, aspectPresets);
    default:
      return crop;
  }
}

export function minCropSize(
  aspect: number,
  imageWidth: number,
  imageHeight: number,
  aspectPresets: readonly AspectPreset[]
): { minWidth: number; minHeight: number } {
  let minWidth = MIN_SHORT_SIDE;
  let minHeight = MIN_SHORT_SIDE;

  if (aspect >= 1) {
    minWidth = MIN_SHORT_SIDE * aspect;
  } else {
    minHeight = MIN_SHORT_SIDE / aspect;
  }

  const largest = largestCropRect(imageWidth, imageHeight, aspect, aspectPresets);
  minWidth = Math.min(minWidth, largest.width);
  minHeight = minWidth / aspect;

  if (minHeight > largest.height) {
    minHeight = largest.height;
    minWidth = minHeight * aspect;
  }

  return { minWidth, minHeight };
}

function aspectUnitsForAspect(
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): { width: number; height: number } {
  const preset =
    aspectPresets.find((candidate) => roughlyEqual(candidate.width / candidate.height, aspect)) ?? null;

  if (preset) {
    return { width: preset.width, height: preset.height };
  }

  return { width: aspect, height: 1 };
}

function resizeCorner(
  crop: Rect,
  handle: "nw" | "ne" | "sw" | "se",
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const { minWidth, minHeight } = minCropSize(aspect, imageWidth, imageHeight, aspectPresets);

  const config = {
    nw: {
      anchorX: crop.x + crop.width,
      anchorY: crop.y + crop.height,
      pointerX: crop.x + dx,
      pointerY: crop.y + dy,
      dirX: -1,
      dirY: -1,
      maxWidthBound: crop.x + crop.width,
      maxHeightBound: crop.y + crop.height
    },
    ne: {
      anchorX: crop.x,
      anchorY: crop.y + crop.height,
      pointerX: crop.x + crop.width + dx,
      pointerY: crop.y + dy,
      dirX: 1,
      dirY: -1,
      maxWidthBound: imageWidth - crop.x,
      maxHeightBound: crop.y + crop.height
    },
    sw: {
      anchorX: crop.x + crop.width,
      anchorY: crop.y,
      pointerX: crop.x + dx,
      pointerY: crop.y + crop.height + dy,
      dirX: -1,
      dirY: 1,
      maxWidthBound: crop.x + crop.width,
      maxHeightBound: imageHeight - crop.y
    },
    se: {
      anchorX: crop.x,
      anchorY: crop.y,
      pointerX: crop.x + crop.width + dx,
      pointerY: crop.y + crop.height + dy,
      dirX: 1,
      dirY: 1,
      maxWidthBound: imageWidth - crop.x,
      maxHeightBound: imageHeight - crop.y
    }
  }[handle];

  const rawWidth = Math.abs(config.pointerX - config.anchorX);
  const rawHeight = Math.abs(config.pointerY - config.anchorY);
  const maxWidth = Math.max(1, Math.min(config.maxWidthBound, config.maxHeightBound * aspect));
  const minBoundWidth = Math.min(maxWidth, Math.max(minWidth, minHeight * aspect));

  let width = rawWidth;
  let height = rawHeight;

  if (width / Math.max(height, 1e-6) > aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }

  width = clamp(width, minBoundWidth, maxWidth);
  height = width / aspect;

  const x = config.dirX < 0 ? config.anchorX - width : config.anchorX;
  const y = config.dirY < 0 ? config.anchorY - height : config.anchorY;

  return {
    x: clamp(x, 0, imageWidth - width),
    y: clamp(y, 0, imageHeight - height),
    width,
    height
  };
}

function resizeLeft(
  crop: Rect,
  dx: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const right = crop.x + crop.width;
  const centerY = crop.y + crop.height / 2;

  const { minWidth } = minCropSize(aspect, imageWidth, imageHeight, aspectPresets);
  const verticalLimit = 2 * Math.min(centerY, imageHeight - centerY);
  const maxWidth = Math.min(right, verticalLimit * aspect);
  const safeMax = Math.max(minWidth, maxWidth);

  let width = right - clamp(crop.x + dx, 0, right - minWidth);
  width = clamp(width, minWidth, safeMax);

  const height = width / aspect;
  const x = right - width;
  const y = centerY - height / 2;

  return {
    x: clamp(x, 0, imageWidth - width),
    y: clamp(y, 0, imageHeight - height),
    width,
    height
  };
}

function resizeRight(
  crop: Rect,
  dx: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const left = crop.x;
  const centerY = crop.y + crop.height / 2;

  const { minWidth } = minCropSize(aspect, imageWidth, imageHeight, aspectPresets);
  const verticalLimit = 2 * Math.min(centerY, imageHeight - centerY);
  const maxWidth = Math.min(imageWidth - left, verticalLimit * aspect);
  const safeMax = Math.max(minWidth, maxWidth);

  const width = clamp(crop.width + dx, minWidth, safeMax);
  const height = width / aspect;
  const y = centerY - height / 2;

  return {
    x: left,
    y: clamp(y, 0, imageHeight - height),
    width,
    height
  };
}

function resizeTop(
  crop: Rect,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const bottom = crop.y + crop.height;
  const centerX = crop.x + crop.width / 2;

  const { minHeight } = minCropSize(aspect, imageWidth, imageHeight, aspectPresets);
  const horizontalLimit = 2 * Math.min(centerX, imageWidth - centerX);
  const maxHeight = Math.min(bottom, horizontalLimit / aspect);
  const safeMax = Math.max(minHeight, maxHeight);

  let height = bottom - clamp(crop.y + dy, 0, bottom - minHeight);
  height = clamp(height, minHeight, safeMax);

  const width = height * aspect;
  const y = bottom - height;
  const x = centerX - width / 2;

  return {
    x: clamp(x, 0, imageWidth - width),
    y: clamp(y, 0, imageHeight - height),
    width,
    height
  };
}

function resizeBottom(
  crop: Rect,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  aspectPresets: readonly AspectPreset[]
): Rect {
  const top = crop.y;
  const centerX = crop.x + crop.width / 2;

  const { minHeight } = minCropSize(aspect, imageWidth, imageHeight, aspectPresets);
  const horizontalLimit = 2 * Math.min(centerX, imageWidth - centerX);
  const maxHeight = Math.min(imageHeight - top, horizontalLimit / aspect);
  const safeMax = Math.max(minHeight, maxHeight);

  const height = clamp(crop.height + dy, minHeight, safeMax);
  const width = height * aspect;
  const x = centerX - width / 2;

  return {
    x: clamp(x, 0, imageWidth - width),
    y: top,
    width,
    height
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function roughlyEqual(left: number, right: number, epsilon = 1e-9): boolean {
  return Math.abs(left - right) <= epsilon;
}
