/**
 * saveLinkedInOAuthConnectionAction refuses and writes nothing.
 *
 * The shared connector-config row "linkedin" also holds the connected accounts,
 * the logging flag and the redirect URI that the LinkedIn connector writes. A
 * read followed by a whole-row write loses a change stored in between, so the
 * row changes only through the host's atomic `update` (src/register.ts). This
 * server action cannot reach that road, so it MUST:
 *   1. check `manage` first (fail closed: a denial propagates, nothing else runs);
 *   2. refuse every save with LINKEDIN_CONFIG_BUNDLED_SAVE_REFUSED;
 *   3. never read, write or delete the connector config;
 *   4. carry no submitted value in its error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SENTINEL = "sentinel-5c1d-form-value";

const h = vi.hoisted(() => ({
  requireExtensionAction: vi.fn(async () => undefined),
  getExtensionConnectorConfig: vi.fn(),
  setExtensionConnectorConfig: vi.fn(),
  deleteExtensionConnectorConfig: vi.fn(),
}));

vi.mock("@cinatra-ai/sdk-extensions", () => ({
  requireExtensionAction: h.requireExtensionAction,
  getExtensionConnectorConfig: h.getExtensionConnectorConfig,
  setExtensionConnectorConfig: h.setExtensionConnectorConfig,
  deleteExtensionConnectorConfig: h.deleteExtensionConnectorConfig,
}));

import { saveLinkedInOAuthConnectionAction } from "../actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function refusal(fd: FormData): Promise<unknown> {
  try {
    await saveLinkedInOAuthConnectionAction(fd);
  } catch (e) {
    return e;
  }
  throw new Error("the save did not refuse");
}

function expectNoConfigAccess() {
  expect(h.getExtensionConnectorConfig).not.toHaveBeenCalled();
  expect(h.setExtensionConnectorConfig).not.toHaveBeenCalled();
  expect(h.deleteExtensionConnectorConfig).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

const SUBMITS: Array<[string, Record<string, string>]> = [
  ["new credentials", { clientId: SENTINEL, clientSecret: SENTINEL }],
  ["new credentials with the Community Management box ticked", { clientId: SENTINEL, clientSecret: SENTINEL, organizationPosting: "true" }],
  ["blank fields (keep the stored values)", { clientId: "", clientSecret: "" }],
  ["a blank secret only", { clientId: SENTINEL, clientSecret: "" }],
];

describe("saveLinkedInOAuthConnectionAction", () => {
  for (const [label, entries] of SUBMITS) {
    it(`refuses a submit of ${label}: manage is checked first, nothing is read or written`, async () => {
      const e = await refusal(form(entries));
      expect(h.requireExtensionAction).toHaveBeenCalledTimes(1);
      expect(h.requireExtensionAction).toHaveBeenCalledWith("@cinatra-ai/linkedin-oauth-connector", "manage");
      expect(e).toBeInstanceOf(Error);
      expect((e as { code?: unknown }).code).toBe("LINKEDIN_CONFIG_BUNDLED_SAVE_REFUSED");
      expect((e as Error).message).toBe(
        "This setup page cannot save the LinkedIn settings safely, so nothing was changed. The settings are saved through the connector's registered save action.",
      );
      expect(String(e)).not.toContain(SENTINEL);
      expect(JSON.stringify(e)).not.toContain(SENTINEL);
      expect((e as { cause?: unknown }).cause).toBeUndefined();
      expectNoConfigAccess();
    });
  }

  it("propagates a manage denial and does nothing else", async () => {
    const denial = new Error("denied");
    h.requireExtensionAction.mockRejectedValueOnce(denial);
    expect(await refusal(form({ clientId: SENTINEL, clientSecret: SENTINEL }))).toBe(denial);
    expectNoConfigAccess();
  });
});
