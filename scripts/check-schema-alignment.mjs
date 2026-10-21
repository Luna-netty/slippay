#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 1. Read supabase/config.toml exposed schemas
const configTomlPath = path.join(ROOT, "supabase/config.toml");
const configToml = fs.readFileSync(configTomlPath, "utf8");
const schemasMatch = configToml.match(/schemas\s*=\s*\[(.*?)\]/);
if (!schemasMatch) {
  console.error("check-schema-alignment: Could not find schemas in supabase/config.toml");
  process.exit(1);
}
const exposedSchemas = schemasMatch[1]
  .split(",")
  .map((s) => s.trim().replace(/['"]/g, ""))
  .filter(Boolean);

// 2. Read docker-compose.yml default schema
const composePath = path.join(ROOT, "docker-compose.yml");
const compose = fs.readFileSync(composePath, "utf8");
const composeMatches = [...compose.matchAll(/SLIPPAY_DB_SCHEMA:\s*\$\{SLIPPAY_DB_SCHEMA:-([^}]+)\}/g)];
if (composeMatches.length === 0) {
  console.error("check-schema-alignment: Could not find SLIPPAY_DB_SCHEMA default in docker-compose.yml");
  process.exit(1);
}

for (const match of composeMatches) {
  const defaultSchema = match[1].trim();
  if (!exposedSchemas.includes(defaultSchema)) {
    console.error(
      `check-schema-alignment: docker-compose.yml default schema "${defaultSchema}" is NOT in supabase/config.toml exposed schemas [${exposedSchemas.join(", ")}]`,
    );
    process.exit(1);
  }
}

// 3. Read .env.docker.example
const dockerEnvPath = path.join(ROOT, ".env.docker.example");
const dockerEnv = fs.readFileSync(dockerEnvPath, "utf8");
const dockerEnvMatch = dockerEnv.match(/^SLIPPAY_DB_SCHEMA=([^\r\n#\s]+)/m);
if (dockerEnvMatch) {
  const dockerEnvSchema = dockerEnvMatch[1].trim();
  if (!exposedSchemas.includes(dockerEnvSchema)) {
    console.error(
      `check-schema-alignment: .env.docker.example schema "${dockerEnvSchema}" is NOT in supabase/config.toml exposed schemas [${exposedSchemas.join(", ")}]`,
    );
    process.exit(1);
  }
}

console.log(
  `check-schema-alignment: OK. docker-compose.yml default schema and env examples agree with supabase/config.toml exposed schemas [${exposedSchemas.join(", ")}].`,
);
