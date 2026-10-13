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

async function readStableImage(image) {
  let previous = await readFile(image);
  let matchingReads = 0;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const current = await readFile(image);
    if (current.length > 0 && current.equals(previous)) {
      matchingReads += 1;
      if (matchingReads === 2) return current;
    } else {
      matchingReads = 0;
    }
    previous = current;
  }

  throw new Error("Image did not stabilize within 500ms");
}

export async function validateImage(image, root, stable = false) {
  try {
    // Vite's hot-update reader returns UTF-8 text, so binary assets need their
    // own stable snapshot. The bytes validated here are never reopened.
    const contents = stable ? await readStableImage(image) : await readFile(image);
    imageSize(contents);
  } catch (error) {
    const displayPath = relative(root, image) || image;
    throw new Error(`Invalid image ${displayPath}: ${error.message}`);
  }
}
