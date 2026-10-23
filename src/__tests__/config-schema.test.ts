// Contract for the declarative setup surface (cinatra.configSchema).
//
// The connector declares `uiSurface: "schema-config"`, so the host draws its
// setup page from this data with the shared generic schema form. These tests
// pin the manifest shape and prove the schema passes the same fail-closed
// `validateConfigSchema` the repo's vendored `extension-kind-gate.mjs` runs in
// CI (the rules-only port of the host's parser).
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { validateConfigSchema } from "../../extension-kind-gate.mjs";

type Field = Record<string, unknown>;
type Tab = { id: string; label: string; fields: Field[] };
type Schema = { title?: string; description?: string; hydrateAction?: string; fields: Field[]; tabs?: Tab[] };

const manifest = pkg as unknown as {
  exports?: Record<string, string>;
  cinatra: Record<string, unknown> & { configSchema?: Schema };
};
const cinatra = manifest.cinatra;
const schema = cinatra.configSchema as Schema;

describe("linkedin-oauth-connector cinatra.configSchema", () => {
  it('declares uiSurface "schema-config", the ./register server entry and the host ports', () => {
    expect(cinatra.uiSurface).toBe("schema-config");
    expect(cinatra.serverEntry).toBe("./register");
    const ports = cinatra.requestedHostPorts as string[];
    for (const port of ["nango", "capabilities", "ui"]) expect(ports).toContain(port);
  });

  it("parses with zero validation errors under the vendored kind gate", () => {
    expect(validateConfigSchema(schema)).toEqual([]);
  });

  it("opts in to hydration through currentConfig", () => {
    expect(schema.hydrateAction).toBe("currentConfig");
  });

  it("declares exactly the Setup fields of the spec, in order", () => {
    const shape = schema.fields.map((f) => ({
      kind: f.kind,
      key: f.key,
      label: f.label,
      description: f.description,
    }));
    expect(shape).toEqual([
      { kind: "banner", key: undefined, label: "Result", description: undefined },
      { kind: "text", key: "clientId", label: "Client ID", description: "The Client ID of your LinkedIn developer app." },
      { kind: "secret", key: "clientSecret", label: "Client secret", description: "Write-only — leave blank to keep the saved secret." },
      {
        kind: "boolean",
        key: "organizationPosting",
        label: "This app has the Community Management API (post to company pages)",
        description:
          "Turn this on only for an app whose one product is the Community Management API. Connecting then asks LinkedIn for company page permissions instead of sign-in permissions. After changing it, reconnect each LinkedIn account.",
      },
      {
        kind: "copyable-credential",
        key: "redirectUri",
        label: "Authorized redirect URI",
        description:
          "Register this exact URI in the LinkedIn developer app. It is derived automatically from the configured Nango server.",
      },
      {
        kind: "status-probe",
        key: undefined,
        label: "Connection",
        description: "Checks whether both the Client ID and the Client secret are saved.",
      },
      { kind: "named-action", key: undefined, label: "Connect", description: undefined },
      { kind: "named-action", key: undefined, label: "Disconnect", description: undefined },
    ]);
    const banner = schema.fields[0] as { variants: Array<{ name: string }> };
    expect(banner.variants.map((v) => v.name)).toEqual(["saved", "cleared", "error"]);
  });

  it("organizationPosting is a boolean that defaults to false", () => {
    const f = schema.fields.find((x) => x.key === "organizationPosting");
    expect(f?.kind).toBe("boolean");
    expect(f?.defaultValue).toBe(false);
  });

  it("clientSecret is a secret and redirectUri a copyable credential", () => {
    expect(schema.fields.find((x) => x.key === "clientSecret")?.kind).toBe("secret");
    expect(schema.fields.find((x) => x.key === "redirectUri")?.kind).toBe("copyable-credential");
  });

  it("the connect and disconnect roles each appear exactly once", () => {
    const roles = schema.fields.filter((f) => f.kind === "named-action").map((f) => f.role);
    expect(roles.filter((r) => r === "connect")).toHaveLength(1);
    expect(roles.filter((r) => r === "disconnect")).toHaveLength(1);
    const byRole = Object.fromEntries(
      schema.fields.filter((f) => f.kind === "named-action").map((f) => [f.role, f.actionId]),
    );
    expect(byRole).toEqual({ connect: "saveConnection", disconnect: "clearConnection" });
  });

  it("the help tab is last and holds four advisories whose two texts are equal", () => {
    const tabs = schema.tabs ?? [];
    expect(tabs.length).toBeGreaterThan(0);
    const last = tabs[tabs.length - 1];
    expect(last.id).toBe("help");
    expect(last.label).toBe("Help");
    expect(last.fields).toHaveLength(4);
    for (const f of last.fields) {
      expect(f.kind).toBe("advisory");
      expect(f.probeActionId).toBe("helpContentReady");
      expect(typeof f.whenReady).toBe("string");
      expect(f.whenReady).toBe(f.whenNotReady);
    }
  });

  it("exports ./register and no longer exports ./setup-page or ./actions", () => {
    const keys = Object.keys(manifest.exports ?? {});
    expect(keys).toContain("./register");
    expect(keys).not.toContain("./setup-page");
    expect(keys).not.toContain("./actions");
  });
});
