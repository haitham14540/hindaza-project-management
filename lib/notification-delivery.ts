import { getDb } from "@/db";
import { notifications } from "@/db/schema";

type Database = Awaited<ReturnType<typeof getDb>>;
export type NotificationPayload = Pick<typeof notifications.$inferInsert, "recipientEmail" | "type" | "taskId" | "issueId" | "title" | "message">;

type EmailRuntimeEnvironment = {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
  EMAIL_FROM?: string;
  APP_BASE_URL?: string;
  EMAIL_NOTIFICATIONS_ENABLED?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

async function runtimeEmailEnvironment() {
  const runtimeModule = "cloudflare:workers";
  try {
    const { env } = (await import(/* @vite-ignore */ runtimeModule)) as { env: EmailRuntimeEnvironment };
    return env;
  } catch {
    return {} as EmailRuntimeEnvironment;
  }
}

function notificationUrl(environment: EmailRuntimeEnvironment, notification: NotificationPayload) {
  const baseUrl = String(environment.APP_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) return "";
  if (notification.taskId) return `${baseUrl}/?view=projects&task=${notification.taskId}`;
  if (notification.issueId) return `${baseUrl}/?view=projects&section=issues`;
  return baseUrl;
}

function senderAddress(value: string) {
  const normalized = value.trim();
  const namedAddress = normalized.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (!namedAddress) return normalized;
  return { address: namedAddress[2], name: namedAddress[1].trim().replace(/^"|"$/g, "") };
}

async function sendNotificationEmail(notification: NotificationPayload) {
  const environment = await runtimeEmailEnvironment();
  if (String(environment.EMAIL_NOTIFICATIONS_ENABLED || "").toLowerCase() !== "true") {
    console.warn("Email notification skipped: EMAIL_NOTIFICATIONS_ENABLED is missing or not true");
    return;
  }
  if (!environment.CLOUDFLARE_ACCOUNT_ID || !environment.CLOUDFLARE_EMAIL_API_TOKEN || !environment.EMAIL_FROM || !notification.recipientEmail) {
    const missing = [
      !environment.CLOUDFLARE_ACCOUNT_ID && "CLOUDFLARE_ACCOUNT_ID",
      !environment.CLOUDFLARE_EMAIL_API_TOKEN && "CLOUDFLARE_EMAIL_API_TOKEN",
      !environment.EMAIL_FROM && "EMAIL_FROM",
      !notification.recipientEmail && "recipientEmail",
    ].filter(Boolean).join(", ");
    console.warn(`Email notification skipped: missing runtime configuration: ${missing}`);
    return;
  }

  const url = notificationUrl(environment, notification);
  const linkHtml = url ? `<p style="margin:24px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#ffd200;color:#171717;text-decoration:none;font-weight:700">Open HINDAZA Project Management</a></p>` : "";
  const textLink = url ? `\n\n${url}` : "";
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(environment.CLOUDFLARE_ACCOUNT_ID)}/email/sending/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.CLOUDFLARE_EMAIL_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderAddress(environment.EMAIL_FROM),
      to: [notification.recipientEmail],
      subject: notification.title,
      html: `<div style="font-family:Arial,Tahoma,sans-serif;max-width:620px;margin:auto;color:#202020"><div style="padding:18px 22px;background:#171717;color:#fff;border-bottom:5px solid #ffd200"><strong>HINDAZA Project Management</strong></div><div style="padding:24px;border:1px solid #e5e5df;border-top:0"><h2 style="margin:0 0 14px;font-size:20px">${escapeHtml(notification.title)}</h2><p style="margin:0;line-height:1.7">${escapeHtml(notification.message)}</p>${linkHtml}</div></div>`,
      text: `${notification.title}\n\n${notification.message}${textLink}`,
    }),
  });

  const result = await response.json().catch(() => null) as { success?: boolean; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || result?.success === false) {
    const detail = result?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare Email Sending returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

export async function createNotifications(db: Database, input: NotificationPayload | NotificationPayload[]) {
  const payloads = Array.isArray(input) ? input : [input];
  if (!payloads.length) return;

  await db.insert(notifications).values(payloads);
  for (const payload of payloads) {
    try {
      await sendNotificationEmail(payload);
    } catch (error) {
      console.error("Email delivery failed; the in-app notification was preserved", error instanceof Error ? error.message : "Unknown email error");
    }
  }
}
