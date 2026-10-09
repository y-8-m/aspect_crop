// Settings deliberately stay outside this image-dependent reset.
export function clearEditorImage(state: {
  image: unknown; imageName: string; imageSource: unknown; crop: unknown;
  drag: unknown; imageRect: unknown;
}): void {
  state.image = null;
  state.imageName = "";
  state.imageSource = null;
  state.crop = null;
  state.drag = null;
  state.imageRect = null;
}
