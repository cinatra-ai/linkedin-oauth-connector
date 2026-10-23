// The LinkedIn OAuth connector's `register(ctx)` server entry.
//
// This entry registers the named actions a setup form calls by id. The host
// dispatches them through `/api/extensions/{installId}/actions/{actionId}`,
// which authorizes the actor at the "use" tier only. Reading the stored
// credentials and saving or clearing them is MANAGE-tier work, so those
// handlers re-check `manage` through the host action-guard service first and
// fail closed when the guard is missing.
//
// Persistence: the shared connector-config row keyed "linkedin". The LinkedIn
// connector reads the same row and writes the connected accounts, the logging
// flag and the redirect URI into it. Every change here starts from the current
// row and changes only the keys this form owns (clientId, clientSecret,
// organizationPosting); every other key is carried through unchanged.
//
// Three rules guard those writes (pinned by src/__tests__/register-row-cas.test.ts):
// - Atomic update only: a write goes through the host's `update` member of its
//   connector-config service, never through `write`. The host reads the stored
//   text (not its cache), runs the change on it and stores the result only if
//   the text is still the same; otherwise it runs the change again on the new
//   row, at most five times (the host's bound). On exhaustion the action
//   refuses with LINKEDIN_CONFIG_CONFLICT and nothing was written. A host
//   without a callable `update` refuses every write with
//   LINKEDIN_CONFIG_CAS_UNAVAILABLE; there is no fallback to `write`. Any other
//   failure refuses with LINKEDIN_CONFIG_SAVE_FAILED, a fixed text that carries
//   no stored value and no cause.
// - Plain-object row: a missing or null row reads as an empty row. Any other
//   stored value that is not a plain object is refused with
//   LINKEDIN_CONFIG_ROW_INVALID by every action that reads the row, and is
//   never written over. A stored text that does not parse is refused the same
//   way by save and clear (the host's update reports it). The reads still get
//   it as the fallback the read was given, exactly like a missing row, so they
//   read it as an empty row. Refusing it on the reads stays OPEN until the host
//   read can report an unparseable row apart from a missing one.
// - Host identity: every host service comes from the provider registered under
//   the host's own identity (hostProvider), never from the first one listed.
//
// Complete credentials (pinned by src/__tests__/save-connection-guards.test.ts):
// a save whose merged row would lack the Client ID or the Client secret refuses
// with LINKEDIN_CONFIG_INCOMPLETE, a fixed text, and writes nothing. A blank
// field still keeps the stored value.
//
// SDK imports are TYPE-ONLY (the serverEntry graph bans SDK value imports);
// host services come through the capability registry.

import type { ExtensionHostContext, HostConnectorConfigService } from "@cinatra-ai/sdk-extensions";

/** The host's connector-config service with its atomic `update` member. The
 *  member is additive on the host's provider object (it is not in the SDK
 *  type), so it is resolved structurally and may be missing on an older host. */
type ConnectorConfigStore = HostConnectorConfigService & {
  update?: (connectorId: string, updater: (current: unknown) => unknown) => void;
};

const PACKAGE_NAME = "@cinatra-ai/linkedin-oauth-connector";
// The shared connector-config key the LinkedIn connector reads and writes.
const LINKEDIN_CONFIG_KEY = "linkedin";

// Hydration proof (pinned by src/__tests__/save-connection-guards.test.ts). The
// host draws the setup form from currentConfig's values, and on any hydration
// failure (the read throws, times out or is not found) it draws a blank form,
// whose Switch shows its default and posts "false". The Client ID text field is
// the proof: the host fills it from currentConfig, so a posted Client ID that is
// non-empty and equals the stored one comes from a hydrated form. A save changes
// organizationPosting only with that proof, or when the stored row has no Client
// ID and its organizationPosting is not true: that row has nothing a blank form
// can lose. A stored true without a stored Client ID (an older version of this
// connector saved such rows) gets no proof, because no Client ID can prove it.
// Without the proof a save whose posted flag differs from the stored flag
// refuses with LINKEDIN_CONFIG_NOT_READ and writes nothing, and a save whose
// posted flag equals it proceeds with the flag unchanged, so nothing is dropped
// silently. Cost: a save that changes the Client ID and the setting together
// refuses; save the Client ID first. A retyped stored Client ID counts as the
// proof.
function hydrationProof(postedId: string, current: LinkedInConnectorConfig): boolean {
  const storedId = str(current.clientId).trim();
  if (storedId === "") return current.organizationPosting !== true;
  return postedId !== "" && postedId === storedId;
}

/** The host-published action-guard service. `require(packageId, mode)`
 *  resolves the actor from the request session and enforces the per-install
 *  extension access policy, failing closed on denial. */
type HostActionGuard = {
  require: (packageId: string, mode: "read" | "manage") => Promise<void>;
};

/** The stored row. Only clientId / clientSecret / organizationPosting are
 *  owned by this form; every other key is carried through unchanged. */
type LinkedInConnectorConfig = Record<string, unknown> & {
  clientId?: unknown;
  clientSecret?: unknown;
  organizationPosting?: unknown;
  redirectUri?: unknown;
};

/** The identity the host registers its own providers under. The host binds
 *  every provider an extension registers to that extension's own package name
 *  and refuses this one, so a provider listed under it is the host's. */
const HOST_PROVIDER_PACKAGE = "@cinatra-ai/host";

/** The host's provider of a capability, never the first one listed: a
 *  provider of another package (listed before the host's or alone) is not
 *  used, so it never receives a secret and never decides the manage guard. */
function hostProvider(ctx: ExtensionHostContext, capability: string): { impl: unknown } | undefined {
  return ctx.capabilities
    .resolveProviders(capability)
    .find((p) => p.packageName === HOST_PROVIDER_PACKAGE);
}

/** Lazy per-concern host-service resolution (fail-loud on a missing service). */
function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = hostProvider(ctx, capability);
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-host-connector-services) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

/** A write that met a changed row on every attempt of the host's update. */
export class LinkedInConfigConflictError extends Error {
  readonly code = "LINKEDIN_CONFIG_CONFLICT";
  constructor() {
    super(
      "The LinkedIn settings changed while they were being saved. Nothing was changed; reload the page and try again.",
    );
    this.name = "LinkedInConfigConflictError";
  }
}

/** A stored row that is not a plain object. */
export class LinkedInConfigRowError extends Error {
  readonly code = "LINKEDIN_CONFIG_ROW_INVALID";
  constructor() {
    super(
      "The stored LinkedIn settings are not a plain object, so they cannot be read or changed. Nothing was changed.",
    );
    this.name = "LinkedInConfigRowError";
  }
}

/** A save whose merged row would lack the Client ID or the Client secret. The
 *  text is fixed and carries no stored or typed value. */
export class LinkedInConfigIncompleteError extends Error {
  readonly code = "LINKEDIN_CONFIG_INCOMPLETE";
  constructor() {
    super("Save both the Client ID and the Client secret. Nothing was changed.");
    this.name = "LinkedInConfigIncompleteError";
  }
}

/** A save that changes the Switch without the hydration proof: the form was
 *  drawn without the stored settings, or the save changes the Client ID. The
 *  text is fixed. */
export class LinkedInConfigNotReadError extends Error {
  readonly code = "LINKEDIN_CONFIG_NOT_READ";
  constructor() {
    super(
      "This page could not confirm the stored Client ID, so it cannot change the Community Management setting. Nothing was changed. Reload the page; to change the Client ID, save it first, then change the setting.",
    );
    this.name = "LinkedInConfigNotReadError";
  }
}

/** A host whose connector-config service has no callable atomic `update`. */
export class LinkedInConfigCasUnavailableError extends Error {
  readonly code = "LINKEDIN_CONFIG_CAS_UNAVAILABLE";
  constructor() {
    super(
      "This host cannot save the LinkedIn settings safely (it lacks an atomic update). Nothing was changed.",
    );
    this.name = "LinkedInConfigCasUnavailableError";
  }
}

/** Any other failure of a write: the store or the host failed. The text is
 *  fixed and carries no stored value; the underlying error is not kept. */
export class LinkedInConfigSaveError extends Error {
  readonly code = "LINKEDIN_CONFIG_SAVE_FAILED";
  constructor() {
    super(
      "The LinkedIn settings could not be saved, and whether they changed is not known. Reload the page to see the stored settings.",
    );
    this.name = "LinkedInConfigSaveError";
  }
}

/** The own string `code` of a thrown value, else undefined. Read inside try,
 *  so a throwing getter reads as no code. */
function errorCode(e: unknown): string | undefined {
  try {
    if (e === null || typeof e !== "object" || !Object.prototype.hasOwnProperty.call(e, "code")) return undefined;
    const code: unknown = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

/** A plain object: not null, not an array, and its prototype is null or an
 *  object whose own prototype is null (Object.prototype of any realm). A class
 *  instance such as a Map or a Date is not a plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** The plain-object rule: missing or null is an empty row, a plain object is
 *  the row, anything else is refused. */
function plainRow(value: unknown): LinkedInConnectorConfig {
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) throw new LinkedInConfigRowError();
  return value;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function register(ctx: ExtensionHostContext): void {
  const store = (): ConnectorConfigStore =>
    hostService<ConnectorConfigStore>(ctx, "@cinatra-ai/host:connector-config");

  const readRow = (): LinkedInConnectorConfig =>
    plainRow(store().read<unknown>(LINKEDIN_CONFIG_KEY, null));

  // Atomic update only (see the header): the host runs `change` on the stored
  // row and stores the result only if the row did not change meanwhile.
  const writeRow = (change: (current: LinkedInConnectorConfig) => LinkedInConnectorConfig): void => {
    const s = store();
    if (typeof s.update !== "function") throw new LinkedInConfigCasUnavailableError();
    // The host ends the call at the updater's first throw, so these flags, not
    // the host's error code, tell this connector's own refusals apart.
    let rowRefused = false;
    let refusal: LinkedInConfigIncompleteError | LinkedInConfigNotReadError | undefined;
    try {
      s.update(LINKEDIN_CONFIG_KEY, (raw) => {
        let current: LinkedInConnectorConfig;
        try {
          current = plainRow(raw);
        } catch {
          rowRefused = true;
          throw new LinkedInConfigRowError();
        }
        try {
          return change(current);
        } catch (e) {
          if (e instanceof LinkedInConfigIncompleteError || e instanceof LinkedInConfigNotReadError) refusal = e;
          throw e;
        }
      });
    } catch (e) {
      const code = errorCode(e);
      if (code === "CONNECTOR_CONFIG_CONFLICT") throw new LinkedInConfigConflictError();
      if (code === "CONNECTOR_CONFIG_ROW_UNPARSEABLE" || rowRefused) throw new LinkedInConfigRowError();
      if (refusal) throw refusal;
      throw new LinkedInConfigSaveError();
    }
  };

  // Resolve the host's action-guard service LAZILY at action-call time, so
  // activation order never matters and a missing guard FAILS CLOSED.
  const requireManage = async (): Promise<void> => {
    const provider = hostProvider(ctx, "@cinatra-ai/host:extension-action-guard");
    const guard = provider?.impl as HostActionGuard | undefined;
    if (!guard || typeof guard.require !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: host action-guard service is not registered — refusing the ungated action.`,
      );
    }
    await guard.require(PACKAGE_NAME, "manage");
  };

  // READ (manage-gated): the stored NON-SECRET setup values for the form's
  // hydration (root `hydrateAction`). Side-effect free; NEVER returns the
  // client secret (the host sanitizer also drops secret keys).
  ctx.ui.registerAction({
    id: "currentConfig",
    handler: async (): Promise<Record<string, unknown>> => {
      await requireManage();
      const stored = readRow();
      const out: Record<string, unknown> = {
        organizationPosting: stored.organizationPosting === true,
      };
      if (nonEmpty(stored.clientId)) out.clientId = stored.clientId;
      // The exact redirect_uri Nango sends to LinkedIn, read null-safe from
      // the host (a host without the getter yields no value), else the stored
      // value.
      const redirectUri =
        (await ctx.nango?.getNangoOAuthCallbackUrl?.()) ?? stored.redirectUri;
      if (nonEmpty(redirectUri)) out.redirectUri = redirectUri;
      return out;
    },
  });

  // PROBE: both credentials saved? THROWS when not, so the status card reads
  // "disconnected"; read-only and returns no stored values.
  ctx.ui.registerAction({
    id: "connectionStatus",
    handler: async (): Promise<{ detail: string }> => {
      const stored = readRow();
      const idSet = nonEmpty(stored.clientId);
      const secretSet = nonEmpty(stored.clientSecret);
      if (idSet && secretSet) return { detail: "Client ID and secret saved." };
      if (idSet || secretSet) throw new Error("Save both the Client ID and the Client secret.");
      throw new Error("LinkedIn OAuth is not configured.");
    },
  });

  // WRITE (manage-gated): merge the form's fields into the stored row. A blank
  // Client ID or secret keeps the stored value; a merged row without both
  // refuses (complete credentials, see the header). The flag changes only when
  // the form sends "true" or "false" AND the save carries the hydration proof
  // (see hydrationProof), read on the row the atomic update runs on; without
  // the proof a posted flag that differs from the stored one refuses.
  ctx.ui.registerAction({
    id: "saveConnection",
    handler: async (input: unknown): Promise<{ banner: string }> => {
      await requireManage();
      const fields =
        input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const id = str(fields.clientId).trim();
      const secret = str(fields.clientSecret).trim();
      writeRow((current) => {
        const proof = hydrationProof(id, current);
        const posted = fields.organizationPosting;
        const flag = posted === "true" || posted === "false" ? posted === "true" : undefined;
        if (!proof && flag !== undefined && flag !== (current.organizationPosting === true)) {
          throw new LinkedInConfigNotReadError();
        }
        const next: LinkedInConnectorConfig = {
          ...current,
          clientId: id || current.clientId,
          clientSecret: secret || current.clientSecret,
          ...(proof && flag !== undefined ? { organizationPosting: flag } : {}),
        };
        if (!nonEmpty(next.clientId) || !nonEmpty(next.clientSecret)) {
          throw new LinkedInConfigIncompleteError();
        }
        return next;
      });
      return { banner: "saved" };
    },
  });

  // WRITE (manage-gated): remove the app credentials and the flag; keep the
  // connected accounts, the logging flag and the redirect URI.
  ctx.ui.registerAction({
    id: "clearConnection",
    handler: async (): Promise<{ banner: string }> => {
      await requireManage();
      writeRow((current) => {
        const { clientId, clientSecret, organizationPosting, ...rest } = current;
        return rest;
      });
      return { banner: "cleared" };
    },
  });

  // Help tab: the vocabulary has no static-text kind, so the Help prose rides
  // `advisory` fields on this trivial, always-ready probe.
  ctx.ui.registerAction({
    id: "helpContentReady",
    handler: async (): Promise<{ ready: boolean }> => ({ ready: true }),
  });
}
