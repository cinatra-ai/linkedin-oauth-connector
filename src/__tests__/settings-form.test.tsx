// @vitest-environment jsdom
/**
 * LinkedInOAuthSettingsForm — the Community Management checkbox, through a
 * rendered form submission.
 *
 * The real form and panel are rendered; only the save action, the router and
 * the notifications are doubles. The Checkbox double wraps the same Radix
 * primitive as the host Checkbox (see fixtures/design-primitives.tsx).
 *
 * After a successful form action React resets the form, and router.refresh()
 * re-renders the panel with the stored settings while it keeps client state.
 * The checkbox must then show the STORED value, and a second save without a
 * change must submit that value again: a box that shows "unchecked" while
 * true is stored would write false on the next save.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  addNotification: vi.fn(),
  refresh: vi.fn(),
  save: vi.fn(async (_formData: FormData) => undefined),
}));

vi.mock("@cinatra-ai/sdk-ui", () => ({
  useNotify: () => ({ addNotification: h.addNotification }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh }),
}));
vi.mock("../actions", () => ({
  saveLinkedInOAuthConnectionAction: h.save,
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

function element(stored: boolean) {
  return (
    <LinkedInOAuthSettingsForm
      administration={{ clientId: "cm-id", clientSecretSet: true, organizationPosting: stored }}
      status={{ status: "connected" }}
    />
  );
}

// The props the server component renders after a save (what router.refresh()
// delivers): the same root, so client state is kept.
function renderStored(stored: boolean) {
  root!.render(element(stored));
}

function checkbox(): HTMLElement {
  const box = container!.querySelector<HTMLElement>("#linkedin-organization-posting");
  expect(box).not.toBeNull();
  return box!;
}

function shownChecked(): boolean {
  return checkbox().getAttribute("aria-checked") === "true";
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function clickBox() {
  await act(async () => {
    checkbox().click();
  });
}

// Submit the real form with its Save button and return the value the save
// action received for organizationPosting.
async function submit(): Promise<FormDataEntryValue | null> {
  const before = h.save.mock.calls.length;
  const form = container!.querySelector("form");
  expect(form).not.toBeNull();
  const saveButton = Array.from(form!.querySelectorAll("button")).find(
    (button) => button.textContent === "Save LinkedIn OAuth",
  );
  expect(saveButton).toBeDefined();
  await act(async () => {
    form!.requestSubmit(saveButton);
  });
  await flush();
  expect(h.save).toHaveBeenCalledTimes(before + 1);
  const formData = h.save.mock.calls[before]![0] as FormData;
  return formData.get("organizationPosting");
}

const REFRESH_TIMINGS = [
  ["after the save has settled", false],
  ["from inside router.refresh()", true],
] as const;

describe("LinkedInOAuthSettingsForm — Community Management checkbox (rendered form)", () => {
  it.each(REFRESH_TIMINGS)(
    "submits the ticked box, then shows and re-submits the stored true (refresh %s)",
    async (_timing, refreshInsideAction) => {
      await act(async () => renderStored(false));
      expect(shownChecked()).toBe(false);

      await clickBox();
      expect(shownChecked()).toBe(true);

      if (refreshInsideAction) h.refresh.mockImplementationOnce(() => renderStored(true));
      expect(await submit()).toBe("true");
      expect(h.refresh).toHaveBeenCalledTimes(1);
      if (!refreshInsideAction) await act(async () => renderStored(true));
      await flush();

      // The post-save state: the box shows the stored value...
      expect(shownChecked()).toBe(true);
      // ...and a second save without a change keeps it.
      expect(await submit()).toBe("true");
    },
  );

  it.each(REFRESH_TIMINGS)(
    "submits the unticked box without the flag, then shows and keeps the stored false (refresh %s)",
    async (_timing, refreshInsideAction) => {
      await act(async () => renderStored(true));
      expect(shownChecked()).toBe(true);

      await clickBox();
      expect(shownChecked()).toBe(false);

      if (refreshInsideAction) h.refresh.mockImplementationOnce(() => renderStored(false));
      expect(await submit()).toBeNull();
      expect(h.refresh).toHaveBeenCalledTimes(1);
      if (!refreshInsideAction) await act(async () => renderStored(false));
      await flush();

      expect(shownChecked()).toBe(false);
      expect(await submit()).toBeNull();
    },
  );

  it("submits the stored true unchanged when the box is not touched", async () => {
    await act(async () => renderStored(true));
    expect(shownChecked()).toBe(true);
    expect(await submit()).toBe("true");
    await act(async () => renderStored(true));
    await flush();
    expect(shownChecked()).toBe(true);
    expect(await submit()).toBe("true");
  });
});
