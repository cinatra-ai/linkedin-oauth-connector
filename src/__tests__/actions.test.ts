/**
 * saveLinkedInOAuthConnectionAction merge-preserve contract
 * (cinatra-ai/linkedin-connector#9 — the admin credentials half of the split).
 *
 * The admin form writes the LinkedIn app credentials under the connector-config
 * key "linkedin" — the SAME row the host's `@/lib/linkedin-api` reads. The save
 * MUST:
 *   1. write key "linkedin" (the old per-user package wrote the dead key
 *      "linkedin_connection", which nobody read — the orphaned-credentials bug);
 *   2. PRESERVE connected accounts / loggingEnabled / redirectUri on every save
 *      (a naive overwrite would wipe accounts materialized by the connect path);
 *   3. keep the stored client secret when the form submits a blank secret
 *      (write-only field, "leave blank to keep");
 *   4. keep the stored client id when the form submits a blank id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    requireExtensionAction: vi.fn(async () => undefined),
    getExtensionConnectorConfig: vi.fn(
      <T,>(_pkg: string, key: string, fallback: T): T =>
        store.has(key) ? (store.get(key) as T) : fallback,
    ),
    setExtensionConnectorConfig: vi.fn((_pkg: string, key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
});

const {
  store,
  requireExtensionAction,
  getExtensionConnectorConfig,
  setExtensionConnectorConfig,
} = h;

vi.mock("@cinatra-ai/sdk-extensions", () => ({
  requireExtensionAction: h.requireExtensionAction,
  getExtensionConnectorConfig: h.getExtensionConnectorConfig,
  setExtensionConnectorConfig: h.setExtensionConnectorConfig,
}));

import { saveLinkedInOAuthConnectionAction } from "../actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function run(fd: FormData) {
  // The action returns normally (no redirect) — the client form notifies on
  // success; a redirect() would throw NEXT_REDIRECT the form would mis-handle.
  await expect(saveLinkedInOAuthConnectionAction(fd)).resolves.toBeUndefined();
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
});

describe("saveLinkedInOAuthConnectionAction", () => {
  it("writes the credentials under the shared 'linkedin' key (not the dead 'linkedin_connection')", async () => {
    await run(form({ clientId: "id-1", clientSecret: "sec-1" }));
    expect(requireExtensionAction).toHaveBeenCalledWith(
      "@cinatra-ai/linkedin-oauth-connector",
      "manage",
    );
    expect(setExtensionConnectorConfig).toHaveBeenCalledTimes(1);
    const [, key, value] = setExtensionConnectorConfig.mock.calls[0]!;
    expect(key).toBe("linkedin");
    expect(value).toMatchObject({ clientId: "id-1", clientSecret: "sec-1" });
  });

  it("preserves accounts / loggingEnabled / redirectUri across a credential save", async () => {
    store.set("linkedin", {
      clientId: "old-id",
      clientSecret: "old-sec",
      redirectUri: "https://nango.example/callback",
      loggingEnabled: false,
      accounts: [{ id: "acc-1", name: "Ada" }],
    });
    await run(form({ clientId: "new-id", clientSecret: "new-sec" }));
    const [, , value] = setExtensionConnectorConfig.mock.calls[0]! as [string, string, Record<string, unknown>];
    expect(value).toMatchObject({
      clientId: "new-id",
      clientSecret: "new-sec",
      redirectUri: "https://nango.example/callback",
      loggingEnabled: false,
      accounts: [{ id: "acc-1", name: "Ada" }],
    });
  });

  it("keeps the stored secret when a blank secret is submitted", async () => {
    store.set("linkedin", { clientId: "id-1", clientSecret: "keep-me" });
    await run(form({ clientId: "id-2", clientSecret: "" }));
    const [, , value] = setExtensionConnectorConfig.mock.calls[0]! as [string, string, Record<string, unknown>];
    expect(value.clientSecret).toBe("keep-me");
    expect(value.clientId).toBe("id-2");
  });

  it("keeps the stored client id when a blank id is submitted", async () => {
    store.set("linkedin", { clientId: "keep-id", clientSecret: "sec-1" });
    await run(form({ clientId: "", clientSecret: "new-sec" }));
    const [, , value] = setExtensionConnectorConfig.mock.calls[0]! as [string, string, Record<string, unknown>];
    expect(value.clientId).toBe("keep-id");
    expect(value.clientSecret).toBe("new-sec");
  });
});
