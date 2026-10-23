// The Community Management setting (organizationPosting) on the schema form.
//
// This replaces the bundled form's checkbox test. The setting is now a schema
// `boolean` field that the host draws as a Switch, directly after the Client ID
// and the Client secret. The connect step chooses LinkedIn's company page
// scopes only when the shared "linkedin" row holds the boolean `true` (the
// nango connector's `getLinkedInClientCredentials` reads
// `stored.organizationPosting === true`, and the LinkedIn connector's
// `readAdminOwnedSettings` reads it the same way). These tests pin that a save
// with the Switch on writes exactly that boolean, that off or a missing value
// does not select the page scopes, and that a reload and an unchanged second
// save keep the stored value.
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { register } from "../register";
import { makeFakeHostConfig, makeHostCtx } from "./fake-host-config";

type Field = Record<string, unknown>;

const LABEL = "This app has the Community Management API (post to company pages)";
const HELP =
  "Turn this on only for an app whose one product is the Community Management API. " +
  "Connecting then asks LinkedIn for company page permissions instead of sign-in permissions. " +
  "After changing it, reconnect each LinkedIn account.";

// The connect step's reading of the row: only a stored boolean true selects
// the company page scopes.
const selectsPageScopes = (row: Record<string, unknown> | null): boolean =>
  row?.organizationPosting === true;

// The store is the raw-text fake of the host (fake-host-config.ts): the
// actions write only through its atomic update.
function makeCtx(initial: Record<string, unknown> | null) {
  const fake = makeFakeHostConfig();
  if (initial !== null) fake.setRaw("linkedin", JSON.stringify(initial));
  const { call } = makeHostCtx(register, { store: fake.svc });
  return {
    call,
    get row() {
      return (fake.rowOf("linkedin") ?? null) as Record<string, unknown> | null;
    },
  };
}

const fields = (
  pkg as unknown as { cinatra: { configSchema?: { fields?: Field[] } } }
).cinatra.configSchema?.fields ?? [];

describe("organizationPosting on the schema form", () => {
  it("is a boolean field with the Community Management label and help text, off by default", () => {
    const field = fields.find((f) => f.key === "organizationPosting");
    expect(field).toEqual({
      kind: "boolean",
      key: "organizationPosting",
      label: LABEL,
      defaultValue: false,
      description: HELP,
    });
  });

  it("sits directly after the Client ID and the Client secret", () => {
    const keys = fields.filter((f) => typeof f.key === "string").map((f) => f.key);
    const at = keys.indexOf("organizationPosting");
    expect(at).toBeGreaterThanOrEqual(2);
    expect(keys.slice(at - 2, at + 1)).toEqual(["clientId", "clientSecret", "organizationPosting"]);
  });

  it("a save with the Switch on stores the boolean true, which selects the page scopes", async () => {
    const h = makeCtx({});
    await h.call("saveConnection", { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: "true" });
    expect(h.row?.organizationPosting).toBe(true);
    expect(selectsPageScopes(h.row)).toBe(true);
  });

  it("a save with the Switch off stores false, which does not select the page scopes", async () => {
    const h = makeCtx({ clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: true });
    // The hydrated form posts the stored Client ID, the proof that lets the flag change.
    await h.call("saveConnection", { clientId: "cm-id", clientSecret: "", organizationPosting: "false" });
    expect(h.row?.organizationPosting).toBe(false);
    expect(selectsPageScopes(h.row)).toBe(false);
  });

  it("a missing value does not select the page scopes", async () => {
    const h = makeCtx({});
    await h.call("saveConnection", { clientId: "openid-id", clientSecret: "openid-secret" });
    expect(h.row && "organizationPosting" in h.row).toBe(false);
    expect(selectsPageScopes(h.row)).toBe(false);
    expect(selectsPageScopes(null)).toBe(false);
  });

  it("only the boolean true selects the page scopes, never a stored string", async () => {
    const h = makeCtx({ clientId: "a", clientSecret: "s", organizationPosting: "true" });
    expect(selectsPageScopes(h.row)).toBe(false);
    expect(await h.call("currentConfig")).toMatchObject({ organizationPosting: false });
  });

  it("after a reload the form shows the stored value, and an unchanged second save keeps it", async () => {
    const h = makeCtx({});
    await h.call("saveConnection", { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: "true" });
    const hydrated = (await h.call("currentConfig")) as Record<string, unknown>;
    expect(hydrated.organizationPosting).toBe(true);
    // The host sends hydrated booleans to the Switch as "true"/"false", and the
    // Switch's hidden input posts that text on the next save, with the hydrated
    // Client ID.
    await h.call("saveConnection", {
      clientId: String(hydrated.clientId),
      clientSecret: "",
      organizationPosting: String(hydrated.organizationPosting),
    });
    expect(h.row?.organizationPosting).toBe(true);
    expect(selectsPageScopes(h.row)).toBe(true);
  });

  it("Disconnect removes the flag, so the page scopes are no longer selected", async () => {
    const h = makeCtx({ clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: true, accounts: [] });
    await h.call("clearConnection");
    expect(selectsPageScopes(h.row)).toBe(false);
    expect(h.row).toEqual({ accounts: [] });
  });
});
