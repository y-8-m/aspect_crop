import assert from "node:assert/strict";
import test from "node:test";
import { compile, dataUrl } from "./loadTs.mjs";

test("additional windows use logical bounds while persistence retains physical bounds", async () => {
  const bounds = { x: -2400, y: 160, width: 2400, height: 1640 };
  let scale = 2;
  let restoredSize, restoredPosition;
  const calls = [];
  globalThis.window = { __TAURI_IPC__() {} };
  globalThis.windowBoundsHarness = {
    invoke: (command, args) => calls.push({ command, args }),
    appWindow: {
      scaleFactor: async () => scale,
      isMaximized: async () => false,
      outerPosition: async () => ({ x: bounds.x, y: bounds.y }),
      innerSize: async () => ({ width: bounds.width, height: bounds.height }),
      setSize: async value => { restoredSize = value; },
      setPosition: async value => { restoredPosition = value; }
    }
  };
  try {
    const { createRuntimeBridge } = await import(await compile("runtimeBridge", {
      "@tauri-apps/api/tauri": dataUrl("export const invoke = (...args) => globalThis.windowBoundsHarness.invoke(...args);"),
      "@tauri-apps/api/window": dataUrl(`
        export const appWindow = globalThis.windowBoundsHarness.appWindow;
        export class PhysicalSize { constructor(width, height) { Object.assign(this, {width, height}); } }
        export class PhysicalPosition { constructor(x, y) { Object.assign(this, {x, y}); } }
      `)
    }));
    const runtime = createRuntimeBridge();
    const physical = await runtime.currentWindowBounds(800, 600);
    assert.deepEqual(physical, bounds);
    for (scale of [1, 1.5, 2]) {
      await runtime.openImageWindows(["/a.png", "/b.png"], physical);
      assert.deepEqual(calls.at(-1), { command: "open_image_windows", args: {
        paths: ["/a.png", "/b.png"],
        templateBounds: { x: bounds.x / scale, y: bounds.y / scale, width: bounds.width / scale, height: bounds.height / scale }
      } });
      assert.deepEqual(physical, bounds);
    }
    await runtime.restoreWindowBounds(physical);
    assert.deepEqual({ ...restoredSize }, { width: 2400, height: 1640 });
    assert.deepEqual({ ...restoredPosition }, { x: -2400, y: 160 });
    await runtime.openImageWindows(["/a.png"], null);
    assert.equal(calls.at(-1).args.templateBounds, null);
  } finally {
    delete globalThis.windowBoundsHarness;
    delete globalThis.window;
  }
});
