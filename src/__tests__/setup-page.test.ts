/**
 * LinkedInOAuthConnectorSetupPage — Authorized redirect URI echo (cinatra#761)
 * + the tabbed layout (cinatra-ai/linkedin-oauth-connector#34).
 *
 * The setup page must surface the EXACT redirect_uri Nango sends to LinkedIn so
 * admins register the literal value (else "redirect_uri does not match"). The
 * URL is host-owned; the page reads it via the post-2.2.0 additive OPTIONAL
 * HostNangoPort getter `getNangoOAuthCallbackUrl`, null-safe, falling back to any
 * value persisted on the connector config. These tests walk the returned element
 * tree (no DOM render) to assert both the value threaded to the settings form
 * AND the tab structure: exactly two tabs, Setup then Help — Help always LAST —
 * with the settings form living under Setup and read-only prose (no form / no
 * Save) under Help.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  // Sentinels we can locate by REFERENCE IDENTITY in the returned element
  // tree. JSX (`<Tabs .../>`) never CALLS these — it just records
  // `{ type: Tabs, props }` — so identity comparison against the same
  // function reference the mock module exports is what makes `find`/`findAll`
  // work without an actual React render.
  Form: function LinkedInOAuthSettingsForm() {
    return null;
  },
  Tabs: function Tabs() {
    return null;
  },
  TabsListRow: function TabsListRow() {
    return null;
  },
  TabsTrigger: function TabsTrigger() {
    return null;
  },
  TabsContent: function TabsContent() {
    return null;
  },
  getExtensionConnectorConfig: vi.fn(
    <T,>(_pkg: string, _key: string, fallback: T): T => fallback,
  ),
}));

vi.mock("@cinatra-ai/sdk-extensions", () => ({
  getExtensionConnectorConfig: h.getExtensionConnectorConfig,
}));
vi.mock("@cinatra-ai/sdk-ui/connector-setup-page", () => ({
  ConnectorSetupPage: function ConnectorSetupPage(props: { children?: unknown }) {
    return props.children;
  },
}));
vi.mock("@cinatra-ai/sdk-ui/tabs", () => ({
  Tabs: h.Tabs,
  TabsListRow: h.TabsListRow,
  TabsTrigger: h.TabsTrigger,
  TabsContent: h.TabsContent,
}));
vi.mock("../settings-form", () => ({ LinkedInOAuthSettingsForm: h.Form }));
vi.mock("../settings-panel", () => ({
  LINKEDIN_DEVELOPER_PORTAL_URL: "https://www.linkedin.com/developers/apps",
}));

import Page from "../setup-page";

// Walk a React element tree WITHOUT rendering it, collecting every node whose
// `type` is the exact same function reference as `type` (identity compare —
// see the sentinel comment above).
function findAll(node: unknown, type: unknown, out: { props: Record<string, unknown> }[] = []) {
  if (!node || typeof node !== "object") return out;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) out.push(el as { props: Record<string, unknown> });
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    findAll(k, type, out);
  }
  return out;
}

function find(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  return findAll(node, type)[0] ?? null;
}

function makeCtx(nango: Record<string, unknown>) {
  return { packageId: "p", slug: "linkedin-oauth", searchParams: {}, ctx: { nango } } as never;
}

const CALLBACK = "http://localhost:3003/oauth/callback";

describe("LinkedInOAuthConnectorSetupPage — redirect URI echo", () => {
  async function redirectUriFrom(props: unknown): Promise<string | undefined> {
    const tree = await Page(props as never);
    return find(tree, h.Form)?.props.redirectUri as string | undefined;
  }

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

describe("LinkedInOAuthConnectorSetupPage — tabbed layout (#34)", () => {
  it("declares exactly two tabs, in order: Setup then Help — by VALUE and by visible label", async () => {
    const tree = await Page(makeCtx({}) as never);
    const triggers = findAll(tree, h.TabsTrigger);
    expect(triggers.map((t) => t.props.value)).toEqual(["setup", "help"]);
    // Also pin the visible LABEL (not just the internal `value`) so a future
    // edit can't silently swap what the tab reads while leaving `value`
    // unchanged (a real a11y/UX regression the `value`-only check would miss).
    expect(triggers.map((t) => t.props.children)).toEqual(["Setup", "Help"]);
  });

  it("Help is always LAST", async () => {
    const tree = await Page(makeCtx({}) as never);
    const triggers = findAll(tree, h.TabsTrigger);
    expect(triggers.at(-1)?.props.value).toBe("help");
    expect(triggers.at(-1)?.props.children).toBe("Help");
  });

  it("the tablist row carries an accessible label (a11y tab semantics)", async () => {
    const tree = await Page(makeCtx({}) as never);
    const listRow = find(tree, h.TabsListRow);
    expect(listRow?.props["aria-label"]).toBe("LinkedIn OAuth connector setup");
  });

  it("Setup defaults to the active tab", async () => {
    const tree = await Page(makeCtx({}) as never);
    const tabs = find(tree, h.Tabs);
    expect(tabs?.props.defaultValue).toBe("setup");
  });

  it("both tab panels stay mounted while inactive (forceMount) so switching tabs never discards the Setup form's uncontrolled Client ID / secret inputs", async () => {
    // Radix's DEFAULT is to unmount an inactive TabsContent. Setup's fields are
    // uncontrolled (settings-panel.tsx <Input defaultValue=.../>), so an
    // unmount-on-switch would silently drop in-progress edits the instant an
    // admin checks Help. `forceMount` + the `data-[state=inactive]:hidden`
    // className is the required pairing (CSS hides it instead of unmounting).
    const tree = await Page(makeCtx({}) as never);
    const contents = findAll(tree, h.TabsContent);
    expect(contents).toHaveLength(2);
    for (const content of contents) {
      expect(content.props.forceMount).toBe(true);
      expect(String(content.props.className)).toContain("data-[state=inactive]:hidden");
    }
  });

  it("the Setup tab's content is the settings form (content mapping)", async () => {
    const tree = await Page(makeCtx({}) as never);
    const contents = findAll(tree, h.TabsContent);
    const setupContent = contents.find((c) => c.props.value === "setup");
    expect(setupContent).toBeDefined();
    expect(find(setupContent, h.Form)).not.toBeNull();
  });

  it("the Help tab is read-only — no settings form, no raw <form>/<button> (no Save action of any kind)", async () => {
    const tree = await Page(makeCtx({}) as never);
    const contents = findAll(tree, h.TabsContent);
    const helpContent = contents.find((c) => c.props.value === "help");
    expect(helpContent).toBeDefined();
    // The settings form (which owns the only Save action on this page) must
    // NOT appear under Help — Help is prose-only. Guard against BOTH the
    // component being reused (h.Form) AND a hand-rolled action sneaking in as
    // a raw DOM `<form>` or `<button>` (a component-identity-only check would
    // miss the latter).
    expect(find(helpContent, h.Form)).toBeNull();
    expect(findAll(helpContent, "form")).toHaveLength(0);
    expect(findAll(helpContent, "button")).toHaveLength(0);
  });
});
