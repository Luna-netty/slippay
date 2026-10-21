import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Tests run on Node, not in a browser, so the shims that vite.config.ts
// installs for the app bundle must not apply here.
//
// vite-plugin-node-polyfills rewrites `node:fs` to null. That is correct for
// the browser build but it makes filesystem tests impossible: test/alt-text.test.ts
// reads src/ to assert every <img> has alt text, and its `readdirSync` import
// resolved to undefined, so the suite failed at collection.
//
// Omitting the plugin here restores the real node: builtins. The app build is
// unaffected because it still uses vite.config.ts.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TAG__: JSON.stringify("test"),
  },
  resolve: {
    alias: {
      // Same dead-end stub as the app build; kept so imports resolve identically.
      "@solana-program/memo": resolve(__dirname, "src/stubs/solana-program-memo.ts"),
    },
  },
  test: {
    // jsdom only where a file opts in with `// @vitest-environment jsdom`.
    environment: "node",
  },
});
