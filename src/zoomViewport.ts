import type { Rect } from "./appTypes";
import { clampZoom, fitZoom, zoomLayout } from "./zoomGeometry";
import { t } from "./i18n";

type Options = {
  viewport: HTMLElement;
  surface: HTMLElement;
  controls: HTMLElement;
  slider: HTMLInputElement;
  output: HTMLOutputElement;
  onChange: (image: Rect, width: number, height: number) => void;
};

// Each viewport owns its zoom, fit mode and source-space viewing center.
export function createZoomViewport(options: Options) {
  const { viewport, surface, controls, slider, output, onChange } = options;
  let imageWidth = 0;
  let imageHeight = 0;
  let zoom = 1;
  let fit = 1;
  let followsFit = true;
  let center = { x: 0, y: 0 };
  let layout: ReturnType<typeof zoomLayout> | null = null;
  let width = 0;
  let height = 0;

  function syncControls(): void {
    const disabled = !imageWidth || fit === 1;
    // A 0..100 disabled range keeps the thumb at the right-hand 100% endpoint.
    slider.min = disabled ? "0" : String(fit * 100);
    slider.max = "100";
    slider.step = "any";
    slider.value = String(zoom * 100);
    slider.disabled = disabled;
    const percent = `${Number((zoom * 100).toFixed(2))}%`;
    output.value = percent;
    slider.setAttribute("aria-valuetext", percent);
    controls.classList.toggle("is-disabled", disabled);
    controls.title = t(!imageWidth ? "zoomNeedsImage" : disabled ? "zoomFits" : "zoomRange");
  }

  function rememberCenter(): void {
    if (!layout) return;
    center = {
      x: (viewport.scrollLeft + width / 2 - layout.image.x) / zoom,
      y: (viewport.scrollTop + height / 2 - layout.image.y) / zoom
    };
  }

  function notify(): void {
    const image = layout?.image ?? { x: 0, y: 0, width: 0, height: 0 };
    onChange({ ...image, x: image.x - viewport.scrollLeft, y: image.y - viewport.scrollTop }, width, height);
  }

  function refresh(): void {
    if (!viewport.clientWidth || !viewport.clientHeight) return;
    width = viewport.clientWidth;
    height = viewport.clientHeight;
    if (imageWidth && imageHeight) {
      fit = fitZoom(imageWidth, imageHeight, width, height);
      zoom = followsFit ? fit : clampZoom(zoom, fit);
      layout = zoomLayout(imageWidth, imageHeight, width, height, zoom, center);
      surface.style.width = `${layout.width}px`;
      surface.style.height = `${layout.height}px`;
      viewport.scrollLeft = layout.left;
      viewport.scrollTop = layout.top;
      rememberCenter();
    } else {
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
    }
    syncControls();
    notify();
  }

  slider.addEventListener("input", () => {
    rememberCenter();
    zoom = clampZoom(slider.valueAsNumber / 100, fit);
    followsFit = zoom <= fit + 1e-9;
    refresh();
  });
  // Range inputs with fractional fit endpoints still support predictable keyboard steps.
  slider.addEventListener("keydown", (event) => {
    const steps: Record<string, number> = { ArrowLeft: -0.01, ArrowDown: -0.01, ArrowRight: 0.01, ArrowUp: 0.01, PageDown: -0.1, PageUp: 0.1 };
    if (!(event.key in steps) && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    rememberCenter();
    zoom = clampZoom(event.key === "Home" ? fit : event.key === "End" ? 1 : zoom + steps[event.key], fit);
    followsFit = zoom <= fit + 1e-9;
    refresh();
  });
  viewport.addEventListener("scroll", () => { rememberCenter(); notify(); });
  new ResizeObserver(refresh).observe(viewport);
  syncControls();

  return {
    setImage(nextWidth: number, nextHeight: number, reset = false): void {
      const changed = nextWidth !== imageWidth || nextHeight !== imageHeight;
      imageWidth = nextWidth;
      imageHeight = nextHeight;
      if (reset || changed || !layout) center = { x: imageWidth / 2, y: imageHeight / 2 };
      if (reset) { zoom = 1; followsFit = true; layout = null; }
      refresh();
      syncControls();
    },
    refresh,
    translate: syncControls
  };
}
