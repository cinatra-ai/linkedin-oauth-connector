# LinkedIn OAuth

Configure the LinkedIn app your workspace uses to connect member and organization accounts. Create one LinkedIn developer app, save its Client ID and Client secret here, and every user can then connect their own LinkedIn account through the LinkedIn connector. This connector is the credentials half of the LinkedIn integration: it stores the workspace-wide app credentials, while the LinkedIn connector handles individual user authentication.

**Setup.** In the LinkedIn Developer Portal, create a developer application. On the LinkedIn OAuth setup page in Cinatra, enter the Client ID and Client secret and select Connect. Register the Authorized redirect URI shown on the page, with its copy button, in your LinkedIn developer app. The Client secret is write-only: it is never sent to the browser, and a blank field keeps the saved secret. Turn on the Community Management API switch only for an app whose one product is that API, then reconnect each LinkedIn account.

**Credential storage.** Saving merges into a shared connector-config row. Connected user accounts, the logging setting and the redirect URI are kept. Disconnect removes only the app credentials and the switch.

**Required permissions.** Reading, saving and clearing the credentials need the `manage` permission (org owners, org admins and platform admins).

**Troubleshooting.** If users cannot connect, check the Connection status card. It reads Connected only when both the Client ID and the Client secret are saved. Confirm that the redirect URI in your LinkedIn app matches the one on the setup page exactly.

## Works with

- LinkedIn

## Capabilities

- Save the LinkedIn app's Client ID and Client secret in one place
- Power the per-user LinkedIn account connect flow without configuring credentials per user
- Show the connection status and connect or disconnect the app credentials
- Display the Authorized redirect URI with a one-click copy button for LinkedIn app registration
