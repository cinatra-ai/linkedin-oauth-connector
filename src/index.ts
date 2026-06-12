// LinkedIn OAuth is registered as a first-class connector extension — the
// admin credentials half of the LinkedIn connector split
// (cinatra-ai/linkedin-connector#9). The operator-facing setup page is OWNED
// IN-PACKAGE (`./setup-page`) and the save action lives at `./actions`.
//
// Persistence uses the SDK's generic connector-config accessor keyed by
// "linkedin" (the SAME row the host's `@/lib/linkedin-api` reads), so this
// connector requests NO host ctx ports and carries no `@/` host-internal import.
// The host needs no per-connector wiring.

export {};
