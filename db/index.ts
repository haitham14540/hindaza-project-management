import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type RuntimeEnvironment = { DB?: D1Database; BUCKET?: R2Bucket };

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

export async function getBucket() {
  const runtimeModule = "cloudflare:workers";
  const { env } = (await import(/* @vite-ignore */ runtimeModule)) as { env: RuntimeEnvironment };
  if (!env.BUCKET) throw new Error("Cloudflare R2 binding `BUCKET` is unavailable.");
  return env.BUCKET;
}
