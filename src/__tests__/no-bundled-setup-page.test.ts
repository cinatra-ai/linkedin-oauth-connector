// Regression guard: the connector's setup page is the host's generic schema
// form (uiSurface "schema-config"). The bundled React page, its form, its
// server action, their helpers and the UI dependencies only they used are
// deleted, and nothing under src/ may bring them back.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preProcessFile } from "typescript";
import { describe, expect, it } from "vitest";

// resolve() drops the trailing slash the URL form leaves (the gate joins paths
// inside this root and refuses a root that ends in "/").
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SOURCE_ROOT = join(PACKAGE_ROOT, "src");

const DELETED_PATHS = [
  "src/setup-page.tsx",
  "src/settings-panel.tsx",
  "src/settings-form.tsx",
  "src/actions.ts",
  "src/ui/text-link.tsx",
  "src/lib/utils.ts",
  "src/__tests__/fixtures/design-primitives.tsx",
];

const REMOVED_DEPENDENCIES = [
  "class-variance-authority",
  "clsx",
  "lucide-react",
  "radix-ui",
  "tailwind-merge",
  "zod",
  "next",
  "react",
  "react-dom",
  "@cinatra-ai/sdk-ui",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(file);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
  });
}

function isBanned(spec: string): boolean {
  return (
    spec === "@cinatra-ai/design-primitives" ||
    spec.startsWith("@cinatra-ai/design-primitives/") ||
    spec.startsWith("@/") ||
    spec === "react" ||
    spec.startsWith("react/") ||
    spec === "react-dom" ||
    spec.startsWith("react-dom/") ||
    spec === "clsx" ||
    spec === "tailwind-merge"
  );
}

describe("no bundled setup page", () => {
  it("the bundled page files, their helpers and the test fixture are gone", () => {
    for (const p of DELETED_PATHS) expect(existsSync(join(PACKAGE_ROOT, p)), p).toBe(false);
  });

  it("vitest.config.ts carries no design-primitives alias", () => {
    expect(readFileSync(join(PACKAGE_ROOT, "vitest.config.ts"), "utf8")).not.toContain("design-primitives");
  });

  it("package.json declares none of the UI dependencies the deleted page needed", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    const keys = ["dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta"].flatMap((field) =>
      Object.keys(manifest[field] ?? {}),
    );
    for (const dep of REMOVED_DEPENDENCIES) expect(keys, dep).not.toContain(dep);
  });

  it("no source file imports a UI module, a host-internal path, or the SDK as a value", () => {
    const files = sourceFiles(SOURCE_ROOT);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const rel = relative(SOURCE_ROOT, file);
      for (const { fileName } of preProcessFile(text, true, true).importedFiles) {
        if (isBanned(fileName)) offenders.push(`${rel}: ${fileName}`);
      }
      // Every import or re-export of @cinatra-ai/sdk-extensions must be type-only.
      const sdkStatements =
        text.match(/^\s*(?:import|export)\b[^;]*?from\s*["']@cinatra-ai\/sdk-extensions["']/gms) ?? [];
      for (const stmt of sdkStatements) {
        if (!/^\s*(?:import|export)\s+type\b/.test(stmt)) offenders.push(`${rel}: value import of @cinatra-ai/sdk-extensions`);
      }
      if (/^\s*import\s*["']@cinatra-ai\/sdk-extensions["']/m.test(text)) {
        offenders.push(`${rel}: side-effect import of @cinatra-ai/sdk-extensions`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
