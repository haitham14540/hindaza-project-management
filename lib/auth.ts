import { and, count, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { ensureDatabase } from "@/lib/db-init";

export type Discipline = "Architecture" | "ID" | "Structure" | "Mechanical" | "Electrical" | "Infrastructure" | "";

export type AppUser = {
  email: string;
  displayName: string;
  role: "manager" | "member";
  discipline: Discipline;
};

type RuntimeEnvironment = { SETUP_KEY?: string };

const SESSION_COOKIE = "hindaza_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 210_000;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return new Uint8Array();
  return new Uint8Array(hex.match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

async function runtimeEnvironment() {
  const runtimeModule = "cloudflare:workers";
  const { env } = (await import(/* @vite-ignore */ runtimeModule)) as { env: RuntimeEnvironment };
  return env;
}

function safeUser(row: typeof users.$inferSelect): AppUser {
  return { email: row.email, displayName: row.displayName, role: row.role, discipline: row.discipline };
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function randomHex(size: number) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(size)));
}

export async function passwordRecord(password: string) {
  const salt = randomHex(16);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(salt), iterations: PASSWORD_ITERATIONS },
    keyMaterial,
    256,
  );
  return { passwordHash: bytesToHex(new Uint8Array(bits)), passwordSalt: salt };
}

export async function verifyPassword(password: string, expectedHash: string, salt: string) {
  if (!expectedHash || !salt) return false;
  const candidate = await passwordRecordWithSalt(password, salt);
  const left = hexToBytes(candidate);
  const right = hexToBytes(expectedHash);
  if (left.length !== right.length || left.length === 0) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function passwordRecordWithSalt(password: string, salt: string) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(salt), iterations: PASSWORD_ITERATIONS },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function setupKeyIsValid(candidate: string) {
  const env = await runtimeEnvironment();
  if (!env.SETUP_KEY || !candidate) return false;
  const [left, right] = await Promise.all([sha256(candidate), sha256(env.SETUP_KEY)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function setupRequired() {
  await ensureDatabase();
  const db = await getDb();
  const [{ total }] = await db.select({ total: count() }).from(users);
  return total === 0;
}

export async function createSession(email: string, request: Request) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_AGE_SECONDS;
  const db = await getDb();
  await db.insert(sessions).values({ tokenHash, email, expiresAt });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_AGE_SECONDS}${secure}`;
}

export async function clearSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    await ensureDatabase();
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function getCurrentUser(request: Request): Promise<AppUser> {
  await ensureDatabase();
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) throw new Error("UNAUTHENTICATED");
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.email, users.email))
    .where(and(eq(sessions.tokenHash, await sha256(token)), gt(sessions.expiresAt, now), eq(users.active, true)))
    .limit(1);
  if (!rows[0]) throw new Error("UNAUTHENTICATED");
  return safeUser(rows[0].user);
}

export function unauthorizedResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return Response.json({ error: "يرجى تسجيل الدخول للوصول إلى النظام." }, { status: 401 });
  }
  return null;
}
