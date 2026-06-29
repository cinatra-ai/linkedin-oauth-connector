"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { StatusPill, type StatusPillStatus } from "@cinatra-ai/sdk-ui";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { TextLink } from "./components/ui/text-link";

// Where admins create the LinkedIn app that issues the Client ID / secret.
const LINKEDIN_DEVELOPER_PORTAL_URL = "https://www.linkedin.com/developers/apps";

type LinkedInOAuthSettingsPanelProps = {
  settings: {
    clientId?: string;
    // Write-only: the secret value never reaches the client; we only know
    // whether one is already stored (to render a "saved" affordance).
    clientSecretSet?: boolean;
  };
  status: {
    status: "connected" | "incomplete" | "not_connected";
    detail?: string;
  };
  redirectUri?: string;
  action: (formData: FormData) => void | Promise<void>;
};

// Map the connector's credential status to the canonical StatusPill vocabulary
// (status flows through StatusPill, never a hand-rolled badge).
const STATUS_PILL: Record<
  LinkedInOAuthSettingsPanelProps["status"]["status"],
  { pill: StatusPillStatus; label: string }
> = {
  connected: { pill: "approved", label: "Configured" },
  incomplete: { pill: "needs-review", label: "Setup required" },
  not_connected: { pill: "idle", label: "Not configured" },
};

export function LinkedInOAuthSettingsPanel({
  settings,
  status,
  redirectUri,
  action,
}: LinkedInOAuthSettingsPanelProps) {
  const [copied, setCopied] = useState(false);
  const pill = STATUS_PILL[status.status];

  async function handleCopyRedirectUri() {
    if (!redirectUri) {
      return;
    }
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="border-line bg-surface backdrop-blur-none rounded-card">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">LinkedIn OAuth configuration</h2>
            <p className="mt-3 max-w-[64ch] text-sm leading-[1.55] text-pretty text-muted-foreground">
              Configure the LinkedIn app the workspace uses to connect member and organization accounts.
              Create a{" "}
              <TextLink href={LINKEDIN_DEVELOPER_PORTAL_URL}>LinkedIn developer app</TextLink>{" "}
              (LinkedIn Developer Portal &rarr; Create app), then save its Client ID and Client secret here.
              Once saved, users can connect their LinkedIn account from the LinkedIn connector.
            </p>
          </div>
          <StatusPill status={pill.pill}>{pill.label}</StatusPill>
        </div>

        {status.detail ? (
          <div className="mt-5 rounded-control border border-line bg-surface-strong px-4 py-3 text-sm text-foreground">
            {status.detail}
          </div>
        ) : null}

        <form action={action} className="mt-6 grid gap-4 sm:grid-cols-2">
          <Label className="grid gap-2">
            Client ID
            <Input name="clientId" defaultValue={settings.clientId ?? ""} />
          </Label>
          <Label className="grid gap-2">
            Client secret
            <Input
              name="clientSecret"
              type="password"
              defaultValue=""
              placeholder={
                settings.clientSecretSet
                  ? "•••••••• saved — leave blank to keep"
                  : "Enter LinkedIn client secret"
              }
              autoComplete="off"
            />
          </Label>
          {redirectUri ? (
            <div className="grid gap-3 text-sm font-medium sm:col-span-2">
              <div>Authorized redirect URI</div>
              <Label className="grid gap-2">
                OAuth redirect URI
                <Input value={redirectUri} readOnly className="bg-surface-muted text-foreground" />
              </Label>
              <div className="flex items-center gap-3">
                <span className="text-xs font-normal text-muted-foreground">
                  Register this exact URI in the LinkedIn developer app. It is derived automatically from
                  the configured Nango server.
                </span>
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyRedirectUri}
                  aria-label="Copy authorized redirect URI"
                  title={copied ? "Copied" : "Copy redirect URI"}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
              <span className="text-xs font-normal text-muted-foreground">
                {copied ? "Redirect URI copied to clipboard." : "Copy the value to paste it into the LinkedIn developer app."}
              </span>
            </div>
          ) : null}
          <div className="sm:col-span-2 flex flex-wrap gap-3">
            <Button name="intent" value="save">Save LinkedIn OAuth</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
