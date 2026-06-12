import { defineConfig } from "vitest/config";
import * as path from "node:path";

// This repo is a source mirror: the cinatra monorepo clones it into
// extensions/cinatra-ai/google-oauth-connector and runs the tests from there
// (standalone CI skips them — see .github/workflows/ci.yml). repoRoot therefore
// points at the monorepo root, matching the sibling connector configs
// (gemini-connector, tailscale-connector).
const repoRoot = path.join(__dirname, "../../..");
const serverOnlyStub = path.join(repoRoot, "tests/__stubs__/server-only.ts");

export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: serverOnlyStub },
      // @/ → repo-root src, should tests grow imports of host lib modules.
      { find: /^@\/(.+)$/, replacement: path.join(repoRoot, "src") + "/$1" },
    ],
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**"],
  },
});
