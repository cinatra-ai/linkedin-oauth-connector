// saveConnection and clearConnection change the shared "linkedin" row that the
// LinkedIn connector also writes (accounts, loggingEnabled, redirectUri).
//
// Rule 1 (compare-and-set): a write lands only when the row read right before
// it equals the row the change was computed from. A second writer between the
// read and the write makes the handler start again on the fresh row; after
// three attempts it refuses with LINKEDIN_CONFIG_CONFLICT and writes nothing.
//
// Rule 2 (plain-object row): a missing or null row reads as an empty row. Any
// other stored value that is not a plain object (a string, number, boolean,
// array or class instance) is refused with LINKEDIN_CONFIG_ROW_INVALID by every
// action that reads the row; nothing is written over it.
import { describe, expect, it, vi } from "vitest";
import { register } from "../register";

type UiAction = { id: string; handler: (input?: unknown) => Promise<unknown> };

const KEY = "linkedin";

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
