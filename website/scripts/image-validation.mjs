import { readFile } from "node:fs/promises";
import { extname, relative } from "node:path";
import { imageSize } from "image-size";

const rasterExtensions = new Set([
  ".avif",
  ".bmp",
  ".cur",
  ".dds",
  ".gif",
  ".heic",
  ".heif",
  ".icns",
  ".ico",
  ".j2c",
  ".jp2",
  ".jpeg",
  ".jpg",
  ".jxl",
  ".ktx",
  ".png",
  ".psd",
  ".tga",
  ".tif",
  ".tiff",
  ".webp",
]);

export function isRasterImage(path) {
  return rasterExtensions.has(extname(path).toLowerCase());
}

export async function validateImage(image, root, stabilize) {
  try {
    // Vite's hot-update reader retries empty editor writes, but returns UTF-8
    // text. Await it as a barrier, then reopen the image without corrupting bytes.
    if (stabilize) await stabilize();
    imageSize(await readFile(image));
  } catch (error) {
    const displayPath = relative(root, image) || image;
    throw new Error(`Invalid image ${displayPath}: ${error.message}`);
  }
}
