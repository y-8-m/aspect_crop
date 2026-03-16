# Aspect Crop

A small macOS desktop utility for fixed-aspect image cropping.

## MVP Features

- Load one image by button, window drag-and-drop, or Dock drag-and-drop
- Dock drop is supported on cold start (launching app with a file)
- Pick fixed aspect presets: `1:1`, `4:3`, `16:9`, `3:2`
- Move and resize crop frame while keeping the selected aspect
- Crop frame is constrained inside image bounds
- Preview cropped result
- Save as PNG without scaling original pixels
- Reject unsupported input formats

## Controls

- Drag inside frame: move
- Drag handles: resize with fixed aspect
- Arrow keys: move by 1px (`Shift + Arrow`: 10px)
- Mouse wheel: zoom frame in/out around its center
- `+` / `-`: zoom frame in/out around its center

## Run

```bash
npm install
npm run tauri -- dev
```

`npm run tauri -- dev` auto-selects a free Vite port to avoid conflicts.

## Build

```bash
npm run tauri -- build
```
