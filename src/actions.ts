"use server";

// LinkedIn OAuth (app credentials) server action — the admin half of the
// LinkedIn connector split (cinatra-ai/linkedin-connector#9). Relocated here
// from `@cinatra-ai/linkedin-connector` so the per-user connect package no
// longer owns the Client ID / secret form.
//
// Gated by the SDK's `requireExtensionAction(pkg, "manage")` as the FIRST
// executable statement (org_owner/org_admin/platform_admin, fail-closed).
//
// It then REFUSES every save and writes nothing. The shared row "linkedin" also
// holds what the LinkedIn connector writes (accounts, logging flag, redirect
// URI); a whole-row write loses a change stored in between, so the row changes
// only through the host's atomic `update` (the `./register` actions). A server
// action cannot reach it: it has no render-time `ctx`, and the SDK accessor
// has only get/set/delete (src/__tests__/actions.test.ts).

import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";

const PACKAGE_NAME = "@cinatra-ai/linkedin-oauth-connector";

/** The refusal of the bundled form's save. Fixed text; it carries no input. */
class LinkedInBundledSaveRefusedError extends Error {
  readonly code = "LINKEDIN_CONFIG_BUNDLED_SAVE_REFUSED";
  constructor() {
    super(
      "This setup page cannot save the LinkedIn settings safely, so nothing was changed. The settings are saved through the connector's registered save action.",
    );
    this.name = "LinkedInBundledSaveRefusedError";
  }
}

export async function saveLinkedInOAuthConnectionAction(_formData: FormData): Promise<void> {
  await requireExtensionAction(PACKAGE_NAME, "manage");
  throw new LinkedInBundledSaveRefusedError();
}
