import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectories = new Set([
  ".next",
  ".pnp",
  ".vercel",
  ".vinext",
  ".wrangler",
  ".yarn",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "outputs",
  "work",
]);
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

async function collectImages(input, images) {
  const metadata = await stat(input);
  if (metadata.isFile()) {
    if (rasterExtensions.has(extname(input).toLowerCase())) images.push(input);
    return;
  }

  if (!metadata.isDirectory()) return;
  if (input !== root && ignoredDirectories.has(basename(input))) return;
  const entries = await readdir(input, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await collectImages(resolve(input, entry.name), images);
  }
}

async function main() {
  const requestedInputs = process.argv.slice(2);
  const inputs = requestedInputs.length > 0
    ? requestedInputs.map((input) => resolve(process.cwd(), input))
    : [root];
  const images = [];

  for (const input of inputs) await collectImages(input, images);
  for (const image of images) {
    try {
      imageSize(await readFile(image));
    } catch (error) {
      const displayPath = relative(root, image) || image;
      throw new Error(`Invalid image ${displayPath}: ${error.message}`);
    }
  }

  console.log(`Validated ${images.length} raster images.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
