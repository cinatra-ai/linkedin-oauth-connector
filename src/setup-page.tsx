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
//
// Tabbed layout (cinatra-ai/linkedin-oauth-connector#34, connector-setup-tabs
// rollout — cinatra-ai/cinatra#1105, epic cinatra-ai/cinatra#1101): this is a
// single-connection connector (one app-level Client ID / secret per install,
// no per-user multi-instance shape), so per the extended
// design/specs/app-connectors.html §II design it carries exactly two tabs —
// "Setup" (the existing form, unchanged) and the reserved "Help" tab, which is
// ALWAYS LAST. Composes the shared `@cinatra-ai/sdk-ui/connector-setup-page`
// shell + the shared `@cinatra-ai/sdk-ui/tabs` Tabs primitive (Radix-backed:
// roving-focus keyboard nav, `aria-selected`, correct tab order come from the
// primitive) — no `tabs.tsx` is vendored into this extension.

import { ConnectorSetupPage } from "@cinatra-ai/sdk-ui/connector-setup-page";
import { Tabs, TabsContent, TabsListRow, TabsTrigger } from "@cinatra-ai/sdk-ui/tabs";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { getExtensionConnectorConfig } from "@cinatra-ai/sdk-extensions";
import { LinkedInOAuthSettingsForm } from "./settings-form";
import { LINKEDIN_DEVELOPER_PORTAL_URL } from "./settings-panel";
import { TextLink } from "./components/ui/text-link";

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
    // `divider={false}` — the tab row's own etched section rule replaces the
    // header's, so the two rules never stack (design/specs/app-connectors.html
    // §II + the shared Tabs primitive contract).
    <ConnectorSetupPage
      title="LinkedIn OAuth"
      description="API setup"
      divider={false}
      className="flex flex-col gap-6 pb-8"
    >
      <Tabs defaultValue="setup" className="w-full">
        <TabsListRow aria-label="LinkedIn OAuth connector setup">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          {/* Help is the reserved tab and is ALWAYS LAST — after Setup and every
              other custom tab (design/specs/app-connectors.html §II). This
              connector has no additional config tab, so Help is the second and
              final tab. */}
          <TabsTrigger value="help">Help</TabsTrigger>
        </TabsListRow>

        {/* `forceMount` + `data-[state=inactive]:hidden` (not Radix's default
            unmount-on-inactive) — Setup holds UNCONTROLLED inputs
            (settings-panel.tsx's Client ID / secret <Input defaultValue=.../>).
            Unmounting on tab switch would drop in-progress edits the instant an
            admin checks the Help tab. Same mount-stability pattern the merged
            google-calendar-connector tabs precedent uses (setup-page.tsx). */}
        <TabsContent value="setup" forceMount className="mt-6 data-[state=inactive]:hidden">
          <LinkedInOAuthSettingsForm
            administration={administration}
            status={status}
            redirectUri={redirectUri}
          />
        </TabsContent>

        {/* HELP — reserved, always LAST, read-only (no form, no Save). Narrow
            (max-w-xl · 576px) per the additional-config-tab treatment. */}
        <TabsContent
          value="help"
          forceMount
          className="mt-6 flex max-w-xl flex-col gap-5 data-[state=inactive]:hidden"
        >
          <p className="text-sm leading-6 text-muted-foreground">
            This tab configures the shared LinkedIn app credentials the workspace
            uses to connect member and organization accounts — it is admin-level
            setup, not a personal connection. Once the credentials on the{" "}
            <strong>Setup</strong> tab are saved, users connect their own
            LinkedIn account from the{" "}
            <TextLink href="/connectors/cinatra-ai/linkedin-connector/setup" external={false}>
              LinkedIn connector
            </TextLink>
            .
          </p>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              Create a LinkedIn developer app
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Create a{" "}
              <TextLink href={LINKEDIN_DEVELOPER_PORTAL_URL}>LinkedIn developer app</TextLink>{" "}
              (LinkedIn Developer Portal &rarr; Create app).
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              Save the Client ID and secret
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Copy the app&apos;s Client ID and Client secret onto the{" "}
              <strong>Setup</strong> tab and save. The secret is write-only —
              once saved it never round-trips back to the browser, so leave it
              blank on a later save to keep the stored value.
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              Register the redirect URI
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Register the exact Authorized redirect URI shown on the{" "}
              <strong>Setup</strong> tab in the LinkedIn app&apos;s OAuth
              settings. It must match exactly, or LinkedIn rejects the
              connection with a redirect_uri mismatch.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </ConnectorSetupPage>
  );
}
