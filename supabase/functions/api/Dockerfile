# Deno standalone serving the Hono api function.
# Use this for self-hosted deployments. For Supabase Cloud, deploy via
# `supabase functions deploy api` instead — that path skips the Dockerfile.
FROM denoland/deno:2.1.4

WORKDIR /app

# Copy the workspace shared package preserving the relative layout
# expected by api/deno.json import_map ("../../../packages/shared/src/index.ts")
COPY packages/shared ./packages/shared
COPY supabase/functions/api ./supabase/functions/api

WORKDIR /app/supabase/functions/api

# Drop any host-generated lockfile (newer Deno may emit v5 which 2.1.4 can't parse)
# and pre-cache npm deps so cold start is fast.
RUN rm -f deno.lock && deno cache index.ts

EXPOSE 8000
ENV PORT=8000

# Deno.serve binds to PORT env (default 8000) and serves the Hono app
CMD ["deno", "run", "--allow-all", "--unstable", "index.ts"]
