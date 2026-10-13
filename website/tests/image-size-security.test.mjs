import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { imageValidation } from "../build/image-validation.mjs";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const validator = fileURLToPath(new URL("scripts/validate-images.mjs", root));

function box(type, payload = Buffer.alloc(0), declaredSize = 8 + payload.length) {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(declaredSize, 0);
  result.write(type, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

const malformedImages = {
  heif: {
    expected: "Invalid HEIF ispe box size",
    payload: Buffer.concat([
      box("ftyp", Buffer.from("avif\0\0\0\0", "binary")),
      box(
        "meta",
        Buffer.concat([
          Buffer.alloc(4),
          box("iprp", box("ipco", Buffer.concat([box("ispe", Buffer.alloc(12), 0)]))),
        ]),
      ),
    ]),
  },
  icns: {
    expected: "Invalid ICNS entry length",
    payload: Buffer.from("69636e73000000106963303700000000", "hex"),
  },
  jxl: {
    expected: "Invalid JXL partial codestream box size",
    payload: Buffer.concat([
      box("JXL ", Buffer.from("0d0a870a", "hex")),
      box("ftyp", Buffer.from("jxl \0\0\0\0jxl ", "binary")),
      box("jxlp", Buffer.alloc(4), 0),
    ]),
  },
};

for (const [format, { expected, payload }] of Object.entries(malformedImages)) {
  test(`rejects the non-progressing ${format} payload before Vinext runs`, async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "chaijana-image-validator-"));
    const imagePath = join(temporaryRoot, `malformed.${format}`);
    await writeFile(imagePath, payload);

    const result = spawnSync(process.execPath, [validator, imagePath], {
      cwd: root,
      encoding: "utf8",
      timeout: 1_000,
    });

    await rm(temporaryRoot, { recursive: true, force: true });
    assert.equal(result.error, undefined, `${format} validator did not terminate`);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, new RegExp(expected));
  });
}

test("scans build-reachable images outside app and public", async () => {
  const temporaryRoot = await mkdtemp(join(rootPath, ".image-validation-fixture-"));
  const sourceDirectory = join(temporaryRoot, "app", "work");
  const imagePath = join(sourceDirectory, "malformed.jxl");

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(imagePath, malformedImages.jxl.payload);
    const result = spawnSync(process.execPath, [validator, temporaryRoot], {
      cwd: root,
      encoding: "utf8",
      timeout: 2_000,
    });

    assert.equal(result.error, undefined, "project-wide validator did not terminate");
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /Invalid JXL partial codestream box size/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("ignores documented local output directories", async () => {
  const temporaryRoot = await mkdtemp(join(rootPath, ".image-output-fixture-"));

  try {
    for (const directory of [".vercel", "out", "outputs", "work"]) {
      const outputDirectory = join(temporaryRoot, directory);
      await mkdir(outputDirectory);
      await writeFile(join(outputDirectory, "malformed.jxl"), malformedImages.jxl.payload);
    }

    const result = spawnSync(process.execPath, [validator, temporaryRoot], {
      cwd: root,
      encoding: "utf8",
      timeout: 2_000,
    });

    assert.equal(result.error, undefined, "project-wide validator did not terminate");
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("ignores root outputs during the default scan", async () => {
  const outputRoot = join(rootPath, ".wrangler");
  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(join(outputRoot, "image-output-fixture-"));

  try {
    await writeFile(join(temporaryRoot, "malformed.jxl"), malformedImages.jxl.payload);
    const result = spawnSync(process.execPath, [validator], {
      cwd: root,
      encoding: "utf8",
      timeout: 2_000,
    });

    assert.equal(result.error, undefined, "default validator did not terminate");
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("revalidates raster images changed after the dev server starts", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "chaijana-image-watch-"));
  const imagePath = join(temporaryRoot, "changed.jxl");
  await writeFile(imagePath, Buffer.alloc(0));
  const plugin = imageValidation();
  plugin.configResolved({ root: rootPath });

  try {
    assert.equal(plugin.enforce, "pre");
    const validation = plugin.hotUpdate({ type: "update", file: imagePath });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await writeFile(imagePath, malformedImages.jxl.payload);
    await assert.rejects(
      validation,
      /Invalid JXL partial codestream box size/,
    );
    await assert.rejects(
      plugin.load(`${imagePath}?import`),
      /Invalid JXL partial codestream box size/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("runs image validation before the Vinext build", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.match(
    packageJson.scripts.build,
    /^npm run sync:menu && npm run validate:images && .*vinext build$/,
  );
});
