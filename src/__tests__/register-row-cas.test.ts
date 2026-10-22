// saveConnection and clearConnection change the shared "linkedin" row that the
// LinkedIn connector also writes (accounts, loggingEnabled, redirectUri).
//
// Rule 1 (atomic update only): a write goes through the host's `update` member,
// which reads the stored text (never this process's cache), runs the change on
// it and stores the result only if the text is unchanged; otherwise it runs the
// change again on the new row, at most five times, then refuses with
// LINKEDIN_CONFIG_CONFLICT and nothing is written. A host without a callable
// `update` refuses with LINKEDIN_CONFIG_CAS_UNAVAILABLE (no fallback to
// `write`); any other failure refuses with LINKEDIN_CONFIG_SAVE_FAILED, a fixed
// text with no stored value and no cause.
//
// Rule 2 (plain-object row): a missing or null row reads as an empty row. Any
// other stored value that is not a plain object is refused with
// LINKEDIN_CONFIG_ROW_INVALID by every action that reads the row; nothing is
// written over it. Save and clear refuse an unparseable text too.
//
// Provider identity: the store and the manage guard come only from the provider
// registered under the host's own identity, never from the first one listed.
//
// The store is the raw-text fake of the host (fake-host-config.ts). Every
// interleaving is forced by its `beforePersist(n)` hook, which fires at the
// entry of `write()` and right before each swap or insert inside `update()`, so
// each case also runs against a register.ts that still writes with `write`.
// Each title carries the label of that old road's failure ([RACE], [FAIL-OPEN],
// [LEAK], [CONTRACT]) or [REGRESSION] (green on both); the first assertion of a
// red case is the row content or the sentinel check and carries the same label.
import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "../register";
import {
  GUARD_CAP,
  HOST_PKG,
  SENTINEL,
  STORE_CAP,
  consoleSpies,
  expectNoSentinel,
  makeFakeHostConfig,
  makeHostCtx,
  outcomeOf,
} from "./fake-host-config";

const KEY = "linkedin";

const STORED = {
  clientId: "a",
  clientSecret: "s",
  organizationPosting: true,
  accounts: [{ id: "x" }],
  loggingEnabled: true,
  redirectUri: "https://r",
};
const TWO_ACCOUNTS = [{ id: "x" }, { id: "y" }];
const CLEARED = { accounts: [{ id: "x" }], loggingEnabled: true, redirectUri: "https://r" };

const ACTIONS = ["saveConnection", "clearConnection"] as const;
type WriteAction = (typeof ACTIONS)[number];
const INPUT = { clientSecret: "z" };
/** The row each action leaves, computed on `row`. */
const after = (action: WriteAction, row: Record<string, unknown>): Record<string, unknown> => {
  if (action === "saveConnection") return { ...row, clientSecret: "z" };
  const { clientId, clientSecret, organizationPosting, ...rest } = row;
  return rest;
};

const SAVE_FAILED_TEXT =
  "The LinkedIn settings could not be saved, and whether they changed is not known. Reload the page to see the stored settings.";

function setup(opts: { row?: unknown; cacheTtlMs?: number } = {}) {
  const fake = makeFakeHostConfig({ cacheTtlMs: opts.cacheTtlMs });
  if (opts.row !== undefined) fake.setRaw(KEY, JSON.stringify(opts.row));
  const ctx = makeHostCtx(register, { store: fake.svc });
  return { fake, call: ctx.call };
}

const errorOf = (out: Awaited<ReturnType<typeof outcomeOf>>) =>
  (out.done ? {} : out.error) as { name?: string; code?: string; message?: string; cause?: unknown };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("section 2: the four interleavings that lost an account (formerly it.fails)", () => {
  for (const [id, action] of [["F1", "saveConnection"], ["F2", "clearConnection"]] as const) {
    it(`(${id}) [RACE] ${action}: a write by another process that this process's cached read does not show is kept`, async () => {
      const { fake, call } = setup({ row: STORED, cacheTtlMs: 10_000 });
      // The form loads: this process reads the row and caches it.
      await expect(call("currentConfig")).resolves.toMatchObject({ clientId: "a" });
      // The LinkedIn connector, in another process, adds an account.
      fake.otherProcessWrites(KEY, { ...STORED, accounts: TWO_ACCOUNTS });
      fake.advance(2_000);
      const out = await outcomeOf(call(action, INPUT));
      expect(fake.rowOf(KEY), "RACE: row content").toEqual(after(action, { ...STORED, accounts: TWO_ACCOUNTS }));
      expect(out).toEqual({ done: true });
      expect(fake.write).not.toHaveBeenCalled();
      expect(fake.update).toHaveBeenCalledTimes(1);
    });
  }

  for (const [id, action] of [["F3", "saveConnection"], ["F4", "clearConnection"]] as const) {
    it(`(${id}) [RACE] ${action}: a write that lands right before the persist is kept`, async () => {
      const { fake, call } = setup({ row: STORED });
      fake.beforePersist((n) => {
        if (n === 1) fake.otherProcessWrites(KEY, { ...STORED, accounts: TWO_ACCOUNTS });
      });
      const out = await outcomeOf(call(action, INPUT));
      expect(fake.rowOf(KEY), "RACE: row content").toEqual(after(action, { ...STORED, accounts: TWO_ACCOUNTS }));
      expect(out).toEqual({ done: true });
      expect(fake.state.updaterCalls).toBe(2);
      expect(fake.write).not.toHaveBeenCalled();
    });
  }
});

describe("rule 1: writes go only through the host's atomic update", () => {
  for (const action of ACTIONS) {
    it(`(T5) [RACE] ${action}: a row that changes before every persist is refused with LINKEDIN_CONFIG_CONFLICT after five attempts and keeps the competitor's last value`, async () => {
      const { fake, call } = setup({ row: STORED });
      fake.beforePersist((n) => fake.otherProcessWrites(KEY, { ...STORED, accounts: [{ id: `w${n}` }] }));
      const out = await outcomeOf(call(action, INPUT));
      expect(fake.rowOf(KEY), "RACE: row content").toEqual({ ...STORED, accounts: [{ id: "w5" }] });
      expect(errorOf(out).code).toBe("LINKEDIN_CONFIG_CONFLICT");
      expect(errorOf(out).name).toBe("LinkedInConfigConflictError");
      expect(fake.state.updaterCalls).toBe(5);
      expect(fake.write).not.toHaveBeenCalled();
    });

    it(`(T6) [CONTRACT+FAIL-OPEN] ${action}: a provider without update refuses with LINKEDIN_CONFIG_CAS_UNAVAILABLE and writes nothing`, async () => {
      const fake = makeFakeHostConfig();
      fake.setRaw(KEY, JSON.stringify(STORED));
      const { call } = makeHostCtx(register, { store: fake.withoutUpdate() });
      const out = await outcomeOf(call(action, INPUT));
      expect(fake.rowOf(KEY), "FAIL-OPEN: row content").toEqual(STORED);
      expect(errorOf(out).code).toBe("LINKEDIN_CONFIG_CAS_UNAVAILABLE");
      expect(errorOf(out).name).toBe("LinkedInConfigCasUnavailableError");
      expect(fake.write).not.toHaveBeenCalled();
    });

    it(`(T7) [CONTRACT+FAIL-OPEN] ${action}: a provider whose update is not a function (true) refuses as T6`, async () => {
      const fake = makeFakeHostConfig();
      fake.setRaw(KEY, JSON.stringify(STORED));
      const { call } = makeHostCtx(register, { store: fake.withUpdate(true) });
      const out = await outcomeOf(call(action, INPUT));
      expect(fake.rowOf(KEY), "FAIL-OPEN: row content").toEqual(STORED);
      expect(errorOf(out).code).toBe("LINKEDIN_CONFIG_CAS_UNAVAILABLE");
      expect(errorOf(out).name).toBe("LinkedInConfigCasUnavailableError");
      expect(fake.write).not.toHaveBeenCalled();
    });

    it(`(T8) [FAIL-OPEN] ${action}: a stored text that is not JSON is refused with LINKEDIN_CONFIG_ROW_INVALID and kept`, async () => {
      const { fake, call } = setup();
      fake.setRaw(KEY, "{not json");
      const out = await outcomeOf(call(action, INPUT));
      expect(fake.rawOf(KEY), "FAIL-OPEN: row content").toBe("{not json");
      expect(errorOf(out).code).toBe("LINKEDIN_CONFIG_ROW_INVALID");
      expect(errorOf(out).name).toBe("LinkedInConfigRowError");
      expect(fake.write).not.toHaveBeenCalled();
    });

    it(`(T9) [LEAK] ${action}: a store whose update and write throw a sentinel error is refused with LINKEDIN_CONFIG_SAVE_FAILED that carries no sentinel`, async () => {
      const spies = consoleSpies();
      const fake = makeFakeHostConfig();
      fake.setRaw(KEY, JSON.stringify({ ...STORED, clientSecret: SENTINEL }));
      const boom = () => {
        throw Object.assign(new Error(SENTINEL), { code: SENTINEL, cause: SENTINEL });
      };
      const update = vi.fn(boom);
      const write = vi.fn(boom);
      const { call } = makeHostCtx(register, { store: fake.withOverrides({ update, write }) });
      const out = await outcomeOf(call(action, INPUT));
      expect(out.done, "LEAK: the action must reject").toBe(false);
      expectNoSentinel(errorOf(out), fake.state.logs, spies);
      expect(errorOf(out).code).toBe("LINKEDIN_CONFIG_SAVE_FAILED");
      expect(errorOf(out).name).toBe("LinkedInConfigSaveError");
      expect(errorOf(out).message).toBe(SAVE_FAILED_TEXT);
      expect(write).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
    });

    it(`(T10) [FAIL-OPEN] ${action}: a row that turns into the string "true" before the persist is refused with LINKEDIN_CONFIG_ROW_INVALID and kept`, async () => {
      const { fake, call } = setup({ row: STORED });
      fake.beforePersist((n) => {
        if (n === 1) fake.otherProcessWrites(KEY, "true");
      });
      const out = await outcomeOf(call(action, INPUT));
      expect(fake.rowOf(KEY), "FAIL-OPEN: row content").toBe("true");
      expect(errorOf(out).code).toBe("LINKEDIN_CONFIG_ROW_INVALID");
      expect(errorOf(out).name).toBe("LinkedInConfigRowError");
      expect(fake.state.updaterCalls).toBe(2);
      expect(fake.write).not.toHaveBeenCalled();
    });

    it(`(T17) [CONTRACT] ${action}: a store failure on the swap is refused with LINKEDIN_CONFIG_SAVE_FAILED, a fixed text with no cause`, async () => {
      const spies = consoleSpies();
      const { fake, call } = setup({ row: STORED });
      fake.storeFails("compareAndSwap");
      const out = await outcomeOf(call(action, INPUT));
      expect(errorOf(out).code, "CONTRACT: outcome").toBe("LINKEDIN_CONFIG_SAVE_FAILED");
      expect(errorOf(out).name).toBe("LinkedInConfigSaveError");
      expect(errorOf(out).message).toBe(SAVE_FAILED_TEXT);
      expect(errorOf(out).cause).toBeUndefined();
      expectNoSentinel(errorOf(out), fake.state.logs, spies);
      expect(fake.rowOf(KEY)).toEqual(STORED);
      expect(fake.write).not.toHaveBeenCalled();
    });
  }

  it("(T11 cas-1) [RACE] save: a second writer before the persist is kept; the save runs again on the fresh row and stores one change", async () => {
    const { fake, call } = setup({ row: STORED });
    fake.beforePersist((n) => {
      if (n === 1) fake.otherProcessWrites(KEY, { ...STORED, accounts: TWO_ACCOUNTS });
    });
    const out = await outcomeOf(call("saveConnection", { clientId: "b", organizationPosting: "false" }));
    expect(fake.rowOf(KEY), "RACE: row content").toEqual({
      ...STORED,
      clientId: "b",
      organizationPosting: false,
      accounts: TWO_ACCOUNTS,
    });
    expect(out).toEqual({ done: true });
    expect(fake.state.landed).toBe(1);
  });

  it("(T11 cas-2) [RACE] clear: a second writer before the persist is kept; the clear runs again on the fresh row and stores one change", async () => {
    const { fake, call } = setup({ row: STORED });
    fake.beforePersist((n) => {
      if (n === 1) fake.otherProcessWrites(KEY, { ...STORED, accounts: TWO_ACCOUNTS, loggingEnabled: false });
    });
    const out = await outcomeOf(call("clearConnection"));
    expect(fake.rowOf(KEY), "RACE: row content").toEqual({
      accounts: TWO_ACCOUNTS,
      loggingEnabled: false,
      redirectUri: "https://r",
    });
    expect(out).toEqual({ done: true });
    expect(fake.state.landed).toBe(1);
  });

  it("(T11 cas-4) [RACE] a conflict on two attempts and none on the third still saves once, on the newest row", async () => {
    const { fake, call } = setup({ row: STORED });
    fake.beforePersist((n) => {
      if (n === 1 || n === 2) fake.otherProcessWrites(KEY, { ...STORED, accounts: [{ id: `w${n}` }] });
    });
    const out = await outcomeOf(call("saveConnection", { clientSecret: "z" }));
    expect(fake.rowOf(KEY), "RACE: row content").toEqual({ ...STORED, clientSecret: "z", accounts: [{ id: "w2" }] });
    expect(out).toEqual({ done: true });
    expect(fake.state.updaterCalls).toBe(3);
    expect(fake.state.landed).toBe(1);
  });

  it("(T11 cas-6) [RACE] a row created by a second writer where none existed is not overwritten", async () => {
    const { fake, call } = setup();
    fake.beforePersist((n) => {
      if (n === 1) fake.otherProcessWrites(KEY, { accounts: [{ id: "new" }] });
    });
    const out = await outcomeOf(call("saveConnection", { clientId: "b", clientSecret: "z" }));
    expect(fake.rowOf(KEY), "RACE: row content").toEqual({ clientId: "b", clientSecret: "z", accounts: [{ id: "new" }] });
    expect(out).toEqual({ done: true });
    expect(fake.state.landed).toBe(1);
  });

  const REORDERED = {
    redirectUri: "https://r",
    loggingEnabled: true,
    accounts: [{ id: "x" }],
    organizationPosting: true,
    clientSecret: "s",
    clientId: "a",
  };

  it("(T12 cas-5) [REGRESSION] the same row rewritten with its keys in another order is saved once, with the right content", async () => {
    const { fake, call } = setup({ row: STORED });
    fake.beforePersist((n) => {
      if (n === 1) fake.setRaw(KEY, JSON.stringify(REORDERED));
    });
    const out = await outcomeOf(call("saveConnection", { clientId: "b" }));
    expect(fake.rowOf(KEY), "REGRESSION: row content").toEqual({ ...STORED, clientId: "b" });
    expect(out).toEqual({ done: true });
    expect(fake.state.landed).toBe(1);
  });

  it("(T12-contract cas-5) [CONTRACT] the key-reordered rewrite makes the host's update run the change twice", async () => {
    const { fake, call } = setup({ row: STORED });
    fake.beforePersist((n) => {
      if (n === 1) fake.setRaw(KEY, JSON.stringify(REORDERED));
    });
    await outcomeOf(call("saveConnection", { clientId: "b" }));
    expect(fake.state.updaterCalls, "CONTRACT: updater calls").toBe(2);
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.write).not.toHaveBeenCalled();
  });
});

describe("rule 2: a stored row that is not a plain object is refused", () => {
  // [label, how the store holds it]: a JSON text, or a value no text can carry
  // that the store hands over as it is.
  const MALFORMED: Array<[string, { text: string } | { value: unknown }]> = [
    ['the string "true"', { text: JSON.stringify("true") }],
    ["an empty string", { text: JSON.stringify("") }],
    ["a number", { text: "42" }],
    ["zero", { text: "0" }],
    ["NaN", { value: Number.NaN }],
    ["boolean true", { text: "true" }],
    ["boolean false", { text: "false" }],
    ["an empty array", { text: "[]" }],
    ["an array of strings", { text: JSON.stringify(["a", "b"]) }],
    ["an array of objects", { text: JSON.stringify([{ clientId: "a" }]) }],
    ["a class instance (Map)", { value: new Map([["clientId", "a"]]) }],
  ];

  for (const [label, held] of MALFORMED) {
    for (const action of ["saveConnection", "clearConnection", "currentConfig", "connectionStatus"] as const) {
      it(`(T13 row) [REGRESSION] ${action} refuses ${label} with LINKEDIN_CONFIG_ROW_INVALID and writes nothing`, async () => {
        const { fake, call } = setup();
        if ("text" in held) fake.setRaw(KEY, held.text);
        else fake.handOver(KEY, held.value);
        const before = fake.rawOf(KEY);
        const out = await outcomeOf(call(action, { clientId: "new", clientSecret: "z", organizationPosting: "true" }));
        expect(fake.rawOf(KEY), "REGRESSION: row content").toBe(before);
        expect(errorOf(out).name).toBe("LinkedInConfigRowError");
        expect(errorOf(out).code).toBe("LINKEDIN_CONFIG_ROW_INVALID");
        expect(fake.state.landed).toBe(0);
        expect(fake.write).not.toHaveBeenCalled();
        expect(fake.delete).not.toHaveBeenCalled();
      });
    }
  }

  it("(T13 row) [REGRESSION] a stored null reads as an empty row: save stores only the new credentials, clear an empty row", async () => {
    const save = setup({ row: null });
    await expect(save.call("saveConnection", { clientId: "b", clientSecret: "z" })).resolves.toEqual({
      banner: "saved",
    });
    expect(save.fake.rowOf(KEY)).toEqual({ clientId: "b", clientSecret: "z" });

    const clear = setup({ row: null });
    await expect(clear.call("clearConnection")).resolves.toEqual({ banner: "cleared" });
    expect(clear.fake.rowOf(KEY)).toEqual({});

    const read = setup({ row: null });
    await expect(read.call("currentConfig")).resolves.toEqual({ organizationPosting: false });
    await expect(read.call("connectionStatus")).rejects.toThrow("LinkedIn OAuth is not configured.");
  });

  it("(T13 row) [REGRESSION] a store that hands over undefined reads as an empty row", async () => {
    const { fake, call } = setup();
    fake.handOver(KEY, undefined, "null");
    await expect(call("saveConnection", { clientId: "b", clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(fake.rowOf(KEY)).toEqual({ clientId: "b", clientSecret: "z" });
  });

  it("(T13 row) [REGRESSION] a missing row reads as an empty row", async () => {
    const { fake, call } = setup();
    await expect(call("clearConnection")).resolves.toEqual({ banner: "cleared" });
    expect(fake.rowOf(KEY)).toEqual({});
    expect(fake.read.mock.calls.every((c) => c[0] === KEY)).toBe(true);
    expect(fake.update.mock.calls.every((c) => c[0] === KEY)).toBe(true);
  });

  it("(T13 row) [REGRESSION] a plain object without a prototype is accepted", async () => {
    const { fake, call } = setup();
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { clientId: "a", accounts: [{ id: "x" }] });
    fake.handOver(KEY, bare, JSON.stringify({ clientId: "a", accounts: [{ id: "x" }] }));
    await expect(call("saveConnection", { clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(fake.rowOf(KEY)).toEqual({ clientId: "a", clientSecret: "z", accounts: [{ id: "x" }] });
    expect(fake.state.landed).toBe(1);
  });
});

// NOTE 7: the capability providers are a trust input. A shadow provider listed
// BEFORE the host's must not receive a secret and must not decide the manage guard.
function makeOrderedCtx(opts: { hostListed: boolean; hostGuardDenies?: boolean }) {
  const hostStore = makeFakeHostConfig();
  hostStore.setRaw(KEY, JSON.stringify(STORED));
  const shadowStore = makeFakeHostConfig();
  shadowStore.setRaw(KEY, JSON.stringify(STORED));
  const hostGuard = {
    require: vi.fn(async (_pkg: string, _mode: string): Promise<void> => {
      if (opts.hostGuardDenies) throw new Error("manage denied");
    }),
  };
  const shadowGuard = { require: vi.fn(async (_pkg: string, _mode: string): Promise<void> => {}) };
  const SHADOW = "@example/shadow-provider";
  const { call } = makeHostCtx(register, {
    lists: {
      [STORE_CAP]: [
        { packageName: SHADOW, impl: shadowStore.svc },
        ...(opts.hostListed ? [{ packageName: HOST_PKG, impl: hostStore.svc }] : []),
      ],
      [GUARD_CAP]: [
        { packageName: SHADOW, impl: shadowGuard },
        ...(opts.hostListed ? [{ packageName: HOST_PKG, impl: hostGuard }] : []),
      ],
    },
  });
  const shadowUntouched = () => {
    expect(shadowStore.read).not.toHaveBeenCalled();
    expect(shadowStore.write).not.toHaveBeenCalled();
    expect(shadowStore.update).not.toHaveBeenCalled();
    expect(shadowStore.rowOf(KEY)).toEqual(STORED);
  };
  return { call, hostStore, shadowStore, hostGuard, shadowGuard, shadowUntouched };
}

describe("NOTE 7: a shadow provider listed before the host provider is never used", () => {
  it("(T14 note7-1) [REGRESSION] saveConnection stores the secret only in the host store and asks only the host guard", async () => {
    const c = makeOrderedCtx({ hostListed: true });
    await expect(c.call("saveConnection", { clientId: "b", clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(c.hostStore.rowOf(KEY), "REGRESSION: row content").toEqual({ ...STORED, clientId: "b", clientSecret: "z" });
    c.shadowUntouched();
    expect(c.shadowGuard.require).not.toHaveBeenCalled();
    expect(c.hostGuard.require).toHaveBeenCalledWith("@cinatra-ai/linkedin-oauth-connector", "manage");
    expect(c.hostStore.state.landed).toBe(1);
  });

  it("(T14-contract note7-1) [CONTRACT] saveConnection changes the host row through one host update and no write", async () => {
    const c = makeOrderedCtx({ hostListed: true });
    await outcomeOf(c.call("saveConnection", { clientId: "b", clientSecret: "z" }));
    expect(c.hostStore.update, "CONTRACT: host update calls").toHaveBeenCalledTimes(1);
    expect(c.hostStore.update.mock.calls[0][0]).toBe(KEY);
    expect(c.hostStore.write).not.toHaveBeenCalled();
  });

  for (const action of ["saveConnection", "clearConnection", "currentConfig"] as const) {
    it(`(T14 note7-2) [REGRESSION] ${action}: a shadow guard that allows does not bypass a host guard that denies`, async () => {
      const c = makeOrderedCtx({ hostListed: true, hostGuardDenies: true });
      await expect(c.call(action, { clientId: "b", clientSecret: "z" })).rejects.toThrow("manage denied");
      c.shadowUntouched();
      expect(c.hostStore.write).not.toHaveBeenCalled();
      expect(c.hostStore.update).not.toHaveBeenCalled();
      expect(c.hostStore.rowOf(KEY)).toEqual(STORED);
    });
  }

  for (const action of ["saveConnection", "clearConnection", "currentConfig", "connectionStatus"] as const) {
    it(`(T14 note7-3) [REGRESSION] ${action}: with no provider of the host identity the action refuses and the shadow store is never used`, async () => {
      const c = makeOrderedCtx({ hostListed: false });
      await expect(c.call(action, { clientId: "b", clientSecret: "z" })).rejects.toThrow();
      c.shadowUntouched();
    });
  }
});
