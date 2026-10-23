// LinkedIn OAuth is registered as a first-class connector extension — the
// admin credentials half of the LinkedIn connector split
// (cinatra-ai/linkedin-connector#9). Its setup page is the host's generic
// schema form, drawn from `cinatra.configSchema` in package.json; the named
// actions that form calls are registered by the server entry `./register`
// (src/register.ts).
//
// Persistence: the shared connector-config row keyed "linkedin" (the SAME row
// the LinkedIn connector reads). Every change goes through the registered
// actions, which write only through the host connector-config service's atomic
// `update`. The manifest requests the `nango`, `capabilities` and `ui` host
// ports (package.json `cinatra.requestedHostPorts`). No `@/` host-internal
// import.

export {};
