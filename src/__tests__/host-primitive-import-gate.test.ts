import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateCommon } from "../../extension-kind-gate.mjs";

const fixtures: string[] = [];
const MODULE = "@cinatra-ai/design-primitives";
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

function errorsFor(specifier: string, dependency?: string) {
  const root = mkdtempSync(join(tmpdir(), "primitive-import-"));
  fixtures.push(root);
  mkdirSync(join(root, "src"));
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  manifest.dependencies = dependency ? { [dependency]: "*" } : {};
  manifest.peerDependencies = {};
  manifest.optionalDependencies = {};
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "src", "index.ts"), `import { Button } from ${JSON.stringify(specifier)}; export { Button };`);
  return validateCommon(root).errors.filter((error: string) => /first-party dependency|host-internal import/.test(error));
}

describe("host-served primitive import classification", () => {
  it("accepts the exact virtual module as a source import", () => {
    expect(errorsFor(MODULE)).toEqual([]);
  });
  it.each([`${MODULE}/button`, `${MODULE}-other`, "@cinatra-ai/agents"])("still rejects %s", (specifier) => {
    expect(errorsFor(specifier)).toEqual([expect.stringContaining("non-SDK first-party dependency")]);
  });
  it("keeps rejecting the virtual module as a registry dependency", () => {
    expect(errorsFor(MODULE, MODULE)).toEqual([expect.stringContaining("non-SDK first-party dependency")]);
  });
  it("keeps host-internal imports forbidden", () => {
    expect(errorsFor("@/components/ui/button")).toEqual([expect.stringContaining("host-internal import")]);
  });
});
