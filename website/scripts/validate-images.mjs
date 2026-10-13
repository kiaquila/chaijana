import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRasterImage, validateImage } from "./image-validation.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const ignoredRootDirectories = new Set([
  ".next",
  ".pnp",
  ".vercel",
  ".vinext",
  ".wrangler",
  ".yarn",
  "coverage",
  "dist",
  "out",
  "outputs",
  "work",
]);
const ignoredAtAnyDepth = new Set(["node_modules"]);
async function collectImages(input, images, scanRoot) {
  const metadata = await stat(input);
  if (metadata.isFile()) {
    if (isRasterImage(input)) images.push(input);
    return;
  }

  if (!metadata.isDirectory()) return;
  const directoryName = basename(input);
  const isRootOutput = dirname(input) === scanRoot && ignoredRootDirectories.has(directoryName);
  if (ignoredAtAnyDepth.has(directoryName) || isRootOutput) return;
  const entries = await readdir(input, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await collectImages(resolve(input, entry.name), images, scanRoot);
  }
}

async function main() {
  const requestedInputs = process.argv.slice(2);
  const inputs = requestedInputs.length > 0
    ? requestedInputs.map((input) => resolve(process.cwd(), input))
    : [root];
  const images = [];

  for (const input of inputs) await collectImages(input, images, input);
  for (const image of images) await validateImage(image, root);

  console.log(`Validated ${images.length} raster images.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
