// The update scenario table S1-S14 run against this package's fake of the host's
// connector-config `update` member (fake-host-config.ts). The host module's own
// test runs the same ids with the same expectations over an in-memory port; this
// file is what ties the fake to the host contract (the kind gate bans `@/`
// imports, so the fake cannot import the host module).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SENTINEL,
  configKey,
  consoleSpies,
  expectNoSentinel,
  expectedMessage,
  makeFakeHostConfig,
  type StoreStep,
  type UpdateErrorCode,
} from "./fake-host-config";

const ID = "linkedin";
const KEY = configKey(ID);
const ROW = { clientId: "a", accounts: [{ id: "x" }], note: SENTINEL };

const caught = (fn: () => void): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};

afterEach(() => {
  vi.restoreAllMocks();
});

function expectRefusal(e: unknown, code: UpdateErrorCode, id = ID) {
  expect(e).toBeInstanceOf(Error);
  expect((e as { code?: string }).code).toBe(code);
  expect((e as { key?: string }).key).toBe(configKey(id));
  expect((e as Error).message).toBe(expectedMessage(code, id));
}

/** An updater that merges `extra` into the current row (the fake counts its calls). */
const merge = (extra: Record<string, unknown>) => (current: unknown) => ({
  ...(current as Record<string, unknown> | null),
  ...extra,
});

describe("fake host connector-config update: scenario table S1-S14", () => {
  it("(S1) row present: the updater gets the parsed row; 1 swap; the cache entry is evicted, so the next read reads the row", () => {
    const fake = makeFakeHostConfig({ cacheTtlMs: 10_000 });
    fake.setRaw(ID, JSON.stringify(ROW));
    expect(fake.read(ID, null)).toEqual(ROW);
    expect(fake.cacheValue(ID)).toEqual(ROW);
    const seen: unknown[] = [];
    fake.update(ID, (c) => {
      seen.push(c);
      return { ...(c as object), clientId: "b" };
    });
    expect(seen).toEqual([ROW]);
    expect(fake.state.portCalls).toEqual({ readRaw: 1, compareAndSwap: 1, insertIfAbsent: 0 });
    expect(fake.rowOf(ID)).toEqual({ ...ROW, clientId: "b" });
    expect(fake.cacheValue(ID)).toBeUndefined();
    // Another writer changes the row after the swap landed: the next read
    // inside the TTL reads that row, not the text this update stored.
    fake.otherProcessWrites(ID, { ...ROW, clientId: "c" });
    expect(fake.read(ID, null)).toEqual({ ...ROW, clientId: "c" });
  });

  it("(S2b) row absent with a cache: the insert lands and evicts the cache entry", () => {
    const fake = makeFakeHostConfig({ cacheTtlMs: 10_000 });
    expect(fake.read(ID, null)).toBeNull();
    fake.update(ID, () => ({ clientId: "b" }));
    expect(fake.rowOf(ID)).toEqual({ clientId: "b" });
    expect(fake.cacheValue(ID)).toBeUndefined();
  });

  it("(S2) row absent: the updater gets null; the insert lands; exactly 1 readRaw", () => {
    const fake = makeFakeHostConfig();
    const seen: unknown[] = [];
    fake.update(ID, (c) => {
      seen.push(c);
      return { clientId: "b" };
    });
    expect(seen).toEqual([null]);
    expect(fake.state.portCalls).toEqual({ readRaw: 1, compareAndSwap: 0, insertIfAbsent: 1 });
    expect(fake.rowOf(ID)).toEqual({ clientId: "b" });
  });

  it("(S3) beforePersist(1) changes the row: swap 1 misses; attempt 2 merges; updater x2", () => {
    const fake = makeFakeHostConfig();
    fake.setRaw(ID, JSON.stringify(ROW));
    fake.beforePersist((n) => {
      if (n === 1) fake.otherProcessWrites(ID, { ...ROW, accounts: [{ id: "x" }, { id: "y" }] });
    });
    fake.update(ID, merge({ clientId: "b" }));
    expect(fake.rowOf(ID)).toEqual({ ...ROW, clientId: "b", accounts: [{ id: "x" }, { id: "y" }] });
    expect(fake.state.updaterCalls).toBe(2);
    expect(fake.state.portCalls.compareAndSwap).toBe(2);
  });

  it("(S4a) row absent; beforePersist(1) creates another row: the insert misses; attempt 2 swaps over it", () => {
    const fake = makeFakeHostConfig();
    fake.beforePersist((n) => {
      if (n === 1) fake.otherProcessWrites(ID, { accounts: [{ id: "new" }] });
    });
    fake.update(ID, merge({ clientId: "b" }));
    expect(fake.rowOf(ID)).toEqual({ accounts: [{ id: "new" }], clientId: "b" });
    expect(fake.state.updaterCalls).toBe(2);
    expect(fake.state.portCalls).toEqual({ readRaw: 2, compareAndSwap: 1, insertIfAbsent: 1 });
  });

  it("(S4b) row absent; afterInsert runs another merge over the inserted row: returns after the insert, updater x1, readRaw x1", () => {
    const fake = makeFakeHostConfig();
    fake.afterInsert(() => fake.otherProcessWrites(ID, { clientId: "b", accounts: [{ id: "other" }] }));
    expect(() => fake.update(ID, merge({ clientId: "b" }))).not.toThrow();
    expect(fake.state.updaterCalls).toBe(1);
    expect(fake.state.portCalls.readRaw).toBe(1);
    expect(fake.rowOf(ID)).toEqual({ clientId: "b", accounts: [{ id: "other" }] });
  });

  it("(S4c) row absent; beforePersist(1) inserts bytes equal to this call's next text: not success, attempt 2 runs", () => {
    const fake = makeFakeHostConfig();
    fake.beforePersist((n) => {
      if (n === 1) fake.setRaw(ID, JSON.stringify({ clientId: "b" }));
    });
    fake.update(ID, merge({ clientId: "b" }));
    expect(fake.state.updaterCalls).toBe(2);
    expect(fake.state.portCalls).toEqual({ readRaw: 2, compareAndSwap: 1, insertIfAbsent: 1 });
    expect(fake.rowOf(ID)).toEqual({ clientId: "b" });
  });

  it("(S5) a stale cache entry plus a newer stored row: the updater sees the stored row", () => {
    const fake = makeFakeHostConfig({ cacheTtlMs: 10_000 });
    fake.setRaw(ID, JSON.stringify(ROW));
    expect(fake.read(ID, null)).toEqual(ROW);
    fake.otherProcessWrites(ID, { ...ROW, clientId: "newer" });
    fake.advance(2_000);
    expect(fake.read(ID, null)).toEqual(ROW);
    const seen: unknown[] = [];
    fake.update(ID, (c) => {
      seen.push(c);
      return c;
    });
    expect(seen).toEqual([{ ...ROW, clientId: "newer" }]);
  });

  it("(S6) beforePersist(n) changes the row for every n: CONFLICT after 5; updater x5; the competitor's last row; cache evicted; no sentinel", () => {
    const spies = consoleSpies();
    const fake = makeFakeHostConfig({ cacheTtlMs: 10_000 });
    fake.setRaw(ID, JSON.stringify(ROW));
    fake.read(ID, null);
    fake.beforePersist((n) => fake.otherProcessWrites(ID, { ...ROW, accounts: [{ id: `w${n}` }] }));
    const e = caught(() => fake.update(ID, merge({ clientId: SENTINEL })));
    expect(fake.rowOf(ID)).toEqual({ ...ROW, accounts: [{ id: "w5" }] });
    expectRefusal(e, "CONNECTOR_CONFIG_CONFLICT");
    expect(fake.state.updaterCalls).toBe(5);
    expect(fake.cacheValue(ID)).toBeUndefined();
    expect(fake.state.logs).toEqual([`[connector-config.update] key=${KEY} code=CONNECTOR_CONFIG_CONFLICT`]);
    expectNoSentinel(e, fake.state.logs, spies);
  });

  for (const [label, text] of [["{not json", "{not json"], ["an empty text", ""]] as const) {
    it(`(S7) stored text ${label}: ROW_UNPARSEABLE; updater x0; no persist`, () => {
      const fake = makeFakeHostConfig();
      fake.setRaw(ID, text);
      const e = caught(() => fake.update(ID, merge({ clientId: "b" })));
      expectRefusal(e, "CONNECTOR_CONFIG_ROW_UNPARSEABLE");
      expect(fake.state.updaterCalls).toBe(0);
      expect(fake.state.persists).toBe(0);
      expect(fake.rawOf(ID)).toBe(text);
    });
  }

  it("(S8) the updater throws a sentinel error: UPDATER_FAILED; no persist; no further attempt; no sentinel", () => {
    const spies = consoleSpies();
    const fake = makeFakeHostConfig();
    fake.setRaw(ID, JSON.stringify(ROW));
    const e = caught(() =>
      fake.update(ID, () => {
        throw Object.assign(new Error(SENTINEL), { code: SENTINEL, cause: SENTINEL });
      }),
    );
    expectRefusal(e, "CONNECTOR_CONFIG_UPDATER_FAILED");
    expect(fake.state.updaterCalls).toBe(1);
    expect(fake.state.persists).toBe(0);
    expect(fake.rowOf(ID)).toEqual(ROW);
    expectNoSentinel(e, fake.state.logs, spies);
  });

  const cyclic: Record<string, unknown> = { note: SENTINEL };
  cyclic.self = cyclic;
  const INVALID: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["a function", () => SENTINEL],
    ["a thenable", { then: () => SENTINEL, note: SENTINEL }],
    ["a promise", Promise.resolve(SENTINEL)],
    ["a cyclic object", cyclic],
    ["a BigInt", BigInt(1)],
    ["a symbol", Symbol(SENTINEL)],
  ];
  for (const [label, value] of INVALID) {
    it(`(S9) the updater returns ${label}: UPDATE_INVALID; no persist; no sentinel`, () => {
      const spies = consoleSpies();
      const fake = makeFakeHostConfig();
      fake.setRaw(ID, JSON.stringify(ROW));
      const e = caught(() => fake.update(ID, () => value));
      expectRefusal(e, "CONNECTOR_CONFIG_UPDATE_INVALID");
      expect(fake.state.persists).toBe(0);
      expect(fake.rowOf(ID)).toEqual(ROW);
      expectNoSentinel(e, fake.state.logs, spies);
    });
  }

  it("(S10) beforePersist(1) writes B and then A: swap 1 lands with f(A)", () => {
    const fake = makeFakeHostConfig();
    fake.setRaw(ID, JSON.stringify(ROW));
    fake.beforePersist((n) => {
      if (n !== 1) return;
      fake.otherProcessWrites(ID, { other: "B" });
      fake.otherProcessWrites(ID, ROW);
    });
    fake.update(ID, merge({ clientId: "b" }));
    expect(fake.rowOf(ID)).toEqual({ ...ROW, clientId: "b" });
    expect(fake.state.updaterCalls).toBe(1);
  });

  it("(S11) beforePersist(1) deletes the row: swap 1 misses; attempt 2 gets null; the insert lands", () => {
    const fake = makeFakeHostConfig();
    fake.setRaw(ID, JSON.stringify(ROW));
    fake.beforePersist((n) => {
      if (n === 1) fake.otherProcessDeletes(ID);
    });
    const seen: unknown[] = [];
    fake.update(ID, (c) => {
      seen.push(c);
      return { ...(c as object), clientId: "b" };
    });
    expect(seen).toEqual([ROW, null]);
    expect(fake.rowOf(ID)).toEqual({ clientId: "b" });
    expect(fake.state.portCalls).toEqual({ readRaw: 2, compareAndSwap: 1, insertIfAbsent: 1 });
  });

  it("(S12) a sealed id (nango): UNSUPPORTED before any store statement; the updater is never called", () => {
    const fake = makeFakeHostConfig();
    fake.setRaw("nango", JSON.stringify({ secretKey: SENTINEL }));
    const e = caught(() => fake.update("nango", () => ({})));
    expectRefusal(e, "CONNECTOR_CONFIG_UPDATE_UNSUPPORTED", "nango");
    expect(fake.state.portCalls).toEqual({ readRaw: 0, compareAndSwap: 0, insertIfAbsent: 0 });
    expect(fake.state.updaterCalls).toBe(0);
    expect(fake.rawOf("nango")).toBe(JSON.stringify({ secretKey: SENTINEL }));
  });

  const STEPS: Array<[StoreStep, boolean]> = [
    ["readRaw", true],
    ["compareAndSwap", true],
    ["insertIfAbsent", false],
  ];
  for (const [step, present] of STEPS) {
    it(`(S13) ${step} throws a sentinel store error: STORE_FAILED; no retry; one log line with the SQLSTATE; no sentinel`, () => {
      const spies = consoleSpies();
      const fake = makeFakeHostConfig();
      if (present) fake.setRaw(ID, JSON.stringify(ROW));
      fake.storeFails(step);
      const e = caught(() => fake.update(ID, merge({ clientId: "b" })));
      expectRefusal(e, "CONNECTOR_CONFIG_STORE_FAILED");
      expect(fake.state.portCalls.readRaw).toBe(1);
      expect(fake.state.updaterCalls).toBe(step === "readRaw" ? 0 : 1);
      expect(fake.state.logs).toEqual([
        `[connector-config.update] key=${KEY} code=CONNECTOR_CONFIG_STORE_FAILED sqlstate=40001`,
      ]);
      expect(fake.rawOf(ID)).toBe(present ? JSON.stringify(ROW) : undefined);
      expectNoSentinel(e, fake.state.logs, spies);
    });
  }

  it("(S13) a store error whose code is no SQLSTATE logs no sqlstate", () => {
    const fake = makeFakeHostConfig();
    fake.setRaw(ID, JSON.stringify(ROW));
    fake.storeFails("compareAndSwap", Object.assign(new Error(SENTINEL), { code: SENTINEL }));
    const e = caught(() => fake.update(ID, merge({ clientId: "b" })));
    expectRefusal(e, "CONNECTOR_CONFIG_STORE_FAILED");
    expect(fake.state.logs).toEqual([`[connector-config.update] key=${KEY} code=CONNECTOR_CONFIG_STORE_FAILED`]);
  });

  it("(S14) beforePersist(1) rewrites the same object with its keys reordered: swap 1 misses; attempt 2 lands", () => {
    const fake = makeFakeHostConfig();
    fake.setRaw(ID, JSON.stringify(ROW));
    fake.beforePersist((n) => {
      if (n === 1) fake.setRaw(ID, JSON.stringify({ note: SENTINEL, accounts: [{ id: "x" }], clientId: "a" }));
    });
    fake.update(ID, merge({ clientId: "b" }));
    expect(fake.state.updaterCalls).toBe(2);
    expect(fake.state.portCalls.compareAndSwap).toBe(2);
    expect(fake.rowOf(ID)).toEqual({ ...ROW, clientId: "b" });
  });
});

// The host module's table "the storable value is an allow-list of JSON kinds"
// (C1), with the same cases: the fake refuses what the host refuses and stores
// what the host stores.
describe("fake host connector-config update: the storable value is an allow-list of JSON kinds (C1)", () => {
  class Settings {
    note = SENTINEL;
  }
  const nestedCycle = () => {
    const row: Record<string, unknown> = { note: SENTINEL, inner: {} };
    (row.inner as Record<string, unknown>).back = row;
    return row;
  };
  class Rows extends Array<unknown> {}
  const deepChain = () => {
    let row: unknown = SENTINEL;
    for (let i = 0; i < 100_000; i += 1) row = { row };
    return row;
  };
  const REFUSED_VALUES: Array<[string, () => unknown]> = [
    ["NaN", () => ({ note: SENTINEL, n: NaN })],
    ["Infinity", () => ({ note: SENTINEL, n: Infinity })],
    ["-Infinity", () => [SENTINEL, -Infinity]],
    ["a top-level NaN", () => NaN],
    ["a Map", () => ({ m: new Map([["k", SENTINEL]]) })],
    ["a Set", () => new Set([SENTINEL])],
    ["a Date", () => ({ note: SENTINEL, at: new Date(0) })],
    ["a nested function", () => ({ note: SENTINEL, f: () => SENTINEL })],
    ["a nested symbol", () => ({ note: SENTINEL, s: Symbol(SENTINEL) })],
    ["a symbol key", () => ({ [Symbol("k")]: SENTINEL, note: SENTINEL })],
    ["a nested bigint", () => ({ note: SENTINEL, n: BigInt(7) })],
    ["a class instance", () => new Settings()],
    ["a boxed number", () => ({ note: SENTINEL, n: Object(1) as unknown })],
    ["an accessor property", () => ({ get note() { return SENTINEL; } })],
    ["an array hole", () => {
      const holey: unknown[] = new Array(3);
      holey[0] = SENTINEL;
      holey[2] = SENTINEL;
      return holey;
    }],
    ["undefined in an array", () => [SENTINEL, undefined]],
    ["a nested cycle", nestedCycle],
    ["an Array subclass instance", () => Rows.from([SENTINEL])],
    ["an array with an extra key", () => Object.assign([SENTINEL], { x: SENTINEL })],
    ["an array with a trailing hole", () => {
      const trailing: unknown[] = [SENTINEL];
      trailing.length = 2;
      return trailing;
    }],
    ["an array with a hole and an extra key", () => {
      const holey: unknown[] = new Array(3);
      holey[0] = SENTINEL;
      holey[2] = SENTINEL;
      return Object.assign(holey, { x: SENTINEL });
    }],
    ["a non-enumerable property", () => Object.defineProperty({ a: 1 }, "hidden", { value: SENTINEL, enumerable: false })],
    ["a proxy whose ownKeys trap throws", () => new Proxy({ note: SENTINEL }, {
      ownKeys() {
        throw new Error(SENTINEL);
      },
    })],
    ["a 100000-deep chain", deepChain],
    ["a thenable whose then throws", () => ({
      note: SENTINEL,
      then() {
        throw 0;
      },
    })],
    ["a proxy whose getPrototypeOf trap throws", () => new Proxy({ note: SENTINEL }, {
      getPrototypeOf() {
        throw new Error(SENTINEL);
      },
    })],
    ["a proxy whose own key has no descriptor", () => new Proxy({}, {
      ownKeys: () => ["note"],
      getOwnPropertyDescriptor: () => undefined,
      get: () => SENTINEL,
    })],
    ["a proxy whose then read throws", () => new Proxy({ note: SENTINEL }, {
      get(target, name) {
        if (name === "then") throw new Error(SENTINEL);
        return Reflect.get(target, name);
      },
    })],
  ];
  for (const [label, make] of REFUSED_VALUES) {
    it(`(C1) the updater returns a value with ${label}: UPDATE_INVALID before any swap or insert; no sentinel`, () => {
      const spies = consoleSpies();
      const fake = makeFakeHostConfig({ cacheTtlMs: 10_000 });
      fake.setRaw(ID, JSON.stringify(ROW));
      fake.read(ID, null);
      const e = caught(() => fake.update(ID, make));
      expectRefusal(e, "CONNECTOR_CONFIG_UPDATE_INVALID");
      expect(fake.state.portCalls).toEqual({ readRaw: 1, compareAndSwap: 0, insertIfAbsent: 0 });
      expect(fake.state.persists).toBe(0);
      expect(fake.rawOf(ID)).toBe(JSON.stringify(ROW));
      expect(fake.cacheValue(ID)).toBeUndefined();
      expectNoSentinel(e, fake.state.logs, spies);
    });
  }

  const ALLOWED_VALUES: Array<[string, () => unknown]> = [
    ["nested objects and arrays", () => ({ b: 2, a: [1, { c: null }], s: "\u00e9", t: false, n: 1.5 })],
    ["a null-prototype object", () => Object.assign(Object.create(null), { a: 1 })],
    ["an own __proto__ key", () => JSON.parse('{"__proto__":{"x":1},"y":2}')],
    ["a shared (acyclic) reference", () => {
      const shared = { s: 1 };
      return { a: shared, b: shared };
    }],
    ["an object property that is undefined (dropped, as JSON drops it)", () => ({ a: 1, gone: undefined })],
    ["a plain object with a non-function then", () => ({ then: "later" })],
  ];
  for (const [label, make] of ALLOWED_VALUES) {
    it(`(C1) an allowed value (${label}) is stored byte-equal to its JSON text`, () => {
      const fake = makeFakeHostConfig();
      fake.setRaw(ID, JSON.stringify(ROW));
      fake.update(ID, make);
      expect(fake.rawOf(ID)).toBe(JSON.stringify(make()));
      expect(fake.state.portCalls.compareAndSwap).toBe(1);
    });
  }
});

describe("fake host connector-config read and write: the host's read model", () => {
  it("a missing row, an empty text and an unparseable text read as the fallback", () => {
    const fake = makeFakeHostConfig();
    expect(fake.read(ID, "fb")).toBe("fb");
    fake.setRaw(ID, "");
    expect(fake.read(ID, "fb")).toBe("fb");
    fake.setRaw(ID, "{not json");
    expect(fake.read(ID, "fb")).toBe("fb");
  });

  it("with a cache, a read inside the TTL serves this process's cache; after the TTL it reads the row", () => {
    const fake = makeFakeHostConfig({ cacheTtlMs: 10_000 });
    fake.setRaw(ID, JSON.stringify(ROW));
    expect(fake.read(ID, null)).toEqual(ROW);
    fake.otherProcessWrites(ID, { clientId: "newer" });
    fake.advance(9_999);
    expect(fake.read(ID, null)).toEqual(ROW);
    fake.advance(1);
    expect(fake.read(ID, null)).toEqual({ clientId: "newer" });
  });

  it("write calls beforePersist at entry, then stores the text", () => {
    const fake = makeFakeHostConfig();
    const order: string[] = [];
    fake.beforePersist((n) => order.push(`hook ${n} raw=${fake.rawOf(ID) ?? "none"}`));
    fake.write(ID, { clientId: "b" });
    expect(order).toEqual(["hook 1 raw=none"]);
    expect(fake.rawOf(ID)).toBe(JSON.stringify({ clientId: "b" }));
    expect(fake.state.landed).toBe(1);
  });
});
