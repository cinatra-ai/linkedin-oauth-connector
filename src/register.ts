// The LinkedIn OAuth connector's `register(ctx)` server entry.
//
// The setup page is the host's generic schema form, drawn from
// `cinatra.configSchema` in package.json (`uiSurface: "schema-config"`). This
// entry registers the named actions that schema references by id. The host
// dispatches them through `/api/extensions/{installId}/actions/{actionId}`,
// which authorizes the actor at the "use" tier only. Reading the stored
// credentials and saving or clearing them is MANAGE-tier work, so those
// handlers re-check `manage` through the host action-guard service first and
// fail closed when the guard is missing.
//
// Persistence: the shared connector-config row keyed "linkedin". The LinkedIn
// connector reads the same row and writes the connected accounts, the logging
// flag and the redirect URI into it. The store's `write` replaces the whole
// row, so every write here spreads the current row and changes only the keys
// this form owns (clientId, clientSecret, organizationPosting).
//
// SDK imports are TYPE-ONLY (the serverEntry graph bans SDK value imports);
// host services come through the capability registry.

import type { ExtensionHostContext, HostConnectorConfigService } from "@cinatra-ai/sdk-extensions";

const PACKAGE_NAME = "@cinatra-ai/linkedin-oauth-connector";
// The shared connector-config key the LinkedIn connector reads and writes.
const LINKEDIN_CONFIG_KEY = "linkedin";

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

/** Lazy per-concern host-service resolution (fail-loud on a missing service). */
function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-host-connector-services) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function register(ctx: ExtensionHostContext): void {
  const store = (): HostConnectorConfigService =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");

  const readRow = (): LinkedInConnectorConfig => {
    const row = store().read<LinkedInConnectorConfig | null>(LINKEDIN_CONFIG_KEY, {});
    return row && typeof row === "object" ? row : {};
  };

  // Resolve the host's action-guard service LAZILY at action-call time, so
  // activation order never matters and a missing guard FAILS CLOSED.
  const requireManage = async (): Promise<void> => {
    const provider = ctx.capabilities.resolveProviders(
      "@cinatra-ai/host:extension-action-guard",
    )[0];
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
  // Client ID or secret keeps the stored value; the flag changes only when the
  // form sends "true" or "false". No await between the read and the write.
  ctx.ui.registerAction({
    id: "saveConnection",
    handler: async (input: unknown): Promise<{ banner: string }> => {
      await requireManage();
      const fields =
        input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const s = store();
      const current =
        s.read<LinkedInConnectorConfig | null>(LINKEDIN_CONFIG_KEY, {}) ?? {};
      const id = str(fields.clientId).trim();
      const secret = str(fields.clientSecret).trim();
      const flag = fields.organizationPosting;
      const next: LinkedInConnectorConfig = {
        ...current,
        clientId: id || current.clientId,
        clientSecret: secret || current.clientSecret,
        ...(flag === "true" || flag === "false"
          ? { organizationPosting: flag === "true" }
          : {}),
      };
      s.write(LINKEDIN_CONFIG_KEY, next);
      return { banner: "saved" };
    },
  });

  // WRITE (manage-gated): remove the app credentials and the flag; keep the
  // connected accounts, the logging flag and the redirect URI.
  ctx.ui.registerAction({
    id: "clearConnection",
    handler: async (): Promise<{ banner: string }> => {
      await requireManage();
      const s = store();
      const current =
        s.read<LinkedInConnectorConfig | null>(LINKEDIN_CONFIG_KEY, {}) ?? {};
      const { clientId, clientSecret, organizationPosting, ...rest } = current;
      s.write(LINKEDIN_CONFIG_KEY, rest);
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
