// PM2 ecosystem for slippay backend (api + listener) on the VPS.
// Reads /opt/slippay-backend/.env (server-only, never committed) and
// injects vars into both processes.
//
// Usage on server:
//   cd /opt/slippay-backend
//   pm2 start ecosystem.config.cjs
//   pm2 save

const path = require("node:path");
const fs = require("node:fs");

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const ROOT = __dirname;
const env = loadEnv(path.join(ROOT, ".env"));

const apiEnv = {
  PORT: env.API_PORT || "8080",
  CHECKOUT_TOKEN_SECRET: env.CHECKOUT_TOKEN_SECRET,
  API_KEY_PEPPER: env.API_KEY_PEPPER,
  ZOD_VERBOSE: env.ZOD_VERBOSE || "",
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  SLIPPAY_DB_SCHEMA: env.SLIPPAY_DB_SCHEMA || "public",
  STELLAR_NETWORK: env.STELLAR_NETWORK || "TESTNET",
  CHECKOUT_BASE_URL: env.CHECKOUT_BASE_URL || "https://api.slippay.cc",
  RATE_BRL_USDC: env.RATE_BRL_USDC || "",
};

const listenerEnv = {
  NODE_ENV: "production",
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  SLIPPAY_DB_SCHEMA: env.SLIPPAY_DB_SCHEMA || "public",
  STELLAR_NETWORK: env.STELLAR_NETWORK || "TESTNET",
  MERCHANT_POLL_MS: env.MERCHANT_POLL_MS || "30000",
};

const PULSE_PYTHON = path.join(ROOT, "agents/pulse/.venv/bin/python");
const PULSE_SCRIPT = path.join(ROOT, "agents/pulse/pulse.py");
const pulseAvailable = fs.existsSync(PULSE_PYTHON) && fs.existsSync(path.join(ROOT, "agents/pulse/.env"));

module.exports = {
  apps: [
    ...(pulseAvailable ? [{
      name: "slippay-pulse",
      cwd: path.join(ROOT, "agents/pulse"),
      script: PULSE_SCRIPT,
      interpreter: PULSE_PYTHON,
      restart_delay: 5000,
      max_memory_restart: "200M",
      out_file: path.join(ROOT, "logs/pulse.out.log"),
      error_file: path.join(ROOT, "logs/pulse.err.log"),
      time: true,
    }] : []),
    {
      name: "slippay-api",
      cwd: path.join(ROOT, "supabase/functions/api"),
      script: process.env.HOME + "/.deno/bin/deno",
      args: "run --allow-all --unstable index.ts",
      env: apiEnv,
      max_memory_restart: "400M",
      out_file: path.join(ROOT, "logs/api.out.log"),
      error_file: path.join(ROOT, "logs/api.err.log"),
      time: true,
    },
    {
      name: "slippay-listener",
      cwd: path.join(ROOT, "apps/listener"),
      script: "node",
      args: "dist/main.js",
      env: listenerEnv,
      max_memory_restart: "300M",
      out_file: path.join(ROOT, "logs/listener.out.log"),
      error_file: path.join(ROOT, "logs/listener.err.log"),
      time: true,
    },
  ],
};