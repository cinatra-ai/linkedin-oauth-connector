// register(ctx) registers the named actions the setup form calls by id. The
// host endpoint authorizes only the "use" tier, so the handlers that read or
// change the stored credentials must re-check "manage" and fail closed.
// Saving merges into the shared "linkedin" row through the host's atomic
// update: every key this form does not own (accounts, loggingEnabled,
// redirectUri) must survive. The store is the raw-text fake of the host
// (fake-host-config.ts).
import { describe, expect, it, vi } from "vitest";
import { register } from "../register";
import { makeFakeHostConfig, makeHostCtx } from "./fake-host-config";

type GuardMode = "allow" | "missing" | "throws";

const KEY = "linkedin";

function makeCtx(opts: {
  row?: Record<string, unknown> | null;
  guard?: GuardMode;
  nango?: "absent" | "no-method" | string;
}) {
  const fake = makeFakeHostConfig();
  // A null row is a missing row.
  const initial = opts.row === undefined ? {} : opts.row;
  if (initial !== null) fake.setRaw(KEY, JSON.stringify(initial));
  const guardRequire = vi.fn(async (_pkg: string, mode: string): Promise<void> => {
    if (opts.guard === "throws") throw new Error(`denied ${mode}`);
  });
  const guard = (opts.guard ?? "allow") === "missing" ? undefined : { require: guardRequire };
  const nangoOpt = opts.nango ?? "absent";
  const nango =
    nangoOpt === "absent"
      ? undefined
      : nangoOpt === "no-method"
        ? {}
        : { getNangoOAuthCallbackUrl: async () => nangoOpt };
  const { actions, call } = makeHostCtx(register, { store: fake.svc, guard, nango });
  const store = {
    get row() {
      return fake.rowOf(KEY) as Record<string, unknown> | undefined;
    },
    read: fake.read,
    write: fake.write,
    update: fake.update,
    delete: fake.delete,
  };
  return { actions, call, store, fake, guardRequire };
}

const STORED = {
  clientId: "a",
  clientSecret: "s",
  accounts: [{ id: "x" }],
  loggingEnabled: true,
  redirectUri: "https://r",
};

describe("linkedin-oauth-connector register(ctx) ui actions", () => {
  it("(b) a save merges into the stored row through one host update and keeps every key the form does not own", async () => {
    const { call, store, guardRequire } = makeCtx({ row: STORED });
    await expect(
      call("saveConnection", { clientId: "b", clientSecret: "" }),
    ).resolves.toEqual({ banner: "saved" });
    expect(guardRequire).toHaveBeenCalledWith("@cinatra-ai/linkedin-oauth-connector", "manage");
    expect(store.row).toEqual({
      clientId: "b",
      clientSecret: "s",
      accounts: [{ id: "x" }],
      loggingEnabled: true,
      redirectUri: "https://r",
    });
    expect(store.update).toHaveBeenCalledTimes(1);
    expect(store.update.mock.calls[0][0]).toBe("linkedin");
    expect(store.write).not.toHaveBeenCalled();
  });

  it("(c) organizationPosting: \"false\" with the stored Client ID turns it off, an omitted key or other text leaves it", async () => {
    const off = makeCtx({ row: { ...STORED, organizationPosting: true } });
    await off.call("saveConnection", { clientId: "a", organizationPosting: "false" });
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
      expect(store.update).not.toHaveBeenCalled();
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

  it("(j) currentConfig performs no write, no update and no delete", async () => {
    const { call, store } = makeCtx({ row: STORED, nango: "https://nango.example/oauth/callback" });
    await call("currentConfig");
    expect(store.write).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(store.row).toEqual(STORED);
  });

  it("helpContentReady is always ready", async () => {
    await expect(makeCtx({}).call("helpContentReady")).resolves.toEqual({ ready: true });
  });
});
