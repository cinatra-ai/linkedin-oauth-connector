// saveConnection and clearConnection change the shared "linkedin" row that the
// LinkedIn connector also writes (accounts, loggingEnabled, redirectUri).
//
// Rule 1 (re-read compare): a write lands only when the row read right before
// it equals the row the change was computed from. A second writer between the
// read and the write makes the handler start again on the fresh row; after
// three attempts it refuses with LINKEDIN_CONFIG_CONFLICT and writes nothing.
// The compare is not atomic. The host's store contract has no compare-and-swap
// member, so a write the read does not show yet (the host caches a row per
// process) or one that lands after the compare is still lost. The
// "(mf1-residual)" cases at the end of this file pin that open gap and are
// marked as expected failures until the host offers such a member.
//
// Rule 2 (plain-object row): a missing or null row reads as an empty row. Any
// other stored value that is not a plain object (a string, number, boolean,
// array or class instance) is refused with LINKEDIN_CONFIG_ROW_INVALID by every
// action that reads the row; nothing is written over it.
//
// Provider identity: the store and the manage guard come only from the provider
// registered under the host's own identity, never from the first provider
// listed (the "(note7-*)" cases at the end of this file).
import { describe, expect, it, vi } from "vitest";
import { register } from "../register";

type UiAction = { id: string; handler: (input?: unknown) => Promise<unknown> };

const KEY = "linkedin";
// The identity the host registers its own providers under. The host binds every
// provider an extension registers to that extension's own package name and
// refuses this one, so a provider listed under it is the host's.
const HOST_PKG = "@cinatra-ai/host";

/** A store whose backing value can be changed by a simulated second writer
 *  right after a given read returns. `present: false` is a missing row. */
function makeStore(initial: { present: boolean; value?: unknown }) {
  const state = { present: initial.present, value: initial.value };
  let reads = 0;
  let afterRead: ((n: number) => void) | undefined;
  const clone = (v: unknown) => (v instanceof Map ? new Map(v) : structuredClone(v));
  const read = vi.fn(<T,>(_id: string, fallback: T): T => {
    reads += 1;
    const out = (state.present ? clone(state.value) : fallback) as T;
    afterRead?.(reads);
    return out;
  });
  const write = vi.fn((_id: string, value: unknown) => {
    state.present = true;
    state.value = structuredClone(value);
  });
  const del = vi.fn();
  return {
    svc: { read, write, delete: del },
    read,
    write,
    state,
    secondWriter(fn: (n: number) => void) {
      afterRead = fn;
    },
  };
}

function makeCtx(initial: { present: boolean; value?: unknown }) {
  const store = makeStore(initial);
  const services: Record<string, unknown> = {
    "@cinatra-ai/host:connector-config": store.svc,
    "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
  };
  const actions = new Map<string, UiAction>();
  const ctx = {
    capabilities: {
      registerProvider: () => {},
      resolveProviders: (capability: string) => {
        const impl = services[capability];
        return impl ? [{ packageName: HOST_PKG, impl }] : [];
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
  register(ctx as unknown as Parameters<typeof register>[0]);
  const call = (id: string, input?: unknown) => {
    const a = actions.get(id);
    if (!a) throw new Error(`action ${id} not registered`);
    return a.handler(input);
  };
  return { call, store };
}

const STORED = {
  clientId: "a",
  clientSecret: "s",
  organizationPosting: true,
  accounts: [{ id: "x" }],
  loggingEnabled: true,
  redirectUri: "https://r",
};

const ACCOUNTS_AFTER_SECOND_WRITER = [{ id: "x" }, { id: "y" }];

describe("rule 1: saveConnection and clearConnection compare-and-set the row", () => {
  it("(cas-1) save: a second writer after the first read is not overwritten; the save retries on the fresh row", async () => {
    const { call, store } = makeCtx({ present: true, value: STORED });
    store.secondWriter((n) => {
      if (n === 1) store.state.value = { ...STORED, accounts: ACCOUNTS_AFTER_SECOND_WRITER };
    });
    await expect(call("saveConnection", { clientId: "b", organizationPosting: "false" })).resolves.toEqual({
      banner: "saved",
    });
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.state.value).toEqual({
      ...STORED,
      clientId: "b",
      organizationPosting: false,
      accounts: ACCOUNTS_AFTER_SECOND_WRITER,
    });
  });

  it("(cas-2) clear: a second writer after the first read is not overwritten; the clear retries on the fresh row", async () => {
    const { call, store } = makeCtx({ present: true, value: STORED });
    store.secondWriter((n) => {
      if (n === 1) store.state.value = { ...STORED, accounts: ACCOUNTS_AFTER_SECOND_WRITER, loggingEnabled: false };
    });
    await expect(call("clearConnection")).resolves.toEqual({ banner: "cleared" });
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.state.value).toEqual({
      accounts: ACCOUNTS_AFTER_SECOND_WRITER,
      loggingEnabled: false,
      redirectUri: "https://r",
    });
  });

  for (const action of ["saveConnection", "clearConnection"] as const) {
    it(`(cas-3) ${action}: a row that changes on every attempt is refused with LINKEDIN_CONFIG_CONFLICT after three attempts and nothing is written`, async () => {
      const { call, store } = makeCtx({ present: true, value: STORED });
      store.secondWriter((n) => {
        store.state.value = { ...STORED, accounts: [{ id: `w${n}` }] };
      });
      const err = await call(action, { clientId: "b", clientSecret: "z" }).then(
        () => null,
        (e: unknown) => e as { name?: string; code?: string; message?: string },
      );
      expect(err).not.toBeNull();
      expect(err?.name).toBe("LinkedInConfigConflictError");
      expect(err?.code).toBe("LINKEDIN_CONFIG_CONFLICT");
      expect(store.write).not.toHaveBeenCalled();
      // Bounded: two reads (the read and the compare) per attempt, three attempts.
      expect(store.read).toHaveBeenCalledTimes(6);
      expect(store.state.value).toEqual({ ...STORED, accounts: [{ id: "w6" }] });
    });
  }

  it("(cas-4) a conflict on two attempts and none on the third still saves once, on the newest row", async () => {
    const { call, store } = makeCtx({ present: true, value: STORED });
    store.secondWriter((n) => {
      if (n === 1 || n === 3) store.state.value = { ...STORED, accounts: [{ id: `w${n}` }] };
    });
    await expect(call("saveConnection", { clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.read).toHaveBeenCalledTimes(6);
    expect(store.state.value).toEqual({ ...STORED, clientSecret: "z", accounts: [{ id: "w3" }] });
  });

  it("(cas-5) the same row read back with its keys in another order is not a conflict", async () => {
    const { call, store } = makeCtx({ present: true, value: STORED });
    store.secondWriter((n) => {
      if (n === 1) {
        store.state.value = {
          redirectUri: "https://r",
          loggingEnabled: true,
          accounts: [{ id: "x" }],
          organizationPosting: true,
          clientSecret: "s",
          clientId: "a",
        };
      }
    });
    await expect(call("saveConnection", { clientId: "b" })).resolves.toEqual({ banner: "saved" });
    expect(store.read).toHaveBeenCalledTimes(2);
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.state.value).toEqual({ ...STORED, clientId: "b" });
  });

  it("(cas-6) a row created by a second writer where none existed is not overwritten", async () => {
    const { call, store } = makeCtx({ present: false });
    store.secondWriter((n) => {
      if (n === 1) {
        store.state.present = true;
        store.state.value = { accounts: [{ id: "new" }] };
      }
    });
    await expect(call("saveConnection", { clientId: "b", clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.state.value).toEqual({ clientId: "b", clientSecret: "z", accounts: [{ id: "new" }] });
  });
});

describe("rule 2: a stored row that is not a plain object is refused", () => {
  const MALFORMED: Array<[string, unknown]> = [
    ["the string \"true\"", "true"],
    ["an empty string", ""],
    ["a number", 42],
    ["zero", 0],
    ["NaN", Number.NaN],
    ["boolean true", true],
    ["boolean false", false],
    ["an empty array", []],
    ["an array of strings", ["a", "b"]],
    ["an array of objects", [{ clientId: "a" }]],
    ["a class instance (Map)", new Map([["clientId", "a"]])],
  ];

  for (const [label, value] of MALFORMED) {
    for (const action of ["saveConnection", "clearConnection", "currentConfig", "connectionStatus"] as const) {
      it(`(row) ${action} refuses ${label} with LINKEDIN_CONFIG_ROW_INVALID and writes nothing`, async () => {
        const { call, store } = makeCtx({ present: true, value });
        const err = await call(action, { clientId: "new", clientSecret: "z", organizationPosting: "true" }).then(
          () => null,
          (e: unknown) => e as { name?: string; code?: string },
        );
        expect(err).not.toBeNull();
        expect(err?.name).toBe("LinkedInConfigRowError");
        expect(err?.code).toBe("LINKEDIN_CONFIG_ROW_INVALID");
        expect(store.write).not.toHaveBeenCalled();
        expect(store.svc.delete).not.toHaveBeenCalled();
      });
    }
  }

  it("(row) a value that turns malformed between the read and the compare is refused, not written", async () => {
    const { call, store } = makeCtx({ present: true, value: STORED });
    store.secondWriter((n) => {
      if (n === 1) store.state.value = "true";
    });
    const err = await call("saveConnection", { clientId: "b" }).then(
      () => null,
      (e: unknown) => e as { code?: string },
    );
    expect(err?.code).toBe("LINKEDIN_CONFIG_ROW_INVALID");
    expect(store.write).not.toHaveBeenCalled();
    expect(store.state.value).toBe("true");
  });

  it("(row) a stored null reads as an empty row: save writes only the new credentials, clear writes an empty row", async () => {
    const save = makeCtx({ present: true, value: null });
    await expect(save.call("saveConnection", { clientId: "b", clientSecret: "z" })).resolves.toEqual({
      banner: "saved",
    });
    expect(save.store.state.value).toEqual({ clientId: "b", clientSecret: "z" });

    const clear = makeCtx({ present: true, value: null });
    await expect(clear.call("clearConnection")).resolves.toEqual({ banner: "cleared" });
    expect(clear.store.state.value).toEqual({});

    const read = makeCtx({ present: true, value: null });
    await expect(read.call("currentConfig")).resolves.toEqual({ organizationPosting: false });
    await expect(read.call("connectionStatus")).rejects.toThrow("LinkedIn OAuth is not configured.");
  });

  it("(row) a store that returns undefined reads as an empty row", async () => {
    const { call, store } = makeCtx({ present: true, value: undefined });
    await expect(call("saveConnection", { clientId: "b", clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(store.state.value).toEqual({ clientId: "b", clientSecret: "z" });
  });

  it("(row) a missing row reads as an empty row", async () => {
    const { call, store } = makeCtx({ present: false });
    await expect(call("clearConnection")).resolves.toEqual({ banner: "cleared" });
    expect(store.state.value).toEqual({});
    expect(store.read.mock.calls.every((c) => c[0] === KEY)).toBe(true);
  });

  it("(row) a plain object without a prototype is accepted", async () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { clientId: "a", accounts: [{ id: "x" }] });
    const { call, store } = makeCtx({ present: true, value: bare });
    // structuredClone turns it into an ordinary object; the store hands back this exact prototype-less object instead.
    store.read.mockImplementation(<T,>(): T => bare as T);
    await expect(call("saveConnection", { clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.state.value).toEqual({ clientId: "a", clientSecret: "z", accounts: [{ id: "x" }] });
  });
});

// MF1 residual (OPEN): the re-read compare is not atomic. The host caches a
// connector row per process for 10 s (a cache hit returns the cached row, and a
// write refreshes only the writing process's cache) and its store contract has
// only read, write and delete. So the connector cannot close the two races below
// by itself; closing them needs a compare-and-swap member on the host's
// connector-config service. Each case asserts what such a member gives and is
// marked `it.fails`: it is an expected failure now and turns into a reported
// failure once the gap is closed, so the mark is then removed.
const CACHE_TTL_MS = 10_000;

/** One backing row shared by every process, and this process's read cache. */
function makeCachedStore(initial: Record<string, unknown>) {
  const db = { value: structuredClone(initial) };
  let now = 0;
  let cached: { value: Record<string, unknown>; at: number } | undefined;
  const read = vi.fn(<T,>(_id: string, _fallback: T): T => {
    if (!cached || now - cached.at >= CACHE_TTL_MS) cached = { value: structuredClone(db.value), at: now };
    return structuredClone(cached.value) as T;
  });
  const write = vi.fn((_id: string, value: unknown) => {
    db.value = structuredClone(value) as Record<string, unknown>;
    cached = { value: structuredClone(db.value), at: now };
  });
  const del = vi.fn();
  return {
    svc: { read, write, delete: del },
    db,
    /** Another process writes the backing row; this process's cache does not show it. */
    otherProcessWrites(value: Record<string, unknown>) {
      db.value = structuredClone(value);
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

function makeCachedCtx(initial: Record<string, unknown>) {
  const store = makeCachedStore(initial);
  const services: Record<string, unknown> = {
    "@cinatra-ai/host:connector-config": store.svc,
    "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
  };
  const actions = new Map<string, UiAction>();
  const ctx = {
    capabilities: {
      registerProvider: () => {},
      resolveProviders: (capability: string) => {
        const impl = services[capability];
        return impl ? [{ packageName: HOST_PKG, impl }] : [];
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
  register(ctx as unknown as Parameters<typeof register>[0]);
  const call = (id: string, input?: unknown) => {
    const a = actions.get(id);
    if (!a) throw new Error(`action ${id} not registered`);
    return a.handler(input);
  };
  return { call, store };
}

const outcomeOf = (p: Promise<unknown>) =>
  p.then(
    () => "done",
    (e: unknown) => (e as { code?: string }).code ?? String(e),
  );

describe("MF1 residual (OPEN host need): the re-read compare is not atomic", () => {
  for (const action of ["saveConnection", "clearConnection"] as const) {
    it.fails(
      `(mf1-residual) ${action}: a write by another process that the cached read does not show is kept (needs a compare-and-swap on the host's connector-config service)`,
      async () => {
        const c = makeCachedCtx({ ...STORED });
        // The form loads: this process reads the row and the host caches it.
        await expect(c.call("currentConfig")).resolves.toMatchObject({ clientId: "a" });
        // The LinkedIn connector, in another process, adds an account to the row.
        c.store.otherProcessWrites({ ...STORED, accounts: ACCOUNTS_AFTER_SECOND_WRITER });
        // The action runs 2 s later, inside the cache window.
        c.store.advance(2_000);
        const outcome = await outcomeOf(c.call(action, { clientSecret: "z" }));
        expect(["done", "LINKEDIN_CONFIG_CONFLICT"]).toContain(outcome);
        // What a compare-and-swap gives: the other process's account is not lost.
        expect(c.store.db.value.accounts).toEqual(ACCOUNTS_AFTER_SECOND_WRITER);
      },
    );

    it.fails(
      `(mf1-residual) ${action}: a write that lands after the compare and before the write is kept (needs a compare-and-swap on the host's connector-config service)`,
      async () => {
        const { call, store } = makeCtx({ present: true, value: STORED });
        // Read 1 computes the change and read 2 is the compare; the other write lands right after the compare.
        store.secondWriter((n) => {
          if (n === 2) store.state.value = { ...STORED, accounts: ACCOUNTS_AFTER_SECOND_WRITER };
        });
        const outcome = await outcomeOf(call(action, { clientSecret: "z" }));
        expect(["done", "LINKEDIN_CONFIG_CONFLICT"]).toContain(outcome);
        // What a compare-and-swap gives: the other writer's account is not lost.
        expect((store.state.value as { accounts?: unknown }).accounts).toEqual(ACCOUNTS_AFTER_SECOND_WRITER);
      },
    );
  }
});

// NOTE 7: the capability providers are a trust input. A shadow provider listed
// BEFORE the host's must not receive a secret and must not decide the manage
// guard.
function makeOrderedCtx(opts: { hostListed: boolean; hostGuardDenies?: boolean }) {
  const hostStore = makeStore({ present: true, value: STORED });
  const shadowStore = makeStore({ present: true, value: STORED });
  const hostGuard = {
    require: vi.fn(async () => {
      if (opts.hostGuardDenies) throw new Error("manage denied");
    }),
  };
  const shadowGuard = { require: vi.fn(async () => {}) };
  const SHADOW = "@example/shadow-provider";
  const lists: Record<string, Array<{ packageName: string; impl: unknown }>> = {
    "@cinatra-ai/host:connector-config": [
      { packageName: SHADOW, impl: shadowStore.svc },
      ...(opts.hostListed ? [{ packageName: HOST_PKG, impl: hostStore.svc }] : []),
    ],
    "@cinatra-ai/host:extension-action-guard": [
      { packageName: SHADOW, impl: shadowGuard },
      ...(opts.hostListed ? [{ packageName: HOST_PKG, impl: hostGuard }] : []),
    ],
  };
  const actions = new Map<string, UiAction>();
  const ctx = {
    capabilities: {
      registerProvider: () => {},
      resolveProviders: (capability: string) => [...(lists[capability] ?? [])],
    },
    ui: {
      registerSetupSurface: () => {},
      registerSettingsSurface: () => {},
      registerAction: (a: UiAction) => {
        actions.set(a.id, a);
      },
    },
  };
  register(ctx as unknown as Parameters<typeof register>[0]);
  const call = (id: string, input?: unknown) => {
    const a = actions.get(id);
    if (!a) throw new Error(`action ${id} not registered`);
    return a.handler(input);
  };
  return { call, hostStore, shadowStore, hostGuard, shadowGuard };
}

describe("NOTE 7: a shadow provider listed before the host provider is never used", () => {
  it("(note7-1) saveConnection writes the secret only to the host store and asks only the host guard", async () => {
    const c = makeOrderedCtx({ hostListed: true });
    await expect(c.call("saveConnection", { clientId: "b", clientSecret: "z" })).resolves.toEqual({ banner: "saved" });
    expect(c.shadowStore.write).not.toHaveBeenCalled();
    expect(c.shadowStore.read).not.toHaveBeenCalled();
    expect(c.shadowGuard.require).not.toHaveBeenCalled();
    expect(c.hostGuard.require).toHaveBeenCalledWith("@cinatra-ai/linkedin-oauth-connector", "manage");
    expect(c.hostStore.write).toHaveBeenCalledTimes(1);
    expect(c.hostStore.state.value).toEqual({ ...STORED, clientId: "b", clientSecret: "z" });
  });

  for (const action of ["saveConnection", "clearConnection", "currentConfig"] as const) {
    it(`(note7-2) ${action}: a shadow guard that allows does not bypass a host guard that denies`, async () => {
      const c = makeOrderedCtx({ hostListed: true, hostGuardDenies: true });
      await expect(c.call(action, { clientId: "b", clientSecret: "z" })).rejects.toThrow("manage denied");
      expect(c.shadowStore.write).not.toHaveBeenCalled();
      expect(c.hostStore.write).not.toHaveBeenCalled();
    });
  }

  for (const action of ["saveConnection", "clearConnection", "currentConfig", "connectionStatus"] as const) {
    it(`(note7-3) ${action}: with no provider of the host identity the action refuses and the shadow store is never read or written`, async () => {
      const c = makeOrderedCtx({ hostListed: false });
      await expect(c.call(action, { clientId: "b", clientSecret: "z" })).rejects.toThrow();
      expect(c.shadowStore.read).not.toHaveBeenCalled();
      expect(c.shadowStore.write).not.toHaveBeenCalled();
    });
  }
});
