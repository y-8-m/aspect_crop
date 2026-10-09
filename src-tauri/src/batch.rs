use super::{
    crop_dynamic_image, save_dynamic_image, CropRect, OutputFormat, WebpCompressionPreset,
};
use image::ImageDecoder;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize)]
pub struct Metadata {
    path: String,
    name: String,
    width: u32,
    height: u32,
    error: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Progress {
    completed: usize,
    total: usize,
    name: String,
}
#[derive(Clone, Serialize)]
pub struct FileResult {
    path: String,
    status: String,
    error: Option<String>,
}
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Collision {
    Overwrite,
    Skip,
    Rename,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    paths: Vec<String>,
    output: String,
    crop: CropRect,
    width: u32,
    height: u32,
    format: String,
    collision: Collision,
    #[serde(default)]
    webp_compression: WebpCompressionPreset,
}

fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif"
    )
}
// Inspect metadata without decoding pixel buffers; GIF stops at the second frame.
fn inspect_static(path: &Path) -> Result<(u32, u32), String> {
    let reader = || {
        fs::File::open(path)
            .map(std::io::BufReader::new)
            .map_err(|e| e.to_string())
    };
    let format = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .format();
    let (dimensions, animated) = match format {
        Some(image::ImageFormat::Png) => {
            let decoder =
                image::codecs::png::PngDecoder::new(reader()?).map_err(|e| e.to_string())?;
            (
                decoder.dimensions(),
                decoder.is_apng().map_err(|e| e.to_string())?,
            )
        }
        Some(image::ImageFormat::WebP) => {
            let decoder =
                image::codecs::webp::WebPDecoder::new(reader()?).map_err(|e| e.to_string())?;
            (decoder.dimensions(), decoder.has_animation())
        }
        Some(image::ImageFormat::Gif) => {
            let mut options = gif::DecodeOptions::new();
            options.skip_frame_decoding(true);
            let mut decoder = options.read_info(reader()?).map_err(|e| e.to_string())?;
            let dimensions = (u32::from(decoder.width()), u32::from(decoder.height()));
            let mut count = 0;
            while count < 2
                && decoder
                    .next_frame_info()
                    .map_err(|e| e.to_string())?
                    .is_some()
            {
                count += 1;
            }
            (dimensions, count > 1)
        }
        Some(image::ImageFormat::Jpeg | image::ImageFormat::Bmp) => (
            image::ImageReader::open(path)
                .map_err(|e| e.to_string())?
                .with_guessed_format()
                .map_err(|e| e.to_string())?
                .into_dimensions()
                .map_err(|e| e.to_string())?,
            false,
        ),
        _ => return Err("Unsupported image format".into()),
    };
    if animated {
        return Err("Animated images are not supported".into());
    }
    if let Some(format) = format {
        ensure_complete(path, format, dimensions)?;
    }
    Ok(dimensions)
}

// Cheap truncation check (copy interrupted, partial download) without decoding pixels.
// Corruption in the middle of the data is only found when the image is decoded.
fn ensure_complete(
    path: &Path,
    format: image::ImageFormat,
    (width, height): (u32, u32),
) -> Result<(), String> {
    use image::ImageFormat as F;
    use std::io::{Read, Seek, SeekFrom};
    const TAIL: u64 = 1024;
    let truncated = || "File is incomplete (truncated)".to_string();
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut head = [0u8; 64];
    let head_len = file.read(&mut head).map_err(|e| e.to_string())?;
    let head = &head[..head_len];
    file.seek(SeekFrom::Start(len.saturating_sub(TAIL)))
        .map_err(|e| e.to_string())?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail).map_err(|e| e.to_string())?;
    let complete = match format {
        // Entropy-coded data byte-stuffs 0xFF, so FF D9 near the end is the real EOI marker.
        F::Jpeg => tail.windows(2).any(|w| w == [0xFF, 0xD9]),
        F::Png => tail.windows(4).any(|w| w == b"IEND"),
        F::Gif => tail.iter().rev().find(|&&b| b != 0) == Some(&0x3B),
        F::WebP => {
            head.len() >= 8
                && u64::from(u32::from_le_bytes(head[4..8].try_into().unwrap())) + 8 <= len
        }
        F::Bmp => {
            let header_size = head.get(14..18).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
            let compression = head.get(30..34).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
            match (header_size, compression, head.get(10..14), head.get(28..30)) {
                // Only uncompressed BITMAPINFOHEADER and later; RLE sizes are not predictable.
                (Some(size), Some(0 | 3), Some(offset), Some(bpp)) if size >= 40 => {
                    let offset = u64::from(u32::from_le_bytes(offset.try_into().unwrap()));
                    let bpp = u64::from(u16::from_le_bytes(bpp.try_into().unwrap()));
                    let stride = (u64::from(width) * bpp + 31) / 32 * 4;
                    offset + stride * u64::from(height) <= len
                }
                _ => true,
            }
        }
        _ => true,
    };
    if complete {
        Ok(())
    } else {
        Err(truncated())
    }
}

fn open_static(path: &Path) -> Result<image::DynamicImage, String> {
    inspect_static(path)?;
    image::open(path).map_err(|e| e.to_string())
}

// Browser image decoders can auto-rotate EXIF images. A lossless preview of the
// native pixel buffer keeps the editor in the same coordinate system as crop_imm.
pub fn preview(path: &str) -> Result<Vec<u8>, String> {
    let image = open_static(Path::new(path))?;
    let mut bytes = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(bytes.into_inner())
}

pub fn scan(
    paths: Vec<String>,
    folder: Option<String>,
    progress: impl Fn(Progress),
) -> Result<Vec<Metadata>, String> {
    let paths = if let Some(folder) = folder {
        let mut paths = Vec::new();
        for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_file() && supported(&entry.path()) {
                paths.push(entry.path().to_string_lossy().into_owned());
            }
        }
        paths.sort();
        paths
    } else {
        paths
    };
    let mut seen = HashSet::new();
    let paths: Vec<_> = paths
        .into_iter()
        .filter(|p| {
            supported(Path::new(p))
                && seen.insert(fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p)))
        })
        .collect();
    let total = paths.len();
    let mut result = Vec::new();
    for path in paths {
        let name = super::file_name_from_path(&path);
        let (width, height, error) = match inspect_static(Path::new(&path)) {
            Ok((width, height)) => (width, height, None),
            Err(error) => (0, 0, Some(error)),
        };
        result.push(Metadata {
            path,
            name: name.clone(),
            width,
            height,
            error,
        });
        progress(Progress {
            completed: result.len(),
            total,
            name,
        });
    }
    Ok(result)
}

fn output_path(base: &Path, collision: Collision) -> Option<PathBuf> {
    if !base.exists() || matches!(collision, Collision::Overwrite) {
        return Some(base.to_owned());
    }
    if matches!(collision, Collision::Skip) {
        return None;
    }
    let stem = base.file_stem().unwrap_or_default().to_string_lossy();
    let ext = base.extension().unwrap_or_default().to_string_lossy();
    for index in 1u64.. {
        let candidate = base.with_file_name(format!("{stem}_{index}.{ext}"));
        if !candidate.exists() {
            return Some(candidate);
        }
    }
    unreachable!()
}
fn format_for(choice: &str, path: &Path) -> Result<(OutputFormat, String), String> {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let value = if choice == "same" {
        ext.as_str()
    } else {
        choice
    };
    let (format, extension) = match value {
        "jpg" | "jpeg" => (OutputFormat::Jpeg, "jpg"),
        "png" => (OutputFormat::Png, "png"),
        "webp" => (OutputFormat::Webp, "webp"),
        "bmp" => (OutputFormat::Bmp, "bmp"),
        "gif" => (OutputFormat::Gif, "gif"),
        _ => return Err("Unsupported output format".into()),
    };
    Ok((format, extension.into()))
}

fn destination_for(output: &Path, source: &Path, choice: &str) -> Result<PathBuf, String> {
    let (_, extension) = format_for(choice, source)?;
    let mut destination = output.join(source.file_name().ok_or("Missing file name")?);
    if choice != "same" {
        destination.set_extension(extension);
    }
    Ok(destination)
}

// macOS and Windows filesystems are case-insensitive by default, so IMG.png and img.png collide.
fn collision_key(path: PathBuf) -> PathBuf {
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    } else {
        path
    }
}

pub fn run(request: Request, progress: impl Fn(Progress)) -> Result<Vec<FileResult>, String> {
    super::validate_crop_rect(&request.crop, request.width, request.height)?;
    let output = Path::new(&request.output);
    fs::create_dir_all(output).map_err(|e| e.to_string())?;
    let output = fs::canonicalize(output).map_err(|e| e.to_string())?;
    // Collect input failures, but check every valid source before writing anything.
    let mut errors = vec![None; request.paths.len()];
    for (index, path) in request.paths.iter().enumerate() {
        let source = Path::new(path);
        let parent = source
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        match fs::canonicalize(source).and_then(|_| fs::canonicalize(parent)) {
            Ok(parent) if parent == output => return Err("Choose a separate output folder".into()),
            Ok(_) => {}
            Err(error) => errors[index] = Some(error.to_string()),
        }
    }
    let mut destinations: HashMap<PathBuf, Vec<usize>> = HashMap::new();
    for (index, path) in request.paths.iter().enumerate() {
        // Inputs that already failed will not write anything, so they cannot collide.
        if errors[index].is_some() {
            continue;
        }
        match destination_for(&output, Path::new(path), &request.format) {
            Ok(destination) => {
                // Rename allocates sequentially. Skip preserves existing-file skips.
                if matches!(request.collision, Collision::Overwrite)
                    || (matches!(request.collision, Collision::Skip) && !destination.exists())
                {
                    let normalized = fs::canonicalize(&destination).unwrap_or(destination);
                    destinations
                        .entry(collision_key(normalized))
                        .or_default()
                        .push(index);
                }
            }
            Err(error) => errors[index] = Some(error),
        }
    }
    for indices in destinations.values().filter(|indices| indices.len() > 1) {
        for &index in indices {
            errors[index] = Some("Multiple input files resolve to the same output path".into());
        }
    }
    let probe = output.join(format!(
        ".aspect-crop-write-test-{}-{}",
        std::process::id(),
        super::BATCH_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|e| e.to_string())?;
    fs::remove_file(probe).map_err(|e| e.to_string())?;
    let sources: HashSet<_> = request
        .paths
        .iter()
        .filter_map(|p| fs::canonicalize(p).ok())
        .collect();
    let total = request.paths.len();
    let mut results = Vec::new();
    for (index, path) in request.paths.iter().enumerate() {
        let outcome = (|| -> Result<&str, String> {
            if let Some(error) = &errors[index] {
                return Err(error.clone());
            }
            let source = Path::new(path);
            let (format, _) = format_for(&request.format, source)?;
            let destination = destination_for(&output, source, &request.format)?;
            let Some(destination) = output_path(&destination, request.collision) else {
                return Ok("skipped");
            };
            if fs::symlink_metadata(&destination)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
                || fs::canonicalize(&destination)
                    .map(|p| sources.contains(&p))
                    .unwrap_or(false)
            {
                return Err("Output refers to an input or symbolic link".into());
            }
            let image = open_static(source)?;
            if (image.width(), image.height()) != (request.width, request.height) {
                return Err("Image size changed or does not match reference".into());
            }
            let cropped = crop_dynamic_image(&image, &request.crop)?;
            drop(image);
            // Encode into a temporary file first so encoder failures never truncate existing output.
            let temp = output.join(format!(
                ".aspect-crop-{}-{}.tmp",
                std::process::id(),
                super::BATCH_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            let saved = save_dynamic_image(
                &cropped,
                &temp.to_string_lossy(),
                format,
                request.webp_compression,
            )
            .and_then(|_| {
                if matches!(request.collision, Collision::Overwrite) {
                    fs::rename(&temp, &destination).map_err(|e| e.to_string())
                } else {
                    // create_new avoids overwriting a file that appeared after collision resolution.
                    // Copy rather than hard-link so removable filesystems work as well.
                    let mut target = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&destination)
                        .map_err(|e| e.to_string())?;
                    let copied = fs::File::open(&temp).and_then(|mut source| {
                        std::io::copy(&mut source, &mut target)?;
                        target.sync_all()
                    });
                    drop(target);
                    if copied.is_err() {
                        let _ = fs::remove_file(&destination);
                    }
                    copied.map_err(|e| e.to_string())
                }
            });
            let _ = fs::remove_file(&temp);
            saved?;
            Ok("success")
        })();
        let (status, error) = match outcome {
            Ok(status) => (status.into(), None),
            Err(error) => ("failed".into(), Some(error)),
        };
        results.push(FileResult {
            path: path.clone(),
            status,
            error,
        });
        progress(Progress {
            completed: results.len(),
            total,
            name: super::file_name_from_path(path),
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "aspect-batch-test-{}-{}",
                std::process::id(),
                super::super::BATCH_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn image(&self, name: &str, width: u32, height: u32) -> String {
            let path = self.0.join(name);
            image::RgbaImage::from_fn(width, height, |x, y| {
                image::Rgba([x as u8, y as u8, 42, 255])
            })
            .save(&path)
            .unwrap();
            path.to_string_lossy().into_owned()
        }
        fn request(&self, paths: Vec<String>, collision: Collision) -> Request {
            Request {
                paths,
                output: self.0.join("cropped").to_string_lossy().into_owned(),
                crop: CropRect {
                    x: 1,
                    y: 1,
                    width: 2,
                    height: 2,
                },
                width: 4,
                height: 3,
                format: "same".into(),
                collision,
                webp_compression: WebpCompressionPreset::default(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn duplicate_destinations_fail_every_input_before_writing() {
        for converted in [false, true] {
            for reversed in [false, true] {
                let f = Fixture::new();
                fs::create_dir(f.0.join("a")).unwrap();
                fs::create_dir(f.0.join("b")).unwrap();
                let a = f.image("a/a.png", 4, 3);
                let b = f.image(if converted { "b/a.bmp" } else { "b/a.png" }, 4, 3);
                let next = f.image("next.png", 4, 3);
                fs::create_dir(f.0.join("cropped")).unwrap();
                fs::write(f.0.join("cropped/a.png"), b"keep").unwrap();
                let mut paths = vec![a, b];
                if reversed {
                    paths.reverse();
                }
                paths.push(next);
                let mut request = f.request(paths, Collision::Overwrite);
                if converted {
                    request.format = "png".into();
                }
                let progress = std::cell::RefCell::new(Vec::new());
                let result = run(request, |p| {
                    progress.borrow_mut().push((p.completed, p.total))
                })
                .unwrap();
                assert!(result[..2].iter().all(|r| r.status == "failed"
                    && r.error.as_ref().unwrap().contains("Multiple input files")));
                assert_eq!(result[2].status, "success");
                assert_eq!(*progress.borrow(), [(1, 3), (2, 3), (3, 3)]);
                assert_eq!(fs::read(f.0.join("cropped/a.png")).unwrap(), b"keep");
            }
        }
    }

    #[test]
    fn skip_duplicates_fail_without_existing_output_and_skip_with_existing_output() {
        let f = Fixture::new();
        let a = f.image("a.png", 4, 3);
        let b = f.image("a.bmp", 4, 3);
        for existing in [false, true] {
            if existing {
                fs::write(f.0.join("cropped/a.png"), b"keep").unwrap();
            }
            let mut request = f.request(vec![a.clone(), b.clone()], Collision::Skip);
            request.format = "png".into();
            let result = run(request, |_| {}).unwrap();
            assert!(result
                .iter()
                .all(|r| r.status == if existing { "skipped" } else { "failed" }));
        }
        assert_eq!(fs::read(f.0.join("cropped/a.png")).unwrap(), b"keep");
    }

    #[test]
    fn deleted_inputs_and_format_errors_are_per_file() {
        for remove_parent in [false, true] {
            let f = Fixture::new();
            fs::create_dir(f.0.join("gone")).unwrap();
            let gone = f.image("gone/a.png", 4, 3);
            let next = f.image("next.png", 4, 3);
            let unsupported = f.0.join("unknown.xyz");
            fs::write(&unsupported, b"bad").unwrap();
            let request = f.request(
                vec![
                    gone.clone(),
                    unsupported.to_string_lossy().into_owned(),
                    next,
                ],
                Collision::Overwrite,
            );
            if remove_parent {
                fs::remove_dir_all(f.0.join("gone")).unwrap();
            } else {
                fs::remove_file(gone).unwrap();
            }
            let result = run(request, |_| {}).unwrap();
            assert_eq!(
                result.iter().map(|r| r.status.as_str()).collect::<Vec<_>>(),
                ["failed", "failed", "success"]
            );
        }
    }

    #[test]
    fn invalid_input_does_not_hide_global_input_folder_check() {
        let f = Fixture::new();
        let valid = f.image("valid.png", 4, 3);
        let mut request = f.request(
            vec![
                f.0.join("gone/missing.png").to_string_lossy().into_owned(),
                valid,
            ],
            Collision::Overwrite,
        );
        request.output = f.0.to_string_lossy().into_owned();
        assert!(run(request, |_| {})
            .err()
            .unwrap()
            .contains("separate output folder"));
    }

    #[test]
    fn scan_flags_truncated_files_and_run_continues() {
        let f = Fixture::new();
        for extension in ["png", "jpg", "webp", "bmp", "gif"] {
            let path = f.0.join(format!("image.{extension}"));
            image::RgbImage::new(4, 3).save(&path).unwrap();
            assert!(inspect_static(&path).is_ok(), "{extension} intact");
            let bytes = fs::read(&path).unwrap();
            // Cut only the EOI marker from JPEG; a deeper cut fails header parsing instead.
            let cut = if extension == "jpg" { 2 } else { 10 };
            fs::write(&path, &bytes[..bytes.len() - cut]).unwrap();
            let error = inspect_static(&path).expect_err(extension);
            // JPEG and GIF decoders may report the truncation themselves first.
            if !["jpg", "gif"].contains(&extension) {
                assert!(error.contains("incomplete"), "{extension}: {error}");
            }
        }
        let broken = f.0.join("image.bmp").to_string_lossy().into_owned();
        let next = f.image("next.png", 4, 3);
        let progress = std::cell::RefCell::new(Vec::new());
        let result = scan(vec![broken.clone(), next.clone()], None, |p| {
            progress.borrow_mut().push((p.completed, p.total, p.name))
        })
        .unwrap();
        assert!(result[0].error.as_ref().unwrap().contains("incomplete"));
        assert!(result[1].error.is_none());
        assert_eq!(
            *progress.borrow(),
            [(1, 2, "image.bmp".into()), (2, 2, "next.png".into())]
        );
        let result = run(f.request(vec![broken, next], Collision::Overwrite), |_| {}).unwrap();
        assert_eq!(result[0].status, "failed");
        assert_eq!(result[1].status, "success");
    }

    #[test]
    fn inspect_dimensions_for_all_supported_formats() {
        let f = Fixture::new();
        for extension in ["png", "jpg", "webp", "bmp", "gif"] {
            let path = f.0.join(format!("image.{extension}"));
            image::RgbImage::new(4, 3).save(&path).unwrap();
            assert_eq!(inspect_static(&path).unwrap(), (4, 3));
        }
    }

    #[cfg(unix)]
    #[test]
    fn output_symlink_to_source_is_rejected() {
        let f = Fixture::new();
        let source = f.image("a.png", 4, 3);
        let original = fs::read(&source).unwrap();
        fs::create_dir(f.0.join("cropped")).unwrap();
        std::os::unix::fs::symlink(&source, f.0.join("cropped/a.png")).unwrap();
        let result = run(
            f.request(vec![source.clone()], Collision::Overwrite),
            |_| {},
        )
        .unwrap();
        assert_eq!(result[0].status, "failed");
        assert_eq!(fs::read(source).unwrap(), original);
    }

    #[test]
    fn case_variant_destinations_and_failed_inputs_are_handled() {
        let f = Fixture::new();
        fs::create_dir(f.0.join("a")).unwrap();
        fs::create_dir(f.0.join("b")).unwrap();
        let upper = f.image("a/IMG.bmp", 4, 3);
        let lower = f.image("b/img.bmp", 4, 3);
        let mut request = f.request(vec![upper.clone(), lower], Collision::Overwrite);
        request.format = "png".into();
        let result = run(request, |_| {}).unwrap();
        let expected = if cfg!(any(target_os = "macos", target_os = "windows")) {
            "failed"
        } else {
            "success"
        };
        assert!(result.iter().all(|r| r.status == expected));
        // A missing input must not make a valid input look like a duplicate.
        let missing = f.0.join("gone/IMG.bmp").to_string_lossy().into_owned();
        let mut request = f.request(vec![missing, upper], Collision::Overwrite);
        request.format = "png".into();
        let result = run(request, |_| {}).unwrap();
        assert_eq!(result[0].status, "failed");
        assert_eq!(result[1].status, "success");
    }

    #[test]
    fn webp_encoding_failure_keeps_batch_running_and_existing_output() {
        let f = Fixture::new();
        let wide = f.image("wide.png", 16384, 1);
        let next = f.image("next.png", 16384, 1);
        fs::create_dir(f.0.join("cropped")).unwrap();
        fs::write(f.0.join("cropped/wide.webp"), b"keep").unwrap();
        let mut request = f.request(vec![wide, next], Collision::Overwrite);
        request.width = 16384;
        request.height = 1;
        request.crop = CropRect {
            x: 0,
            y: 0,
            width: 16384,
            height: 1,
        };
        request.format = "webp".into();
        let progress = std::cell::RefCell::new(Vec::new());
        let results = run(request, |p| progress.borrow_mut().push(p.completed)).unwrap();
        assert!(results
            .iter()
            .all(|r| r.status == "failed" && r.error.as_ref().unwrap().contains("16383")));
        assert_eq!(*progress.borrow(), [1, 2]);
        assert_eq!(fs::read(f.0.join("cropped/wide.webp")).unwrap(), b"keep");
    }

    #[test]
    fn single_path_and_memory_use_identical_webp_settings() {
        let f = Fixture::new();
        let source = f.image("single.png", 4, 3);
        for preset in [
            WebpCompressionPreset::Fast,
            WebpCompressionPreset::Balanced,
            WebpCompressionPreset::Smallest,
        ] {
            let crop = CropRect {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            };
            let a = f.0.join("path.webp").to_string_lossy().into_owned();
            let b = f.0.join("memory.webp").to_string_lossy().into_owned();
            super::super::crop_image_to_file(
                source.clone(),
                a.clone(),
                crop.clone(),
                OutputFormat::Webp,
                preset,
            )
            .unwrap();
            use base64::Engine;
            let data = base64::engine::general_purpose::STANDARD.encode(fs::read(&source).unwrap());
            super::super::crop_image_data_to_file(
                data,
                b.clone(),
                crop,
                OutputFormat::Webp,
                preset,
            )
            .unwrap();
            let expected = image::open(&source).unwrap().crop_imm(1, 1, 2, 2);
            assert_eq!(
                fs::read(&a).unwrap(),
                &*crate::webp_output::encode(&expected, preset).unwrap()
            );
            assert_eq!(fs::read(a).unwrap(), fs::read(b).unwrap());
        }
    }

    #[test]
    fn mixed_same_formats_apply_webp_preset_and_preserve_pixels() {
        let f = Fixture::new();
        let paths = vec![
            f.image("a.webp", 4, 3),
            f.image("b.png", 4, 3),
            f.image("c.bmp", 4, 3),
        ];
        for preset in [
            WebpCompressionPreset::Fast,
            WebpCompressionPreset::Balanced,
            WebpCompressionPreset::Smallest,
        ] {
            let mut request = f.request(paths.clone(), Collision::Overwrite);
            request.webp_compression = preset;
            assert!(run(request, |_| {})
                .unwrap()
                .iter()
                .all(|r| r.status == "success"));
            for path in &paths {
                let source = image::open(path).unwrap();
                let dest =
                    f.0.join("cropped")
                        .join(Path::new(path).file_name().unwrap());
                assert_eq!(
                    image::open(&dest).unwrap().to_rgba8(),
                    source.crop_imm(1, 1, 2, 2).to_rgba8()
                );
                let (format, _) = format_for("same", Path::new(path)).unwrap();
                let bytes = fs::read(&dest).unwrap();
                match format {
                    OutputFormat::Webp => assert_eq!(
                        bytes,
                        &*crate::webp_output::encode(&source.crop_imm(1, 1, 2, 2), preset).unwrap()
                    ),
                    OutputFormat::Png => assert_eq!(
                        image::guess_format(&bytes).unwrap(),
                        image::ImageFormat::Png
                    ),
                    OutputFormat::Bmp => assert_eq!(
                        image::guess_format(&bytes).unwrap(),
                        image::ImageFormat::Bmp
                    ),
                    _ => unreachable!(),
                }
            }
        }
        assert!(matches!(
            format_for("webp", Path::new("a.png")).unwrap().0,
            OutputFormat::Webp
        ));
    }

    #[test]
    fn preview_preserves_native_pixels_and_rejects_animation() {
        let f = Fixture::new();
        let path = f.image("preview.png", 4, 3);
        let decoded = image::load_from_memory(&preview(&path).unwrap())
            .unwrap()
            .to_rgba8();
        assert_eq!(decoded, image::open(&path).unwrap().to_rgba8());
        let animated = f.0.join("animated.gif");
        {
            let mut encoder =
                image::codecs::gif::GifEncoder::new(fs::File::create(&animated).unwrap());
            for value in [0, 255] {
                encoder
                    .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                        4,
                        3,
                        image::Rgba([value, 0, 0, 255]),
                    )))
                    .unwrap();
            }
        }
        assert!(preview(&animated.to_string_lossy()).is_err());
        let scanned = scan(vec![animated.to_string_lossy().into_owned()], None, |_| {}).unwrap();
        assert!(scanned[0].error.as_ref().unwrap().contains("Animated"));
    }

    #[test]
    fn scan_is_non_recursive_and_records_corrupt_files() {
        let f = Fixture::new();
        f.image("a.png", 4, 3);
        f.image("b.png", 8, 6);
        fs::write(f.0.join("broken.png"), "bad").unwrap();
        fs::write(f.0.join("notes.txt"), "skip").unwrap();
        fs::create_dir(f.0.join("nested")).unwrap();
        f.image("nested/c.png", 4, 3);
        let result = scan(vec![], Some(f.0.to_string_lossy().into_owned()), |_| {}).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!((result[0].width, result[0].height), (4, 3));
        assert_eq!((result[1].width, result[1].height), (8, 6));
        assert!(result[2].error.is_some());
    }
    #[test]
    fn sequential_crop_has_exact_pixels_continues_errors_and_reports_progress() {
        let f = Fixture::new();
        let a = f.image("a.png", 4, 3);
        let b = f.image("b.png", 4, 3);
        let small = f.image("small.png", 2, 2);
        let missing = f.0.join("missing.png").to_string_lossy().into_owned();
        let progress = std::cell::RefCell::new(Vec::new());
        let result = run(
            f.request(
                vec![a.clone(), missing, small, b.clone()],
                Collision::Rename,
            ),
            |p| progress.borrow_mut().push(p),
        )
        .unwrap();
        assert_eq!(
            result.iter().map(|r| r.status.as_str()).collect::<Vec<_>>(),
            ["success", "failed", "failed", "success"]
        );
        assert_eq!(
            progress
                .borrow()
                .iter()
                .map(|p| (p.completed, p.total))
                .collect::<Vec<_>>(),
            [(1, 4), (2, 4), (3, 4), (4, 4)]
        );
        for name in ["a.png", "b.png"] {
            let output = image::open(f.0.join("cropped").join(name))
                .unwrap()
                .to_rgba8();
            assert_eq!(output.dimensions(), (2, 2));
            for (x, y, p) in output.enumerate_pixels() {
                assert_eq!(p.0, [(x + 1) as u8, (y + 1) as u8, 42, 255]);
            }
        }
        assert_eq!(image::image_dimensions(a).unwrap(), (4, 3));
    }
    #[test]
    fn collision_policies_and_converted_name_collisions() {
        let f = Fixture::new();
        let a = f.image("a.png", 4, 3);
        fs::create_dir(f.0.join("cropped")).unwrap();
        let dest = f.0.join("cropped/a.png");
        fs::write(&dest, b"original").unwrap();
        assert_eq!(
            run(f.request(vec![a.clone()], Collision::Skip), |_| {}).unwrap()[0].status,
            "skipped"
        );
        assert_eq!(fs::read(&dest).unwrap(), b"original");
        assert_eq!(
            run(f.request(vec![a.clone()], Collision::Rename), |_| {}).unwrap()[0].status,
            "success"
        );
        assert!(f.0.join("cropped/a_1.png").exists());
        assert_eq!(
            run(f.request(vec![a.clone()], Collision::Overwrite), |_| {}).unwrap()[0].status,
            "success"
        );
        assert_eq!(image::image_dimensions(&dest).unwrap(), (2, 2));
        let b = f.image("a.bmp", 4, 3);
        let mut request = f.request(vec![a, b], Collision::Rename);
        request.format = "png".into();
        assert!(run(request, |_| {})
            .unwrap()
            .iter()
            .all(|r| r.status == "success"));
        assert!(f.0.join("cropped/a_2.png").exists());
        assert!(f.0.join("cropped/a_3.png").exists());
    }
    #[test]
    fn rejects_input_folder_and_unavailable_output_before_processing() {
        let f = Fixture::new();
        let a = f.image("a.png", 4, 3);
        let mut request = f.request(vec![a.clone()], Collision::Overwrite);
        request.output = f.0.to_string_lossy().into_owned();
        assert!(run(request, |_| {}).is_err());
        let mut request = f.request(vec![a.clone()], Collision::Rename);
        request.output = a;
        assert!(run(request, |_| {}).is_err());
    }
    #[test]
    fn preserves_existing_output_when_source_is_broken() {
        let f = Fixture::new();
        let path = f.0.join("a.png");
        fs::write(&path, b"bad").unwrap();
        fs::create_dir(f.0.join("cropped")).unwrap();
        fs::write(f.0.join("cropped/a.png"), b"keep").unwrap();
        let result = run(
            f.request(
                vec![path.to_string_lossy().into_owned()],
                Collision::Overwrite,
            ),
            |_| {},
        )
        .unwrap();
        assert_eq!(result[0].status, "failed");
        assert_eq!(fs::read(f.0.join("cropped/a.png")).unwrap(), b"keep");
    }
    #[test]
    fn formats_and_original_filename_are_preserved() {
        let f = Fixture::new();
        let a = f.image("source.png", 4, 3);
        for format in ["png", "jpeg", "webp", "bmp", "gif"] {
            let mut request = f.request(vec![a.clone()], Collision::Overwrite);
            request.format = format.into();
            assert_eq!(
                run(request, |_| {}).unwrap()[0].status,
                "success",
                "{format}"
            );
        }
        let jpeg = f.0.join("original.JPEG");
        fs::copy(f.0.join("cropped/source.jpg"), &jpeg).unwrap();
        let mut request = f.request(vec![jpeg.to_string_lossy().into_owned()], Collision::Rename);
        request.width = 2;
        request.height = 2;
        request.crop = CropRect {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
        };
        assert_eq!(run(request, |_| {}).unwrap()[0].status, "success");
        assert!(f.0.join("cropped/original.JPEG").exists());
    }
}
