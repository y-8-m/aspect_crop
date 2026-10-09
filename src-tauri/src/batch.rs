use super::{crop_dynamic_image, save_dynamic_image, CropRect, OutputFormat};
use image::AnimationDecoder;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
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
// Decode sequentially during validation too: a valid header alone does not establish a healthy reference.
fn open_static(path: &Path) -> Result<image::DynamicImage, String> {
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
    let animated = match format {
        Some(image::ImageFormat::Png) => image::codecs::png::PngDecoder::new(reader()?)
            .map_err(|e| e.to_string())?
            .is_apng()
            .map_err(|e| e.to_string())?,
        Some(image::ImageFormat::WebP) => image::codecs::webp::WebPDecoder::new(reader()?)
            .map_err(|e| e.to_string())?
            .has_animation(),
        Some(image::ImageFormat::Gif) => {
            image::codecs::gif::GifDecoder::new(reader()?)
                .map_err(|e| e.to_string())?
                .into_frames()
                .take(2)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
                .len()
                > 1
        }
        _ => false,
    };
    if animated {
        return Err("Animated images are not supported".into());
    }
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
        let (width, height, error) = match open_static(Path::new(&path)) {
            Ok(image) => (image.width(), image.height(), None),
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

pub fn run(request: Request, progress: impl Fn(Progress)) -> Result<Vec<FileResult>, String> {
    super::validate_crop_rect(&request.crop, request.width, request.height)?;
    let output = Path::new(&request.output);
    fs::create_dir_all(output).map_err(|e| e.to_string())?;
    let output = fs::canonicalize(output).map_err(|e| e.to_string())?;
    // Reject input directories, including aliases, before any output is written.
    for path in &request.paths {
        let parent = Path::new(path).parent().unwrap_or(Path::new("."));
        if fs::canonicalize(parent).map_err(|e| e.to_string())? == output {
            return Err("Choose a separate output folder".into());
        }
        format_for(&request.format, Path::new(path))?;
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
    for path in &request.paths {
        let outcome = (|| -> Result<&str, String> {
            let source = Path::new(path);
            let (format, extension) = format_for(&request.format, source)?;
            let name = source.file_name().ok_or("Missing file name")?;
            let mut destination = output.join(name);
            if request.format != "same" {
                destination.set_extension(extension);
            }
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
            let saved =
                save_dynamic_image(&cropped, &temp.to_string_lossy(), format).and_then(|_| {
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
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
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
