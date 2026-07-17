import { defineConfig } from "vitest/config";

// Read only by vitest-based tooling — today that's evalite (pnpm eval:scribe).
// Next, Playwright, and the node:test unit runner ignore this file.
export default defineConfig({
  resolve: {
    alias: {
      // Neutralize `import "server-only"` (lib/openemr/api.ts) — the vitest
      // equivalent of the old runner's `tsx --conditions=react-server`.
      "server-only": new URL(
        "./tests/evals/stubs/server-only.ts",
        import.meta.url
      ).pathname,
      // Vitest doesn't read tsconfig paths; a string key only rewrites
      // "@/..." (the next char must be "/"), so "@scope/..." packages are safe.
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
