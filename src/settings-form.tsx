"use client";

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
  const { addNotification } = useNotify();

  async function handleSubmit(formData: FormData) {
    try {
      await saveLinkedInOAuthConnectionAction(formData);
      addNotification({
        title: "LinkedIn OAuth connection saved",
        body: "LinkedIn OAuth settings have been updated.",
        kind: "success",
      });
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
