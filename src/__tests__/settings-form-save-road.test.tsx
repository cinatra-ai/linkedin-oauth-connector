// @vitest-environment jsdom
/**
 * The bundled setup form's save path never writes the shared "linkedin" row
 * blind.
 *
 * The real form, panel and server action are rendered and run; only the SDK
 * accessors, the router and the notifications are doubles. A submit of the
 * form must never call setExtensionConnectorConfig (a whole-row write that
 * loses a change another writer stored in between): the row changes only
 * through the host's atomic `update` (src/register.ts), which this path cannot
 * reach, so the save refuses and the form shows its failure notification.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  addNotification: vi.fn(),
  refresh: vi.fn(),
  requireExtensionAction: vi.fn(async () => undefined),
  getExtensionConnectorConfig: vi.fn(<T,>(_pkg: string, _key: string, fallback: T): T => fallback),
  setExtensionConnectorConfig: vi.fn(),
  deleteExtensionConnectorConfig: vi.fn(),
}));

vi.mock("@cinatra-ai/sdk-ui", () => ({
  useNotify: () => ({ addNotification: h.addNotification }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh }),
}));
vi.mock("@cinatra-ai/sdk-extensions", () => ({
  requireExtensionAction: h.requireExtensionAction,
  getExtensionConnectorConfig: h.getExtensionConnectorConfig,
  setExtensionConnectorConfig: h.setExtensionConnectorConfig,
  deleteExtensionConnectorConfig: h.deleteExtensionConnectorConfig,
}));

import { LinkedInOAuthSettingsForm } from "../settings-form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; the Radix checkbox measures its control with one.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container = null;
  document.body.innerHTML = "";
});

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function input(name: string): HTMLInputElement {
  const el = container!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  expect(el).not.toBeNull();
  return el!;
}

async function submitWith(values: { clientId: string; clientSecret: string; tick: boolean }) {
  input("clientId").value = values.clientId;
  input("clientSecret").value = values.clientSecret;
  if (values.tick) {
    const box = container!.querySelector<HTMLElement>("#linkedin-organization-posting");
    expect(box).not.toBeNull();
    await act(async () => {
      box!.click();
    });
  }
  const formEl = container!.querySelector("form");
  expect(formEl).not.toBeNull();
  const saveButton = Array.from(formEl!.querySelectorAll("button")).find(
    (button) => button.textContent === "Save LinkedIn OAuth",
  );
  expect(saveButton).toBeDefined();
  await act(async () => {
    formEl!.requestSubmit(saveButton);
  });
  await flush();
}

const SUBMITS = [
  ["new credentials", { clientId: "new-id", clientSecret: "new-secret", tick: false }],
  ["new credentials with the Community Management box ticked", { clientId: "new-id", clientSecret: "new-secret", tick: true }],
  ["blank fields", { clientId: "", clientSecret: "", tick: false }],
] as const;

describe("LinkedInOAuthSettingsForm — the save path (rendered form, real server action)", () => {
  for (const [label, values] of SUBMITS) {
    it(`a submit of ${label} never calls setExtensionConnectorConfig and shows the failure notification`, async () => {
      await act(async () => {
        root!.render(
          <LinkedInOAuthSettingsForm
            administration={{ clientId: "stored-id", clientSecretSet: true, organizationPosting: false }}
            status={{ status: "connected" }}
          />,
        );
      });
      await submitWith(values);
      expect(h.requireExtensionAction).toHaveBeenCalledTimes(1);
      expect(h.setExtensionConnectorConfig).not.toHaveBeenCalled();
      expect(h.getExtensionConnectorConfig).not.toHaveBeenCalled();
      expect(h.deleteExtensionConnectorConfig).not.toHaveBeenCalled();
      expect(h.refresh).not.toHaveBeenCalled();
      expect(h.addNotification).toHaveBeenCalledTimes(1);
      expect(h.addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "error", title: "LinkedIn OAuth save failed" }),
      );
    });
  }
});
