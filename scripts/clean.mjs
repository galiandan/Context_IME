import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Delete only reproducible build/test intermediates. Keep VSIX, reports, vendor
// resources, dependencies and all user/global authentication stores.
for (const relative of ["dist/", "out/", "artifacts/tmp/"]) {
  const path = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  rmSync(path, { recursive: true, force: true });
  console.log(`Removed ${relative}`);
}
