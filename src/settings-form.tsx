"use client";

import { useRouter } from "next/navigation";
import { useNotify } from "@cinatra-ai/sdk-ui";
import { saveLinkedInOAuthConnectionAction } from "./actions";
import { LinkedInOAuthSettingsPanel } from "./settings-panel";

type LinkedInOAuthSettingsFormProps = {
  administration: {
    clientId?: string;
    // Write-only: the client SECRET value is never sent to the browser. The
    // host only tells the form whether a secret is already stored, so it can
    // show a "saved" affordance. Submitting a blank secret keeps the stored value.
    clientSecretSet?: boolean;
  };
  status: {
    status: "connected" | "incomplete" | "not_connected";
    detail?: string;
  };
  redirectUri?: string;
};

export function LinkedInOAuthSettingsForm({
  administration,
  status,
  redirectUri,
}: LinkedInOAuthSettingsFormProps) {
  const router = useRouter();
  const { addNotification } = useNotify();

  async function handleSubmit(formData: FormData) {
    try {
      await saveLinkedInOAuthConnectionAction(formData);
      addNotification({
        title: "LinkedIn OAuth connection saved",
        body: "LinkedIn OAuth settings have been updated.",
        kind: "success",
      });
      // Re-render the setup page's server component so it re-reads the
      // just-saved credentials. The save action persists via the merge-preserve
      // setExtensionConnectorConfig but cannot revalidate a path itself: this
      // connector is mounted by the host at a dynamic dispatch route it does not
      // know (and must not couple to). router.refresh() re-fetches the current
      // route's RSC payload, so the panel renders the stored Client ID and the
      // "saved" secret affordance instead of the stale, empty pre-save fields.
      router.refresh();
    } catch {
      // In a Next.js production build, a thrown Server Action error reaches this
      // catch with its real message replaced by the framework's generic masking
      // blurb, so the caught message is never useful UI copy. Show friendly
      // operation-specific copy unconditionally; server-side logging of the real
      // failure is unchanged.
      addNotification({
        title: "LinkedIn OAuth save failed",
        body: "Unable to save the LinkedIn OAuth connection.",
        kind: "error",
      });
    }
  }

  return (
    <LinkedInOAuthSettingsPanel
      settings={administration}
      status={status}
      redirectUri={redirectUri}
      action={handleSubmit}
    />
  );
}
