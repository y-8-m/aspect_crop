use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebpCompressionPreset {
    Fast,
    #[default]
    Balanced,
    Smallest,
}

pub fn encode(
    image: &image::DynamicImage,
    preset: WebpCompressionPreset,
) -> Result<webp::WebPMemory, String> {
    if image.width() == 0 || image.height() == 0 || image.width() > 16383 || image.height() > 16383
    {
        return Err("WebP dimensions must be between 1 and 16383 pixels".into());
    }
    let mut config = webp::WebPConfig::new().map_err(|_| "Failed to initialize WebP encoder")?;
    // In lossless mode quality controls search effort, not pixel fidelity.
    let (quality, method) = match preset {
        WebpCompressionPreset::Fast => (20.0, 0),
        WebpCompressionPreset::Balanced => (75.0, 4),
        WebpCompressionPreset::Smallest => (100.0, 6),
    };
    config.lossless = 1;
    config.near_lossless = 100;
    config.exact = 1; // Preserve RGB even beneath fully transparent pixels.
    config.quality = quality;
    config.method = method;
    let rgba = image.to_rgba8();
    webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
        .encode_advanced(&config)
        .map_err(|error| format!("Failed to encode WebP image: {error:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    const PRESETS: [WebpCompressionPreset; 3] = [
        WebpCompressionPreset::Fast,
        WebpCompressionPreset::Balanced,
        WebpCompressionPreset::Smallest,
    ];

    #[test]
    fn all_presets_preserve_rgba_including_invisible_rgb() {
        let rgba = image::RgbaImage::from_fn(33, 19, |x, y| {
            image::Rgba([
                (x * 7) as u8,
                (y * 13) as u8,
                (x * y) as u8,
                [0, 1, 127, 255][(x % 4) as usize],
            ])
        });
        for preset in PRESETS {
            let encoded = encode(&rgba.clone().into(), preset).unwrap();
            let decoded = image::load_from_memory(&encoded).unwrap().to_rgba8();
            assert_eq!(decoded, rgba, "{preset:?}");
        }
    }

    // Deterministic synthetic UI: panels, glyph-like strokes, illustration and textured gradient.
    // Run with cargo test webp_comparison -- --ignored --nocapture
    #[test]
    #[ignore]
    fn webp_comparison() {
        let source = image::RgbaImage::from_fn(1024, 768, |x, y| {
            let rgb = if y < 64 {
                [35, 40, 52]
            } else if x < 240 {
                if y % 32 < 3 && x > 20 {
                    [90, 100, 120]
                } else {
                    [235, 238, 242]
                }
            } else if y < 350 {
                if (x / 4 + y / 7) % 7 < 2 && y % 24 < 14 {
                    [40, 45, 55]
                } else {
                    [250, 250, 252]
                }
            } else if x < 600 {
                if (x as i32 - 420).pow(2) + (y as i32 - 550).pow(2) < 120 * 120 {
                    [64, 140, 220]
                } else {
                    [244, 230, 210]
                }
            } else {
                let noise = ((x * 13 ^ y * 37) % 23) as u8;
                [(x % 256) as u8, (y % 256) as u8, noise * 8]
            };
            image::Rgba([rgb[0], rgb[1], rgb[2], 255])
        });
        let source = image::DynamicImage::ImageRgba8(source);
        for preset in PRESETS {
            let start = std::time::Instant::now();
            let bytes = encode(&source, preset).unwrap();
            let elapsed = start.elapsed();
            assert_eq!(
                image::load_from_memory(&bytes).unwrap().to_rgba8(),
                source.to_rgba8()
            );
            println!(
                "{preset:?}: {} bytes, {:.2} ms",
                bytes.len(),
                elapsed.as_secs_f64() * 1000.0
            );
        }
    }
}
