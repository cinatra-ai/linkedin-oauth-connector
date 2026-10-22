// A fake of the host's connector-config service (`@cinatra-ai/host:connector-config`)
// with its atomic `update` member, modelled over RAW TEXT the way the host stores
// a row (one text value per key of the host table `metadata`).
//
// It is held to the update scenario table S1-S14, not to the host module line by
// line: fake-host-config.conformance.test.ts runs the table against it. The kind
// gate bans `@/` imports in every file of this package, test files included, so
// this fake cannot import the host module.
//
// - read(id, fallback): with `cacheTtlMs`, a hit of this process's cache inside
//   the TTL; otherwise the stored text, where a missing row or "" is `fallback`
//   and a text that does not parse is `fallback` too. The value read is cached.
// - write(id, value): `beforePersist(++persists)` at ENTRY (the old road reaches
//   the hook here), then the text JSON.stringify(value), then the cache.
// - update(id, updater): the host rules U0-U11: the raw text is read on every
//   attempt (never the cache), the bytes are compared, the insert reports its
//   result, at most 5 attempts, fixed value-free errors with no cause, one log
//   line per thrown error. `beforePersist(++persists)` runs right before each
//   swap or insert, `afterInsert` right after an insert that landed.
// - Interleavings are forced by the synchronous hooks; the clock is manual.
import { expect, vi } from "vitest";

export const SENTINEL = "sentinel-7f3a-row-value";
export const UPDATE_ATTEMPTS = 5;
const SEALED_IDS = new Set(["nango"]);

const MESSAGES = {
  CONNECTOR_CONFIG_CONFLICT: ["ConnectorConfigConflictError", "Connector config <key> changed under every update attempt; nothing was written."],
  CONNECTOR_CONFIG_ROW_UNPARSEABLE: ["ConnectorConfigRowUnparseableError", "Connector config <key> holds text that is not JSON; nothing was written."],
  CONNECTOR_CONFIG_UPDATER_FAILED: ["ConnectorConfigUpdaterFailedError", "Connector config <key>: the updater failed; nothing was written."],
  CONNECTOR_CONFIG_UPDATE_INVALID: ["ConnectorConfigUpdateInvalidError", "Connector config <key>: the updater returned no storable value; nothing was written."],
  CONNECTOR_CONFIG_STORE_FAILED: ["ConnectorConfigStoreFailedError", "Connector config <key>: the store failed; the row may or may not have changed."],
  CONNECTOR_CONFIG_UPDATE_UNSUPPORTED: ["ConnectorConfigUpdateUnsupportedError", "Connector config <key> has sealed fields; update is not supported for it; nothing was written."],
} as const;
export type UpdateErrorCode = keyof typeof MESSAGES;

/** The host's error shape: own `code` and `key`, a fixed message, no cause. */
export class FakeConnectorConfigUpdateError extends Error {
  readonly code: UpdateErrorCode;
  readonly key: string;
  constructor(code: UpdateErrorCode, key: string) {
    super(MESSAGES[code][1].replace("<key>", key));
    this.name = MESSAGES[code][0];
    this.code = code;
    this.key = key;
  }
}

export const configKey = (id: string): string => `connector_config:${id}`;
export const expectedMessage = (code: UpdateErrorCode, id: string): string =>
  MESSAGES[code][1].replace("<key>", configKey(id));

export type StoreStep = "readRaw" | "compareAndSwap" | "insertIfAbsent";

/** The store error of `storeFails`: the SENTINEL text with a SQLSTATE code. */
export const sentinelStoreError = (): Error => Object.assign(new Error(SENTINEL), { code: "40001" });

const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));

function isThenable(v: unknown): boolean {
  if ((typeof v !== "object" || v === null) && typeof v !== "function") return false;
  return typeof (v as { then?: unknown }).then === "function";
}

function sqlstateOf(e: unknown): string | undefined {
  try {
    if (e === null || typeof e !== "object" || !Object.prototype.hasOwnProperty.call(e, "code")) return undefined;
    const code: unknown = (e as { code?: unknown }).code;
    return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export type FakeHostConfig = ReturnType<typeof makeFakeHostConfig>;

export function makeFakeHostConfig(opts: { cacheTtlMs?: number } = {}) {
  const state = {
    raw: new Map<string, string>(),
    cache: new Map<string, { value: unknown; expiresAt: number }>(),
    now: 0,
    /** Every persist step entered: write() entries plus swaps and inserts. */
    persists: 0,
    /** Persists that changed the stored row (write, a landed swap or insert). */
    landed: 0,
    updaterCalls: 0,
    logs: [] as string[],
    portCalls: { readRaw: 0, compareAndSwap: 0, insertIfAbsent: 0 },
  };
  let beforePersistHook: ((n: number) => void) | undefined;
  let afterInsertHook: ((id: string) => void) | undefined;
  let failure: { step: StoreStep; error: unknown } | undefined;
  // A value the store hands over in place of the parsed text (a value no text
  // can carry: NaN, a Map, undefined, an object without a prototype). Cleared
  // when a persist of that id lands.
  let handed: { id: string; value: unknown } | undefined;

  const cacheSet = (id: string, value: unknown) => {
    if (opts.cacheTtlMs !== undefined) state.cache.set(id, { value: clone(value), expiresAt: state.now + opts.cacheTtlMs });
  };
  const landedOn = (id: string, text: string) => {
    state.raw.set(id, text);
    state.landed += 1;
    if (handed?.id === id) handed = undefined;
  };

  const readImpl = (id: string, fallback: unknown): unknown => {
    if (opts.cacheTtlMs !== undefined) {
      const hit = state.cache.get(id);
      if (hit && hit.expiresAt > state.now) return clone(hit.value);
    }
    let value: unknown = fallback;
    if (handed?.id === id) {
      return handed.value;
    }
    const raw = state.raw.get(id);
    if (raw) {
      try {
        value = JSON.parse(raw);
      } catch {
        value = fallback;
      }
    }
    cacheSet(id, value);
    return clone(value);
  };

  const writeImpl = (id: string, value: unknown): void => {
    state.persists += 1;
    beforePersistHook?.(state.persists);
    const text = JSON.stringify(value);
    landedOn(id, text);
    cacheSet(id, JSON.parse(text));
  };

  const deleteImpl = (id: string): void => {
    state.raw.delete(id);
    state.cache.delete(id);
    if (handed?.id === id) handed = undefined;
  };

  const step = (name: StoreStep) => {
    state.portCalls[name] += 1;
    if (failure?.step === name) {
      const { error } = failure;
      failure = undefined;
      throw error;
    }
  };

  const updateImpl = (id: string, updater: (current: unknown) => unknown): void => {
    const key = configKey(id);
    // U8 + U10 + U11: evict, log one fixed line, throw the fixed error (the
    // underlying error is never attached; only an allow-listed SQLSTATE is logged).
    function refuse(code: UpdateErrorCode, cause?: unknown): never {
      state.cache.delete(id);
      const sqlstate = code === "CONNECTOR_CONFIG_STORE_FAILED" ? sqlstateOf(cause) : undefined;
      state.logs.push(`[connector-config.update] key=${key} code=${code}${sqlstate ? ` sqlstate=${sqlstate}` : ""}`);
      throw new FakeConnectorConfigUpdateError(code, key);
    }
    if (SEALED_IDS.has(id)) refuse("CONNECTOR_CONFIG_UPDATE_UNSUPPORTED");
    for (let attempt = 1; attempt <= UPDATE_ATTEMPTS; attempt++) {
      let raw: string | null = null;
      try {
        step("readRaw");
        raw = state.raw.get(id) ?? null;
      } catch (e) {
        refuse("CONNECTOR_CONFIG_STORE_FAILED", e);
      }
      let current: unknown = null;
      if (raw !== null) {
        if (handed?.id === id) current = handed.value;
        else {
          try {
            current = JSON.parse(raw);
          } catch {
            refuse("CONNECTOR_CONFIG_ROW_UNPARSEABLE");
          }
        }
      }
      let next: unknown;
      state.updaterCalls += 1;
      try {
        next = updater(current);
      } catch {
        refuse("CONNECTOR_CONFIG_UPDATER_FAILED");
      }
      let invalid = next === undefined || typeof next === "function";
      let nextRaw: unknown;
      try {
        invalid = invalid || isThenable(next);
        if (!invalid) nextRaw = JSON.stringify(next);
      } catch {
        invalid = true;
      }
      if (invalid || typeof nextRaw !== "string") refuse("CONNECTOR_CONFIG_UPDATE_INVALID");
      const text = nextRaw as string;
      state.persists += 1;
      beforePersistHook?.(state.persists);
      let done = false;
      try {
        if (raw !== null) {
          step("compareAndSwap");
          done = state.raw.get(id) === raw;
        } else {
          step("insertIfAbsent");
          done = !state.raw.has(id);
        }
      } catch (e) {
        refuse("CONNECTOR_CONFIG_STORE_FAILED", e);
      }
      if (done) {
        landedOn(id, text);
        if (raw === null) afterInsertHook?.(id);
        // U8: the value as stored, with a fresh TTL (this fake caches only with cacheTtlMs).
        cacheSet(id, JSON.parse(text));
        return;
      }
    }
    refuse("CONNECTOR_CONFIG_CONFLICT");
  };

  const read = vi.fn(<T,>(id: string, fallback: T): T => readImpl(id, fallback) as T);
  const write = vi.fn((id: string, value: unknown): void => writeImpl(id, value));
  const update = vi.fn((id: string, updater: (current: unknown) => unknown): void => updateImpl(id, updater));
  const del = vi.fn((id: string): void => deleteImpl(id));

  const base = { read, write, delete: del };
  return {
    state,
    read,
    write,
    update,
    delete: del,
    /** The host's provider object: read, write, delete and the additive update. */
    svc: { ...base, update },
    /** A provider of an older host: no `update` member. */
    withoutUpdate: () => ({ ...base }),
    /** A provider whose `update` member is `value` (for example `true`). */
    withUpdate: (value: unknown) => ({ ...base, update: value }),
    /** A provider with members replaced (for example a throwing write and update). */
    withOverrides: (over: Record<string, unknown>) => ({ ...base, update, ...over }),
    beforePersist(fn: ((n: number) => void) | undefined) {
      beforePersistHook = fn;
    },
    afterInsert(fn: ((id: string) => void) | undefined) {
      afterInsertHook = fn;
    },
    /** The next `step` throws `error` (default: the SENTINEL error with SQLSTATE 40001). */
    storeFails(stepName: StoreStep, error: unknown = sentinelStoreError()) {
      failure = { step: stepName, error };
    },
    /** Another process writes the backing row; this process's cache does not see it. */
    otherProcessWrites(id: string, value: unknown) {
      state.raw.set(id, JSON.stringify(value));
    },
    otherProcessDeletes(id: string) {
      state.raw.delete(id);
    },
    setRaw(id: string, text: string) {
      state.raw.set(id, text);
    },
    handOver(id: string, value: unknown, text = '"handed-over"') {
      state.raw.set(id, text);
      handed = { id, value };
    },
    rawOf: (id: string): string | undefined => state.raw.get(id),
    rowOf: (id: string): unknown => {
      const raw = state.raw.get(id);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
    cacheValue: (id: string): unknown => state.cache.get(id)?.value,
    advance(ms: number) {
      state.now += ms;
    },
  };
}

// ---- a host context for register(ctx) over one or more providers

export type UiAction = { id: string; handler: (input?: unknown) => Promise<unknown> };
export const HOST_PKG = "@cinatra-ai/host";
export const STORE_CAP = "@cinatra-ai/host:connector-config";
export const GUARD_CAP = "@cinatra-ai/host:extension-action-guard";

export function makeHostCtx(
  registerFn: (ctx: never) => void,
  opts: {
    store?: unknown;
    guard?: unknown;
    /** Full provider lists per capability, in listing order (overrides store/guard). */
    lists?: Record<string, Array<{ packageName: string; impl: unknown }>>;
    nango?: unknown;
  },
) {
  const guardRequire = vi.fn(async (_pkg: string, _mode: string): Promise<void> => {});
  const guard = "guard" in opts ? opts.guard : { require: guardRequire };
  const lists: Record<string, Array<{ packageName: string; impl: unknown }>> = opts.lists ?? {
    [STORE_CAP]: opts.store === undefined ? [] : [{ packageName: HOST_PKG, impl: opts.store }],
    [GUARD_CAP]: guard === undefined ? [] : [{ packageName: HOST_PKG, impl: guard }],
  };
  const actions = new Map<string, UiAction>();
  const ctx: Record<string, unknown> = {
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
  if (opts.nango !== undefined) ctx.nango = opts.nango;
  registerFn(ctx as never);
  const call = (id: string, input?: unknown): Promise<unknown> => {
    const a = actions.get(id);
    if (!a) throw new Error(`action ${id} not registered`);
    return a.handler(input);
  };
  return { actions, call, guardRequire };
}

/** The outcome of an action: "done", or the rejected error. */
export async function outcomeOf(p: Promise<unknown>): Promise<{ done: true } | { done: false; error: unknown }> {
  try {
    await p;
    return { done: true };
  } catch (error) {
    return { done: false, error };
  }
}

/** Every text form of a thrown value that could carry a stored value. */
export function textsOf(e: unknown): string[] {
  const o = (e ?? {}) as Record<string, unknown>;
  const texts = [String(o.message), String(o.name), String(o.code), String(e)];
  try {
    texts.push(JSON.stringify(e) ?? "");
  } catch {
    texts.push("<unstringifiable>");
  }
  return texts;
}

export const ALLOWED_ERROR_PROPS = ["stack", "message", "name", "code", "key"];

/** Spies on every console method, so a check can read what was printed. */
export const consoleSpies = () =>
  (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m as "log").mockImplementation(() => {}));

/** The sentinel check: no text form of the error, no log line and no console
 *  output carries SENTINEL; no cause; own property names are allow-listed.
 *  Every assertion is labelled LEAK. */
export function expectNoSentinel(e: unknown, logs: string[], spies: Array<{ mock: { calls: unknown[][] } }>) {
  for (const t of textsOf(e)) expect(t, "LEAK: error text").not.toContain(SENTINEL);
  expect((e as { cause?: unknown } | undefined)?.cause, "LEAK: cause").toBeUndefined();
  expect(ALLOWED_ERROR_PROPS, "LEAK: own property names").toEqual(
    expect.arrayContaining(Object.getOwnPropertyNames(Object(e))),
  );
  for (const line of logs) expect(line, "LEAK: log line").not.toContain(SENTINEL);
  for (const s of spies) for (const call of s.mock.calls) expect(JSON.stringify(call), "LEAK: console").not.toContain(SENTINEL);
}
