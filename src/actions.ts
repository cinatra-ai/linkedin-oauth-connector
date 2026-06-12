"use server";

// LinkedIn OAuth (app credentials) server action — the admin half of the
// LinkedIn connector split (cinatra-ai/linkedin-connector#9). Relocated here
// from `@cinatra-ai/linkedin-connector` so the per-user connect package no
// longer owns the Client ID / secret form.
//
// Gated by the SDK's `requireExtensionAction(pkg, "manage")` as the FIRST
// executable statement (org_owner/org_admin/platform_admin, fail-closed).
//
// Persistence uses the SDK's GENERIC host-binds-once connector-config accessor
// (getExtensionConnectorConfig / setExtensionConnectorConfig). The host store
// (register-extension-connector-config-store.ts) keys ONLY by `key` and IGNORES
// the packageId, so writing key "linkedin" lands in the SAME row the host's
// `@/lib/linkedin-api` reads via readConnectorConfigFromDatabase("linkedin").
// This FIXES the orphaned-credentials bug: the old per-user package wrote the
// dead key "linkedin_connection", which nobody read.

import { z } from "zod";
import {
  requireExtensionAction,
  getExtensionConnectorConfig,
  setExtensionConnectorConfig,
} from "@cinatra-ai/sdk-extensions";

const PACKAGE_NAME = "@cinatra-ai/linkedin-oauth-connector";
// The shared connector-config key the host's `@/lib/linkedin-api` reads/writes.
const LINKEDIN_CONFIG_KEY = "linkedin";

const linkedinOAuthSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

// The full shape the host's linkedin-api persists under key "linkedin". Only
// the credential fields are owned by this admin form; accounts / loggingEnabled
// / redirectUri are owned by the connect + materialization paths and MUST be
// preserved on every save (a naive overwrite would wipe connected accounts).
type LinkedInConnectorConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  loggingEnabled?: boolean;
  accounts?: unknown[];
};

export async function saveLinkedInOAuthConnectionAction(formData: FormData) {
  await requireExtensionAction(PACKAGE_NAME, "manage");
  const parsed = linkedinOAuthSchema.parse({
    clientId: formData.get("clientId") ?? undefined,
    clientSecret: formData.get("clientSecret") ?? undefined,
  });

  const current = getExtensionConnectorConfig<LinkedInConnectorConfig>(
    PACKAGE_NAME,
    LINKEDIN_CONFIG_KEY,
    {},
  );

  const trimmedClientId = parsed.clientId?.trim();
  const trimmedClientSecret = parsed.clientSecret?.trim();

  // Merge-preserve: blank inputs KEEP the stored value (the "leave blank to
  // keep the saved value" contract — the clientId is pre-filled in the form, so
  // a blank submit means "unchanged", never "clear"). The secret is write-only
  // and never round-trips to the browser, so a blank secret always means keep.
  const next: LinkedInConnectorConfig = {
    ...current,
    clientId: trimmedClientId || current.clientId,
    clientSecret: trimmedClientSecret || current.clientSecret,
  };

  setExtensionConnectorConfig(PACKAGE_NAME, LINKEDIN_CONFIG_KEY, next);
  // No redirect: the setup page is already the current route. Returning
  // normally lets the client form show a success notification and refresh the
  // server component (mirrors google-oauth-connector's save action, which also
  // does not redirect). A redirect() here would throw NEXT_REDIRECT, which the
  // client form's try/catch would mis-handle as a save failure.
}
