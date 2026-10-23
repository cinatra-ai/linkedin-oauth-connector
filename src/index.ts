// LinkedIn OAuth is registered as a first-class connector extension — the
// admin credentials half of the LinkedIn connector split
// (cinatra-ai/linkedin-connector#9). The operator-facing setup page is OWNED
// IN-PACKAGE (`./setup-page`) and the save action lives at `./actions`.
//
// Persistence: the shared connector-config row keyed "linkedin" (the SAME row
// the host's `@/lib/linkedin-api` reads). The setup page reads it through the
// SDK's generic connector-config accessor. Every change goes through the
// `cinatra.serverEntry` `./register` (src/register.ts), whose named actions
// write only through the host connector-config service's atomic `update`; the
// bundled page's server action refuses instead of writing (src/actions.ts).
// The manifest requests the `nango`, `capabilities` and `ui` host ports
// (package.json `cinatra.requestedHostPorts`). No `@/` host-internal import.

export {};
