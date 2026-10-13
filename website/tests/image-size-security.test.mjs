import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
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

test("runs image validation before the Vinext build", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.match(
    packageJson.scripts.build,
    /^npm run sync:menu && npm run validate:images && .*vinext build$/,
  );
});
