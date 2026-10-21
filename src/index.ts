// LinkedIn OAuth is registered as a first-class connector extension — the
// admin credentials half of the LinkedIn connector split
// (cinatra-ai/linkedin-connector#9). Its setup page is the host's generic
// schema form, drawn from `cinatra.configSchema` in package.json; the named
// actions that form calls are registered by the server entry `./register`
// (src/register.ts).
//
// Persistence uses the host connector-config service keyed by "linkedin" (the
// SAME row the LinkedIn connector reads), resolved through the capability
// registry, so this package carries no SDK value import and no `@/`
// host-internal import.

export {};
