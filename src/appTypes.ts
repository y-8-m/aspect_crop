export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export type DragState = {
  mode: "move" | "resize";
  pointerId: number;
  startPoint: Point;
  startCrop: Rect;
  handle?: Handle;
};

export type AspectPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  builtIn: boolean;
};

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OutputCrop = Rect;

export type LoadedImageSource =
  | { kind: "path"; path: string }
  | { kind: "memory" };

export type PathBatchSource = "drop" | "open";
