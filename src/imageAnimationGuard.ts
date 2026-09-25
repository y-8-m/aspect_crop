import { LocalizedError } from "./i18n";

export function ensureNonAnimatedImage(bytes: Uint8Array, extension: string | null): void {
  if (extension === "png" && isAnimatedPng(bytes)) {
    throw new LocalizedError("animatedImage", { format: "PNG (APNG)" });
  }

  if (extension === "gif" && isAnimatedGif(bytes)) {
    throw new LocalizedError("animatedImage", { format: "GIF" });
  }

  if (extension === "webp" && isAnimatedWebP(bytes)) {
    throw new LocalizedError("animatedImage", { format: "WebP" });
  }
}

function isAnimatedPng(bytes: Uint8Array): boolean {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < pngSignature.length) {
    return false;
  }

  for (let index = 0; index < pngSignature.length; index += 1) {
    if (bytes[index] !== pngSignature[index]) {
      return false;
    }
  }

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32BE(bytes, offset);
    const chunkType = readAscii(bytes, offset + 4, 4);
    const nextOffset = offset + 12 + chunkLength;

    if (nextOffset > bytes.length) {
      return false;
    }

    if (chunkType === "acTL") {
      return true;
    }

    if (chunkType === "IEND") {
      return false;
    }

    offset = nextOffset;
  }

  return false;
}

function isAnimatedGif(bytes: Uint8Array): boolean {
  if (bytes.length < 13) {
    return false;
  }

  const header = readAscii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") {
    return false;
  }

  let offset = 13;
  const packed = bytes[10] ?? 0;
  if ((packed & 0x80) !== 0) {
    offset += 3 * (1 << ((packed & 0x07) + 1));
  }

  let frameCount = 0;
  while (offset < bytes.length) {
    const blockType = bytes[offset];

    if (blockType === 0x3b) {
      return false;
    }

    if (blockType === 0x2c) {
      frameCount += 1;
      if (frameCount > 1) {
        return true;
      }

      if (offset + 10 > bytes.length) {
        return false;
      }

      const imagePacked = bytes[offset + 9] ?? 0;
      offset += 10;

      if ((imagePacked & 0x80) !== 0) {
        offset += 3 * (1 << ((imagePacked & 0x07) + 1));
      }

      if (offset >= bytes.length) {
        return false;
      }

      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }

    if (blockType === 0x21) {
      offset = skipGifExtension(bytes, offset);
      continue;
    }

    return false;
  }

  return false;
}

function skipGifExtension(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) {
    return bytes.length;
  }

  return skipGifSubBlocks(bytes, offset + 2);
}

function skipGifSubBlocks(bytes: Uint8Array, offset: number): number {
  let cursor = offset;

  while (cursor < bytes.length) {
    const blockSize = bytes[cursor];
    cursor += 1;

    if (blockSize === 0) {
      return cursor;
    }

    cursor += blockSize;
  }

  return bytes.length;
}

function isAnimatedWebP(bytes: Uint8Array): boolean {
  if (bytes.length < 12) {
    return false;
  }

  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = readAscii(bytes, offset, 4);
    const chunkLength = readUint32LE(bytes, offset + 4);
    const chunkDataOffset = offset + 8;
    const paddedLength = chunkLength + (chunkLength % 2);
    const nextOffset = chunkDataOffset + paddedLength;

    if (nextOffset > bytes.length) {
      return false;
    }

    if (chunkType === "ANIM" || chunkType === "ANMF") {
      return true;
    }

    if (chunkType === "VP8X" && chunkLength >= 1) {
      const featureFlags = bytes[chunkDataOffset] ?? 0;
      if ((featureFlags & 0x02) !== 0) {
        return true;
      }
    }

    offset = nextOffset;
  }

  return false;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    return "";
  }

  let result = "";
  for (let index = offset; index < offset + length; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0);
  }

  return result;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    return 0;
  }

  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    return 0;
  }

  return (
    (bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    (bytes[offset + 3] ?? 0) * 0x1000000
  );
}
