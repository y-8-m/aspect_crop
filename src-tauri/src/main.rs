#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;
mod batch;
mod webp_output;
use webp_output::WebpCompressionPreset;
mod save_folder;
static BATCH_ID: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
async fn read_batch_preview(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        batch::preview(&path).map(|bytes| STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_batch(
    window: tauri::Window,
    paths: Vec<String>,
    folder: Option<String>,
) -> Result<Vec<batch::Metadata>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        batch::scan(paths, folder, |p| {
            let _ = window.emit("batch-scan", p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn run_batch(
    window: tauri::Window,
    request: batch::Request,
) -> Result<Vec<batch::FileResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        batch::run(request, |p| {
            let _ = window.emit("batch-progress", p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn is_save_folder_available(path: String) -> bool {
    save_folder::is_available(Path::new(&path))
}

struct AppState {
    startup_files: Mutex<HashMap<String, String>>,
    next_window_id: AtomicU64,
}

#[derive(Clone, Deserialize)]
struct WindowBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Deserialize)]
struct CropRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum OutputFormat {
    Png,
    Jpeg,
    Webp,
    Bmp,
    Gif,
}

#[tauri::command]
fn read_image_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|error| format!("Failed to read file: {error}"))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn save_image_file(path: String, image_base64: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(&image_base64)
        .map_err(|error| format!("Failed to decode image bytes: {error}"))?;

    std::fs::write(&path, bytes).map_err(|error| format!("Failed to save file: {error}"))?;
    Ok(())
}

#[tauri::command]
fn crop_image_to_file(
    source_path: String,
    output_path: String,
    crop: CropRect,
    format: OutputFormat,
    webp_compression: WebpCompressionPreset,
) -> Result<(), String> {
    let reader = image::ImageReader::open(&source_path)
        .map_err(|error| format!("Failed to open image: {error}"))?;
    let image = decode_oriented(reader, "Failed to open image")?;
    let cropped = crop_dynamic_image(&image, &crop)?;

    save_dynamic_image(&cropped, &output_path, format, webp_compression)
}

#[tauri::command]
fn crop_image_data_to_file(
    source_base64: String,
    output_path: String,
    crop: CropRect,
    format: OutputFormat,
    webp_compression: WebpCompressionPreset,
) -> Result<(), String> {
    let source_bytes = STANDARD
        .decode(&source_base64)
        .map_err(|error| format!("Failed to decode source image bytes: {error}"))?;
    let reader = image::ImageReader::new(std::io::Cursor::new(source_bytes));
    let image = decode_oriented(reader, "Failed to decode source image")?;
    let cropped = crop_dynamic_image(&image, &crop)?;

    save_dynamic_image(&cropped, &output_path, format, webp_compression)
}

// The editor shows the image through the browser, which applies EXIF orientation.
// Apply it here too so crop coordinates refer to the same pixels the user saw.
fn decode_oriented<R: std::io::BufRead + std::io::Seek>(
    reader: image::ImageReader<R>,
    context: &str,
) -> Result<image::DynamicImage, String> {
    use image::ImageDecoder;
    let err = |error: image::ImageError| format!("{context}: {error}");
    let mut decoder = reader
        .with_guessed_format()
        .map_err(|error| format!("{context}: {error}"))?
        .into_decoder()
        .map_err(err)?;
    let orientation = decoder.orientation().map_err(err)?;
    let mut image = image::DynamicImage::from_decoder(decoder).map_err(err)?;
    image.apply_orientation(orientation);
    Ok(image)
}

fn validate_crop_rect(crop: &CropRect, image_width: u32, image_height: u32) -> Result<(), String> {
    if crop.width == 0 || crop.height == 0 {
        return Err("Invalid crop rectangle: width and height must be greater than zero.".into());
    }
    // Check the origin before subtracting, so neither subtraction nor addition can overflow.
    if crop.x >= image_width || crop.y >= image_height {
        return Err("Invalid crop rectangle: origin is outside image bounds.".into());
    }
    if crop.width > image_width - crop.x || crop.height > image_height - crop.y {
        return Err("Invalid crop rectangle: crop exceeds image bounds.".into());
    }
    Ok(())
}

fn crop_dynamic_image(
    image: &image::DynamicImage,
    crop: &CropRect,
) -> Result<image::DynamicImage, String> {
    validate_crop_rect(crop, image.width(), image.height())?;
    Ok(image.crop_imm(crop.x, crop.y, crop.width, crop.height))
}

#[cfg(test)]
mod crop_tests {
    use super::*;

    #[test]
    fn validates_crop_rectangles() {
        let cases = [
            ("normal", (10, 20, 30, 40), (100, 80), true),
            ("zero width", (0, 0, 0, 10), (100, 80), false),
            ("zero height", (0, 0, 10, 0), (100, 80), false),
            ("x outside", (100, 0, 1, 1), (100, 80), false),
            ("y outside", (0, 80, 1, 1), (100, 80), false),
            ("right overflow", (90, 0, 11, 1), (100, 80), false),
            ("bottom overflow", (0, 70, 1, 11), (100, 80), false),
            ("whole image", (0, 0, 100, 80), (100, 80), true),
            ("last pixel", (99, 79, 1, 1), (100, 80), true),
            ("empty image", (0, 0, 1, 1), (0, 0), false),
            (
                "x addition overflow",
                (1, 0, u32::MAX, 1),
                (u32::MAX, 80),
                false,
            ),
            (
                "y addition overflow",
                (0, 1, 1, u32::MAX),
                (100, u32::MAX),
                false,
            ),
            (
                "maximum dimensions",
                (0, 0, u32::MAX, u32::MAX),
                (u32::MAX, u32::MAX),
                true,
            ),
        ];
        for (name, (x, y, width, height), (image_width, image_height), valid) in cases {
            let crop = CropRect {
                x,
                y,
                width,
                height,
            };
            assert_eq!(
                validate_crop_rect(&crop, image_width, image_height).is_ok(),
                valid,
                "{name}"
            );
        }
    }

    #[test]
    fn crop_preserves_source_pixels_and_rejects_invalid_rectangles() {
        let source =
            image::RgbaImage::from_fn(4, 3, |x, y| image::Rgba([x as u8, y as u8, 42, 255]));
        let image = image::DynamicImage::ImageRgba8(source.clone());
        let crop = CropRect {
            x: 1,
            y: 1,
            width: 3,
            height: 2,
        };
        let result = crop_dynamic_image(&image, &crop).unwrap().to_rgba8();
        assert_eq!(result.dimensions(), (3, 2));
        for (x, y, pixel) in result.enumerate_pixels() {
            assert_eq!(pixel, source.get_pixel(x + 1, y + 1));
        }
        let invalid = CropRect { width: 4, ..crop };
        assert!(crop_dynamic_image(&image, &invalid).is_err());
    }

    #[test]
    fn exif_orientation_is_applied_before_cropping() {
        // 4x2 JPEG tagged Orientation=6 (rotate 90 CW) must be treated as 2x4.
        let mut jpeg = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 2, image::Rgb([200, 100, 50])))
            .write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
            .unwrap();
        let exif: Vec<u8> = [
            b"Exif\0\0".as_slice(),
            &[b'M', b'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0],
            &[0, 0, 0, 0],
        ]
        .concat();
        let mut tagged = vec![0xFF, 0xD8, 0xFF, 0xE1];
        tagged.extend(((exif.len() + 2) as u16).to_be_bytes());
        tagged.extend(&exif);
        tagged.extend(&jpeg[2..]);
        let reader = image::ImageReader::new(std::io::Cursor::new(tagged));
        let image = decode_oriented(reader, "test").unwrap();
        assert_eq!((image.width(), image.height()), (2, 4));
        let crop = CropRect { x: 0, y: 0, width: 2, height: 4 };
        assert!(crop_dynamic_image(&image, &crop).is_ok());
    }
}

fn save_dynamic_image(
    image: &image::DynamicImage,
    output_path: &str,
    format: OutputFormat,
    webp_compression: WebpCompressionPreset,
) -> Result<(), String> {
    match format {
        OutputFormat::Png => image
            .save_with_format(output_path, image::ImageFormat::Png)
            .map_err(|error| format!("Failed to save PNG image: {error}")),
        OutputFormat::Bmp => image
            .save_with_format(output_path, image::ImageFormat::Bmp)
            .map_err(|error| format!("Failed to save BMP image: {error}")),
        OutputFormat::Gif => image
            .save_with_format(output_path, image::ImageFormat::Gif)
            .map_err(|error| format!("Failed to save GIF image: {error}")),
        OutputFormat::Jpeg => {
            let file = File::create(output_path)
                .map_err(|error| format!("Failed to create file: {error}"))?;
            let writer = BufWriter::new(file);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(writer, 100);
            image
                .write_with_encoder(encoder)
                .map_err(|error| format!("Failed to save JPEG image: {error}"))
        }
        OutputFormat::Webp => {
            let bytes = webp_output::encode(image, webp_compression)?;
            std::fs::write(output_path, &*bytes)
                .map_err(|error| format!("Failed to save WebP image: {error}"))
        }
    }
}

#[tauri::command]
fn take_window_file_path(
    window_label: String,
    state: tauri::State<'_, AppState>,
) -> Option<String> {
    match state.startup_files.lock() {
        Ok(mut files) => files.remove(&window_label),
        Err(_) => None,
    }
}

// Async so window creation does not run on the main thread's command queue (deadlocks on Windows).
#[tauri::command]
async fn open_image_windows(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    paths: Vec<String>,
    template_bounds: Option<WindowBounds>,
) -> Result<(), String> {
    for (index, path) in paths.into_iter().enumerate() {
        open_image_window(&app, &state, path, template_bounds.as_ref(), index)?;
    }

    Ok(())
}

fn find_existing_files<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .filter(|candidate| Path::new(candidate).is_file())
        .collect()
}

fn file_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_string()
}

fn open_image_window(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    path: String,
    template_bounds: Option<&WindowBounds>,
    cascade_index: usize,
) -> Result<(), String> {
    let label = format!(
        "editor-{}",
        state.next_window_id.fetch_add(1, Ordering::Relaxed)
    );

    {
        let mut startup_files = state
            .startup_files
            .lock()
            .map_err(|_| String::from("Failed to lock startup file map."))?;
        startup_files.insert(label.clone(), path.clone());
    }

    let mut builder =
        tauri::WindowBuilder::new(app, label, tauri::WindowUrl::App("index.html".into()))
            .title(format!("Aspect Crop - {}", file_name_from_path(&path)))
            .resizable(true);

    if let Some(bounds) = template_bounds {
        let cascade_offset = 28.0 * (cascade_index as f64 + 1.0);
        builder = builder
            .inner_size(bounds.width, bounds.height)
            .position(bounds.x + cascade_offset, bounds.y + cascade_offset);
    } else {
        builder = builder.inner_size(1200.0, 820.0);
    }

    builder
        .build()
        .map_err(|error| format!("Failed to open window: {error}"))?;

    Ok(())
}

fn main() {
    let startup_files = find_existing_files(std::env::args().skip(1));
    let mut startup_map = HashMap::new();

    if let Some(first_path) = startup_files.first() {
        startup_map.insert(String::from("main"), first_path.clone());
    }

    let extra_startup_files: Vec<String> = startup_files.into_iter().skip(1).collect();

    tauri::Builder::default()
        .manage(AppState {
            startup_files: Mutex::new(startup_map),
            next_window_id: AtomicU64::new(1),
        })
        .setup(move |app| {
            let state: tauri::State<'_, AppState> = app.state();

            for (index, path) in extra_startup_files.iter().cloned().enumerate() {
                open_image_window(&app.app_handle(), &state, path, None, index)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_batch_preview,
            scan_batch,
            run_batch,
            read_image_file,
            is_save_folder_available,
            save_image_file,
            crop_image_to_file,
            crop_image_data_to_file,
            take_window_file_path,
            open_image_windows
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
