// Dispatch-route entry for the LinkedIn OAuth connector setup page.
//
// The admin credentials half of the LinkedIn connector split
// (cinatra-ai/linkedin-connector#9). Owns the Client ID / secret form
// IN-PACKAGE. Persistence + reads go through the SDK's GENERIC connector-config
// accessor keyed by "linkedin" — the SAME row the host's `@/lib/linkedin-api`
// reads — so no host runtime package or DI slot is needed (unlike
// google-oauth-connector, whose credentials also power better-auth sign-in).
//
// The OAuth client SECRET is write-only: never sent to the client. The form
// renders the secret field empty + a "saved" indicator; saving a blank secret
// KEEPS the stored value (saveLinkedInOAuthConnectionAction merges).

import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { getExtensionConnectorConfig } from "@cinatra-ai/sdk-extensions";
import { LinkedInOAuthSettingsForm } from "./settings-form";

const PACKAGE_NAME = "@cinatra-ai/linkedin-oauth-connector";
const LINKEDIN_CONFIG_KEY = "linkedin";

type ConnectorSetupPageProps = {
  packageId: string;
  slug: string;
  searchParams: Record<string, string | string[] | undefined>;
  ctx: ExtensionHostContext;
};

type LinkedInConnectorConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

export default async function LinkedInOAuthConnectorSetupPage({ ctx }: ConnectorSetupPageProps) {
  const settings = getExtensionConnectorConfig<LinkedInConnectorConfig>(
    PACKAGE_NAME,
    LINKEDIN_CONFIG_KEY,
    {},
  );

  // Surface the EXACT redirect_uri Nango sends to LinkedIn so admins register
  // that literal value in their LinkedIn app — otherwise they hit "The
  // redirect_uri does not match the registered value" (cinatra#761). The OAuth
  // flow is fully Nango-owned, so the connector never builds the URL itself; it
  // reads the canonical value from the host via the post-2.2.0 additive OPTIONAL
  // getter `getNangoOAuthCallbackUrl`. Read it null-safe (a host predating the
  // getter, or without a Nango port, simply yields no echo) and fall back to any
  // value already persisted on the connector config.
  const redirectUri =
    (await ctx.nango?.getNangoOAuthCallbackUrl?.()) ?? settings.redirectUri;

  const clientIdSet = Boolean(settings.clientId && settings.clientId.trim());
  const clientSecretSet = Boolean(settings.clientSecret && settings.clientSecret.trim());

  const administration = {
    clientId: settings.clientId,
    clientSecretSet,
  };

  // Credentials are "configured" only when BOTH the client id and secret are
  // present (a half-saved app cannot complete OAuth).
  const status: { status: "connected" | "incomplete" | "not_connected"; detail?: string } =
    clientIdSet && clientSecretSet
      ? {
          status: "connected",
          detail: "LinkedIn app credentials are saved. Users can connect their LinkedIn account from the LinkedIn connector.",
        }
      : clientIdSet || clientSecretSet
        ? {
            status: "incomplete",
            detail: "Add both the Client ID and Client secret to finish configuring the LinkedIn app.",
          }
        : { status: "not_connected" };

  return (
    <Main className="min-h-screen">
      <PageHeader title="LinkedIn OAuth" description="API setup" className="max-w-3xl" />
      <PageContent className="max-w-3xl flex flex-col gap-6 pb-8">
        <LinkedInOAuthSettingsForm
          administration={administration}
          status={status}
          redirectUri={redirectUri}
        />
      </PageContent>
    </Main>
  );
}
