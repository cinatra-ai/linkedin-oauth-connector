// Regression guard: the package passes the vendored extension kind gate (the
// self-contained validator the required `kind-gates` CI job runs). The schema
// uses the `boolean` field kind, named-action roles, tabs and a root
// hydrateAction, which an older vendored gate rejects, so the gate must stay
// re-vendored from the canonical copy.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runGate, validateConfigSchema } from "../../extension-kind-gate.mjs";
import pkg from "../../package.json" with { type: "json" };

// resolve() drops the trailing slash the URL form leaves (the gate joins paths
// inside this root and refuses a root that ends in "/").
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("vendored extension kind gate", () => {
  it("reports zero errors for this package", () => {
    const { kind, errors } = runGate(PACKAGE_ROOT);
    expect(kind).toBe("connector");
    expect(errors).toEqual([]);
  });

  it("knows every vocabulary feature the configSchema uses", () => {
    const schema = (pkg as unknown as { cinatra: { configSchema: Record<string, unknown> } }).cinatra.configSchema;
    expect(schema.hydrateAction).toBeTypeOf("string");
    expect(Array.isArray(schema.tabs)).toBe(true);
    const fields = schema.fields as Array<Record<string, unknown>>;
    expect(fields.some((f) => f.kind === "boolean")).toBe(true);
    expect(fields.some((f) => typeof f.role === "string")).toBe(true);
    expect(validateConfigSchema(schema)).toEqual([]);
  });
});
