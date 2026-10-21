import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "node:path";
import { DEV_TUNNEL_HOSTS } from "@slippay/shared";

// Allow Vite to resolve raw imports of the monorepo's top-level docs/ so the
// /docs route can bundle every markdown file at build time.
const DOCS_ROOT = resolve(__dirname, "../../docs");

export default defineConfig({
  plugins: [
    react(),
    // Solana SDKs (@solana/web3.js, anchor, lazorkit) reference Node globals
    // (Buffer/global/process) that the browser lacks. Without this the Solana
    // path crashes (LazorkitProvider new Connection() throws on Buffer → infinite
    // re-render → blank page). Stellar path never needed it (stellar-sdk bundles its own).
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  define: {
    __BUILD_TAG__: JSON.stringify(new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)),
  },
  resolve: {
    alias: {
      // @solana-program/memo is imported by @privy-io/react-auth/solana but only
      // used by the SIWS (Sign-In-With-Solana) auth flow, which this app (email +
      // embedded wallet) never triggers. The real package needs a @solana/kit
      // version incompatible with the one @solana-program/token pins, so it's a
      // dependency dead-end — stubbed. See src/stubs/solana-program-memo.ts.
      "@solana-program/memo": resolve(__dirname, "src/stubs/solana-program-memo.ts"),
    },
  },
  server: {
    port: 5173,
    fs: { allow: ["..", "../..", DOCS_ROOT] },
    // Allow dev tunnels (localtunnel/ngrok) to reach the dev server for the
    // mobile passkey e2e. Dev-only; these hosts are never used in prod builds.
    allowedHosts: [...DEV_TUNNEL_HOSTS],
  },
});
