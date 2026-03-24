import type { OutputFormat, OutputFormatChoice } from "./appTypes";

export const EXPORTABLE_OUTPUT_FORMATS: OutputFormat[] = ["png", "jpeg", "webp", "bmp"];

export function parseOutputFormatChoice(value: string | null): OutputFormatChoice | null {
  if (value === "same") {
    return value;
  }

  return isOutputFormat(value) ? value : null;
}

export function resolveOutputFormatChoice(
  choice: OutputFormatChoice,
  originalExtension: string | null
): OutputFormat {
  if (choice !== "same") {
    return choice;
  }

  if (originalExtension === "jpg" || originalExtension === "jpeg") {
    return "jpeg";
  }

  if (
    originalExtension === "png" ||
    originalExtension === "webp" ||
    originalExtension === "bmp" ||
    originalExtension === "gif"
  ) {
    return originalExtension;
  }

  return "png";
}

export function preferredOutputExtension(format: OutputFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function outputFormatLabel(format: OutputFormat): string {
  switch (format) {
    case "png":
      return "PNG";
    case "jpeg":
      return "JPEG";
    case "webp":
      return "WebP";
    case "bmp":
      return "BMP";
    case "gif":
      return "GIF";
  }
}

export function outputFormatExtensions(format: OutputFormat): string[] {
  switch (format) {
    case "jpeg":
      return ["jpg", "jpeg"];
    default:
      return [format];
  }
}

export function mimeTypeForFormat(format: OutputFormat): string {
  switch (format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
  }
}

export function isBrowserEncodedFormat(format: OutputFormat): format is "png" | "jpeg" {
  return format === "png" || format === "jpeg";
}

export function browserEncodingOptions(format: "png" | "jpeg"): {
  mimeType: string;
  quality?: number;
} {
  if (format === "jpeg") {
    return { mimeType: "image/jpeg", quality: 1 };
  }

  return { mimeType: "image/png" };
}

function isOutputFormat(value: string | null): value is OutputFormat {
  return value !== null && EXPORTABLE_OUTPUT_FORMATS.includes(value as OutputFormat);
}
