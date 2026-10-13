import { isAbsolute } from "node:path";
import { isRasterImage, validateImage } from "../scripts/image-validation.mjs";

function fileFromModuleId(id) {
  return id.replace(/[?#].*$/, "");
}

export function imageValidation() {
  let root = process.cwd();

  async function validate(file, stable = false) {
    if (isRasterImage(file)) await validateImage(file, root, stable);
  }

  return {
    name: "image-validation",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async load(id) {
      const file = fileFromModuleId(id);
      if (isAbsolute(file)) await validate(file);
      return null;
    },
    async hotUpdate({ type, file }) {
      if (type !== "delete") await validate(file, true);
    },
  };
}
