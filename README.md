# LinkedIn OAuth

Configure the LinkedIn app your workspace uses to connect member and organization accounts. Create one LinkedIn developer app, save its Client ID and Client secret here, and every user can then connect their own LinkedIn account through the LinkedIn connector. This connector is the credentials half of the LinkedIn integration: it owns the OAuth app setup form and stores the workspace-wide credentials, while the LinkedIn connector handles individual user authentication.

**Setup.** In the LinkedIn Developer Portal, create a developer application. Copy the Client ID and Client secret, then paste them into the LinkedIn OAuth setup page inside Cinatra. If the redirect URI is already stored in the connector configuration, the setup page displays it with a copy button — register that exact URI in your LinkedIn developer app. Credentials are write-only once saved; the Client secret is never sent to the browser.

**Credential storage.** The connector saves credentials under a shared connector-config key. Saving new credentials preserves connected user accounts, the redirect URI, and other fields already written by the LinkedIn connector — partial saves never wipe connected accounts.

**Required permissions.** The save action is gated by the `manage` permission (org owners, org admins, and platform admins). The setup page itself is accessible to any user with access to the extension dispatch route.

**Troubleshooting.** If users cannot connect their LinkedIn account, confirm that both the Client ID and Client secret show as configured (the status badge reads "Configured"). If only one field is saved, the OAuth flow cannot complete — save both values. If the Authorized Redirect URI does not appear on the setup page, confirm that the redirect URI has been stored in the connector configuration. Verify that the URI in your LinkedIn developer app matches the URI on the setup page exactly.

## Works with

- LinkedIn

## Capabilities

- Save the LinkedIn app's Client ID and Client secret in one place
- Power the per-user LinkedIn account connect flow without configuring credentials per user
- Rotate the workspace's LinkedIn OAuth credentials from a single setup page
- Display the Authorized Redirect URI with a one-click copy button for LinkedIn app registration
