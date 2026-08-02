import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type RuntimeEnvironment = { DB?: D1Database };

export async function getD1() {
  const runtimeModule = "cloudflare:workers";
  const { env } = (await import(/* @vite-ignore */ runtimeModule)) as {
    env: RuntimeEnvironment;
  };
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1(), { schema });
}
