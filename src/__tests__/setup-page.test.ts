/**
 * LinkedInOAuthConnectorSetupPage — Authorized redirect URI echo (cinatra#761).
 *
 * The setup page must surface the EXACT redirect_uri Nango sends to LinkedIn so
 * admins register the literal value (else "redirect_uri does not match"). The
 * URL is host-owned; the page reads it via the post-2.2.0 additive OPTIONAL
 * HostNangoPort getter `getNangoOAuthCallbackUrl`, null-safe, falling back to any
 * value persisted on the connector config. These tests walk the returned element
 * tree and assert the value threaded to the settings form.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  // A sentinel we can locate by identity in the returned element tree.
  Form: function LinkedInOAuthSettingsForm() {
    return null;
  },
  getExtensionConnectorConfig: vi.fn(
    <T,>(_pkg: string, _key: string, fallback: T): T => fallback,
  ),
}));

vi.mock("@cinatra-ai/sdk-extensions", () => ({
  getExtensionConnectorConfig: h.getExtensionConnectorConfig,
}));
vi.mock("@cinatra-ai/sdk-ui/marketplace", () => ({
  Main: function Main() {
    return null;
  },
  PageHeader: function PageHeader() {
    return null;
  },
  PageContent: function PageContent() {
    return null;
  },
}));
vi.mock("../settings-form", () => ({ LinkedInOAuthSettingsForm: h.Form }));

import Page from "../setup-page";

// Walk a React element tree (without rendering) to the first node of `type`.
function find(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) return el as { props: Record<string, unknown> };
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = find(k, type);
    if (hit) return hit;
  }
  return null;
}

function makeCtx(nango: Record<string, unknown>) {
  return { packageId: "p", slug: "linkedin-oauth", searchParams: {}, ctx: { nango } } as never;
}

async function redirectUriFrom(props: unknown): Promise<string | undefined> {
  const tree = await Page(props as never);
  return find(tree, h.Form)?.props.redirectUri as string | undefined;
}

const CALLBACK = "http://localhost:3003/oauth/callback";

describe("LinkedInOAuthConnectorSetupPage — redirect URI echo", () => {
  it("surfaces the canonical Nango OAuth callback URL from the host getter", async () => {
    const getNangoOAuthCallbackUrl = vi.fn(async () => CALLBACK);
    const uri = await redirectUriFrom(makeCtx({ getNangoOAuthCallbackUrl }));
    expect(getNangoOAuthCallbackUrl).toHaveBeenCalledTimes(1);
    expect(uri).toBe(CALLBACK);
  });

  it("prefers the live host callback URL over a persisted redirectUri", async () => {
    h.getExtensionConnectorConfig.mockReturnValueOnce({ redirectUri: "https://stale.example/callback" });
    const uri = await redirectUriFrom(makeCtx({ getNangoOAuthCallbackUrl: async () => CALLBACK }));
    expect(uri).toBe(CALLBACK);
  });

  it("is null-safe when the host predates the getter (no echo, no throw)", async () => {
    const uri = await redirectUriFrom(makeCtx({}));
    expect(uri).toBeUndefined();
  });

  it("falls back to a persisted redirectUri when the host getter is absent", async () => {
    h.getExtensionConnectorConfig.mockReturnValueOnce({ redirectUri: "https://saved.example/callback" });
    const uri = await redirectUriFrom(makeCtx({}));
    expect(uri).toBe("https://saved.example/callback");
  });
});
