// register(ctx) registers the schema-config named actions the setup form calls
// by id. The host endpoint authorizes only the "use" tier, so the handlers that
// read or change the stored credentials must re-check "manage" and fail closed.
// Saving merges into the shared "linkedin" row: every key this form does not
// own (accounts, loggingEnabled, redirectUri) must survive.
import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { register } from "../register";

type UiAction = { id: string; handler: (input?: unknown) => Promise<unknown> };

function makeStore(initial: Record<string, unknown> | null) {
  let row: Record<string, unknown> | null = initial === null ? null : structuredClone(initial);
  const read = vi.fn(<T,>(_id: string, fallback: T): T => (row === null ? fallback : (structuredClone(row) as T)));
  const write = vi.fn((_id: string, value: unknown) => {
    row = structuredClone(value) as Record<string, unknown>;
  });
  const del = vi.fn();
  return { svc: { read, write, delete: del }, get row() { return row; }, read, write };
}

type GuardMode = "allow" | "missing" | "throws";

function makeCtx(opts: {
  row?: Record<string, unknown> | null;
  guard?: GuardMode;
  nango?: "absent" | "no-method" | string;
}) {
  const store = makeStore(opts.row === undefined ? {} : opts.row);
  const guardRequire = vi.fn(async (_pkg: string, mode: string) => {
    if (opts.guard === "throws") throw new Error(`denied ${mode}`);
  });
  const services: Record<string, unknown> = { "@cinatra-ai/host:connector-config": store.svc };
  if ((opts.guard ?? "allow") !== "missing") {
    services["@cinatra-ai/host:extension-action-guard"] = { require: guardRequire };
  }
  const actions = new Map<string, UiAction>();
  const ctx: Record<string, unknown> = {
    capabilities: {
      registerProvider: () => {},
      resolveProviders: (capability: string) => {
        const impl = services[capability];
        return impl ? [{ packageName: "host", impl }] : [];
      },
    },
    ui: {
      registerSetupSurface: () => {},
      registerSettingsSurface: () => {},
      registerAction: (a: UiAction) => {
        actions.set(a.id, a);
      },
    },
  };
  const nango = opts.nango ?? "absent";
  if (nango === "no-method") ctx.nango = {};
  else if (nango !== "absent") ctx.nango = { getNangoOAuthCallbackUrl: async () => nango };
  register(ctx as unknown as Parameters<typeof register>[0]);
  const call = (id: string, input?: unknown) => {
    const a = actions.get(id);
    if (!a) throw new Error(`action ${id} not registered`);
    return a.handler(input);
  };
  return { actions, call, store, guardRequire };
}

const STORED = {
  clientId: "a",
  clientSecret: "s",
  accounts: [{ id: "x" }],
  loggingEnabled: true,
  redirectUri: "https://r",
};

function schemaActionIds(): Set<string> {
  const ids = new Set<string>();
  const schema = (pkg as unknown as { cinatra: { configSchema: Record<string, unknown> } }).cinatra.configSchema;
  const visit = (fields: Array<Record<string, unknown>>) => {
    for (const f of fields) {
      for (const k of ["actionId", "probeActionId"]) if (typeof f[k] === "string") ids.add(f[k] as string);
    }
  };
  if (typeof schema.hydrateAction === "string") ids.add(schema.hydrateAction);
  visit(schema.fields as Array<Record<string, unknown>>);
  for (const t of (schema.tabs as Array<{ fields: Array<Record<string, unknown>> }>) ?? []) visit(t.fields);
  return ids;
}

describe("linkedin-oauth-connector register(ctx) ui actions", () => {
  it("(a) registers exactly the actions the configSchema references", () => {
    const { actions } = makeCtx({});
    const expected = ["currentConfig", "connectionStatus", "saveConnection", "clearConnection", "helpContentReady"];
    expect([...actions.keys()].sort()).toEqual([...expected].sort());
    expect([...schemaActionIds()].sort()).toEqual([...expected].sort());
  });

  it("(b) a save merges into the stored row and keeps every key the form does not own", async () => {
    const { call, store, guardRequire } = makeCtx({ row: STORED });
    await expect(
      call("saveConnection", { clientId: "b", clientSecret: "", organizationPosting: "true" }),
    ).resolves.toEqual({ banner: "saved" });
    expect(guardRequire).toHaveBeenCalledWith("@cinatra-ai/linkedin-oauth-connector", "manage");
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.write.mock.calls[0][0]).toBe("linkedin");
    expect(store.row).toEqual({
      clientId: "b",
      clientSecret: "s",
      organizationPosting: true,
      accounts: [{ id: "x" }],
      loggingEnabled: true,
      redirectUri: "https://r",
    });
  });

  it("(c) organizationPosting: \"false\" turns it off, an omitted key or other text leaves it", async () => {
    const off = makeCtx({ row: { ...STORED, organizationPosting: true } });
    await off.call("saveConnection", { organizationPosting: "false" });
    expect(off.store.row?.organizationPosting).toBe(false);

    const omitted = makeCtx({ row: { ...STORED, organizationPosting: true } });
    await omitted.call("saveConnection", { clientId: "c" });
    expect(omitted.store.row?.organizationPosting).toBe(true);
    expect(omitted.store.row?.clientId).toBe("c");

    const yes = makeCtx({ row: { ...STORED, organizationPosting: true } });
    await yes.call("saveConnection", { organizationPosting: "yes" });
    expect(yes.store.row?.organizationPosting).toBe(true);

    const yesFromUnset = makeCtx({ row: STORED });
    await yesFromUnset.call("saveConnection", { organizationPosting: "yes" });
    expect(yesFromUnset.store.row).toEqual(STORED);
  });

  it("(d) whitespace-only credentials keep both stored values", async () => {
    const { call, store } = makeCtx({ row: STORED });
    await call("saveConnection", { clientId: "   ", clientSecret: " \t " });
    expect(store.row?.clientId).toBe("a");
    expect(store.row?.clientSecret).toBe("s");
    expect(store.row?.accounts).toEqual([{ id: "x" }]);
  });

  for (const guard of ["missing", "throws"] as const) {
    it(`(e) a ${guard} guard rejects currentConfig, saveConnection and clearConnection before any store access`, async () => {
      const { call, store } = makeCtx({ row: STORED, guard });
      await expect(call("saveConnection", { clientId: "b", clientSecret: "z" })).rejects.toThrow();
      await expect(call("clearConnection")).rejects.toThrow();
      await expect(call("currentConfig")).rejects.toThrow();
      expect(store.read).not.toHaveBeenCalled();
      expect(store.write).not.toHaveBeenCalled();
      expect(store.row).toEqual(STORED);
    });
  }

  it("(f) currentConfig never returns clientSecret, and only a stored boolean true reads as on", async () => {
    const on = makeCtx({ row: { ...STORED, organizationPosting: true } });
    const r1 = (await on.call("currentConfig")) as Record<string, unknown>;
    expect(r1).not.toHaveProperty("clientSecret");
    expect(r1.clientId).toBe("a");
    expect(r1.organizationPosting).toBe(true);

    const str = makeCtx({ row: { ...STORED, organizationPosting: "true" } });
    const r2 = (await str.call("currentConfig")) as Record<string, unknown>;
    expect(r2).not.toHaveProperty("clientSecret");
    expect(r2.organizationPosting).toBe(false);

    const empty = makeCtx({ row: null });
    const r3 = (await empty.call("currentConfig")) as Record<string, unknown>;
    expect(r3).toEqual({ organizationPosting: false });
  });

  it("(g) redirectUri comes from the nango callback, else the stored value", async () => {
    const withNango = makeCtx({ row: STORED, nango: "https://nango.example/oauth/callback" });
    expect(((await withNango.call("currentConfig")) as Record<string, unknown>).redirectUri).toBe(
      "https://nango.example/oauth/callback",
    );
    const noNango = makeCtx({ row: STORED, nango: "absent" });
    expect(((await noNango.call("currentConfig")) as Record<string, unknown>).redirectUri).toBe("https://r");
    const noMethod = makeCtx({ row: STORED, nango: "no-method" });
    expect(((await noMethod.call("currentConfig")) as Record<string, unknown>).redirectUri).toBe("https://r");
  });

  it("(h) clearConnection removes only the credentials and the flag", async () => {
    const { call, store } = makeCtx({ row: { ...STORED, organizationPosting: true } });
    await expect(call("clearConnection")).resolves.toEqual({ banner: "cleared" });
    expect(store.row).toEqual({ accounts: [{ id: "x" }], loggingEnabled: true, redirectUri: "https://r" });
  });

  it("(i) connectionStatus throws for neither or one credential and resolves for both", async () => {
    await expect(makeCtx({ row: {} }).call("connectionStatus")).rejects.toThrow("LinkedIn OAuth is not configured.");
    await expect(makeCtx({ row: null }).call("connectionStatus")).rejects.toThrow("LinkedIn OAuth is not configured.");
    await expect(makeCtx({ row: { clientId: "a" } }).call("connectionStatus")).rejects.toThrow(
      "Save both the Client ID and the Client secret.",
    );
    await expect(makeCtx({ row: { clientSecret: "s", clientId: "  " } }).call("connectionStatus")).rejects.toThrow(
      "Save both the Client ID and the Client secret.",
    );
    await expect(makeCtx({ row: STORED }).call("connectionStatus")).resolves.toEqual({
      detail: "Client ID and secret saved.",
    });
  });

  it("(j) currentConfig performs no write", async () => {
    const { call, store } = makeCtx({ row: STORED, nango: "https://nango.example/oauth/callback" });
    await call("currentConfig");
    expect(store.write).not.toHaveBeenCalled();
    expect(store.svc.delete).not.toHaveBeenCalled();
    expect(store.row).toEqual(STORED);
  });

  it("helpContentReady is always ready", async () => {
    await expect(makeCtx({}).call("helpContentReady")).resolves.toEqual({ ready: true });
  });
});
