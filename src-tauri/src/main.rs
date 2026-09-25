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
mod save_folder;

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
) -> Result<(), String> {
    let image =
        image::open(&source_path).map_err(|error| format!("Failed to open image: {error}"))?;
    let cropped = crop_dynamic_image(&image, &crop);

    save_dynamic_image(&cropped, &output_path, format)
}

#[tauri::command]
fn crop_image_data_to_file(
    source_base64: String,
    output_path: String,
    crop: CropRect,
    format: OutputFormat,
) -> Result<(), String> {
    let source_bytes = STANDARD
        .decode(&source_base64)
        .map_err(|error| format!("Failed to decode source image bytes: {error}"))?;
    let image = image::load_from_memory(&source_bytes)
        .map_err(|error| format!("Failed to decode source image: {error}"))?;
    let cropped = crop_dynamic_image(&image, &crop);

    save_dynamic_image(&cropped, &output_path, format)
}

fn crop_dynamic_image(image: &image::DynamicImage, crop: &CropRect) -> image::DynamicImage {
    let image_width = image.width();
    let image_height = image.height();

    let x = crop.x.min(image_width.saturating_sub(1));
    let y = crop.y.min(image_height.saturating_sub(1));
    let width = crop.width.clamp(1, image_width.saturating_sub(x));
    let height = crop.height.clamp(1, image_height.saturating_sub(y));

    image.crop_imm(x, y, width, height)
}

fn save_dynamic_image(
    image: &image::DynamicImage,
    output_path: &str,
    format: OutputFormat,
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
            let file =
                File::create(output_path).map_err(|error| format!("Failed to create file: {error}"))?;
            let writer = BufWriter::new(file);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(writer, 100);
            image
                .write_with_encoder(encoder)
                .map_err(|error| format!("Failed to save JPEG image: {error}"))
        }
        OutputFormat::Webp => {
            let file =
                File::create(output_path).map_err(|error| format!("Failed to create file: {error}"))?;
            let writer = BufWriter::new(file);
            let encoder = image::codecs::webp::WebPEncoder::new_lossless(writer);
            image
                .write_with_encoder(encoder)
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

#[tauri::command]
fn open_image_windows(
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
