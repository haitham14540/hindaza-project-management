import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema";

type RuntimeEnvironment = { DB?: D1Database };

export async function getD1() {
  const runtimeModule = "cloudflare:workers";
  const { env } = (await import(/* @vite-ignore */ runtimeModule)) as {
    env: RuntimeEnvironment;
  };
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Add the DB binding to wrangler.jsonc and deploy through Cloudflare Workers."
    );
  }
  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1(), { schema });
}
