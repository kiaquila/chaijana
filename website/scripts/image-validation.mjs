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

export async function validateImage(image, root) {
  try {
    imageSize(await readFile(image));
  } catch (error) {
    const displayPath = relative(root, image) || image;
    throw new Error(`Invalid image ${displayPath}: ${error.message}`);
  }
}
