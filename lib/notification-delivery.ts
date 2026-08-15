import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectIssues, projects, tasks } from "@/db/schema";

type Database = Awaited<ReturnType<typeof getDb>>;
type EmailDetail = { label: string; value: string };
export type NotificationPayload = Pick<typeof notifications.$inferInsert, "recipientEmail" | "type" | "taskId" | "issueId" | "title" | "message"> & {
  emailDetails?: EmailDetail[];
};

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

function englishNotificationTitle(value: string) {
  return value.split("·")[0].trim();
}

async function emailRecordDetails(db: Database, notification: NotificationPayload) {
  if (notification.emailDetails?.length) return notification.emailDetails;
  if (notification.taskId) {
    const [task] = await db.select({ title: tasks.title, projectCode: tasks.project }).from(tasks).where(eq(tasks.id, notification.taskId)).limit(1);
    if (!task) return null;
    const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.code, task.projectCode)).limit(1);
    return [{ label: "Task", value: task.title }, { label: "Project", value: project?.name || task.projectCode }];
  }
  if (notification.issueId) {
    const [issue] = await db.select({ issueNumber: projectIssues.issueNumber, projectCode: projectIssues.projectCode }).from(projectIssues).where(eq(projectIssues.id, notification.issueId)).limit(1);
    if (!issue) return null;
    const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.code, issue.projectCode)).limit(1);
    return [{ label: "Issue", value: issue.issueNumber }, { label: "Project", value: project?.name || issue.projectCode }];
  }
  return null;
}

async function sendNotificationEmail(db: Database, notification: NotificationPayload) {
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
  const details = await emailRecordDetails(db, notification);
  const emailTitle = englishNotificationTitle(notification.title);
  const detailsHtml = details
    ? `<div style="margin:0 0 22px">${details.map((detail, index) => `<div style="${index ? "margin-top:10px;" : ""}padding:12px 14px;background:#f7f7f4;border-left:4px solid ${index % 2 ? "#171717" : "#ffd200"}"><div style="font-size:12px;color:#707070;text-transform:uppercase;letter-spacing:.6px">${escapeHtml(detail.label)}</div><div style="margin-top:4px;font-size:16px;font-weight:700;color:#171717">${escapeHtml(detail.value)}</div></div>`).join("")}</div>`
    : "";
  const detailsText = details ? `\n\n${details.map((detail) => `${detail.label}: ${detail.value}`).join("\n")}` : "";
  const logoUrl = String(environment.APP_BASE_URL || "").replace(/\/$/, "") + "/hindaza-logo.png";
  const logoHtml = environment.APP_BASE_URL
    ? `<img src="${escapeHtml(logoUrl)}" alt="HINDAZA Engineering BIM" width="190" style="display:block;width:190px;max-width:70%;height:auto;border:0;margin:0 auto 10px" />`
    : "";
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
      subject: emailTitle,
      html: `<div style="font-family:Arial,Tahoma,sans-serif;max-width:620px;margin:auto;color:#202020"><div style="padding:20px 22px 16px;background:#171717;color:#fff;text-align:center;border-bottom:5px solid #ffd200">${logoHtml}<strong style="display:block;font-size:14px;letter-spacing:.5px">PROJECT MANAGEMENT</strong></div><div style="padding:24px;border:1px solid #e5e5df;border-top:0"><h2 style="margin:0 0 18px;font-size:20px">${escapeHtml(emailTitle)}</h2>${detailsHtml}${linkHtml}</div></div>`,
      text: `${emailTitle}${detailsText}${textLink}`,
    }),
  });

  const result = await response.json().catch(() => null) as { success?: boolean; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || result?.success === false) {
    const detail = result?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare Email Sending returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

export async function sendNewEmployeeWelcomeEmail(input: {
  recipientEmail: string;
  displayName: string;
  temporaryPassword: string;
}) {
  const environment = await runtimeEmailEnvironment();
  if (String(environment.EMAIL_NOTIFICATIONS_ENABLED || "").toLowerCase() !== "true") {
    console.warn("Welcome email skipped: EMAIL_NOTIFICATIONS_ENABLED is missing or not true");
    return;
  }
  if (!environment.CLOUDFLARE_ACCOUNT_ID || !environment.CLOUDFLARE_EMAIL_API_TOKEN || !environment.EMAIL_FROM || !input.recipientEmail) {
    const missing = [
      !environment.CLOUDFLARE_ACCOUNT_ID && "CLOUDFLARE_ACCOUNT_ID",
      !environment.CLOUDFLARE_EMAIL_API_TOKEN && "CLOUDFLARE_EMAIL_API_TOKEN",
      !environment.EMAIL_FROM && "EMAIL_FROM",
      !input.recipientEmail && "recipientEmail",
    ].filter(Boolean).join(", ");
    console.warn(`Welcome email skipped: missing runtime configuration: ${missing}`);
    return;
  }

  const baseUrl = String(environment.APP_BASE_URL || "").replace(/\/$/, "");
  const logoHtml = baseUrl
    ? `<img src="${escapeHtml(baseUrl + "/hindaza-logo.png")}" alt="HINDAZA Engineering BIM" width="190" style="display:block;width:190px;max-width:70%;height:auto;border:0;margin:0 auto 10px" />`
    : "";
  const signInHtml = baseUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(baseUrl)}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#ffd200;color:#171717;text-decoration:none;font-weight:700">Sign in to your account</a></p>`
    : "";
  const subject = "Your HINDAZA Project Management account";
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(environment.CLOUDFLARE_ACCOUNT_ID)}/email/sending/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.CLOUDFLARE_EMAIL_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderAddress(environment.EMAIL_FROM),
      to: [input.recipientEmail],
      subject,
      html: `<div style="font-family:Arial,Tahoma,sans-serif;max-width:620px;margin:auto;color:#202020"><div style="padding:20px 22px 16px;background:#171717;color:#fff;text-align:center;border-bottom:5px solid #ffd200">${logoHtml}<strong style="display:block;font-size:14px;letter-spacing:.5px">PROJECT MANAGEMENT</strong></div><div style="padding:24px;border:1px solid #e5e5df;border-top:0"><h2 style="margin:0 0 10px;font-size:22px">Welcome, ${escapeHtml(input.displayName)}</h2><p style="margin:0 0 20px;line-height:1.7">Your HINDAZA Project Management account has been created.</p><div style="padding:12px 14px;background:#f7f7f4;border-left:4px solid #ffd200"><div style="font-size:12px;color:#707070;text-transform:uppercase;letter-spacing:.6px">Email</div><div style="margin-top:4px;font-size:16px;font-weight:700;color:#171717">${escapeHtml(input.recipientEmail)}</div></div><div style="margin-top:10px;padding:12px 14px;background:#f7f7f4;border-left:4px solid #171717"><div style="font-size:12px;color:#707070;text-transform:uppercase;letter-spacing:.6px">Temporary Password</div><div style="margin-top:4px;font-family:Consolas,Monaco,monospace;font-size:17px;font-weight:700;color:#171717">${escapeHtml(input.temporaryPassword)}</div></div><p style="margin:18px 0 0;color:#6a6a6a;font-size:13px;line-height:1.6">For your security, change this temporary password after signing in for the first time.</p>${signInHtml}</div></div>`,
      text: `${subject}\n\nWelcome, ${input.displayName}\n\nEmail: ${input.recipientEmail}\nTemporary Password: ${input.temporaryPassword}\n\nFor your security, change this temporary password after signing in for the first time.${baseUrl ? `\n\n${baseUrl}` : ""}`,
    }),
  });

  const result = await response.json().catch(() => null) as { success?: boolean; errors?: Array<{ message?: string }> } | null;
  if (!response.ok || result?.success === false) {
    const detail = result?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare welcome email returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

export async function createNotifications(db: Database, input: NotificationPayload | NotificationPayload[]) {
  const emailPayloads = Array.isArray(input) ? input : [input];
  if (!emailPayloads.length) return;

  const payloads = emailPayloads.map((payload) => ({
    recipientEmail: payload.recipientEmail,
    type: payload.type,
    taskId: payload.taskId,
    issueId: payload.issueId,
    title: payload.title,
    message: payload.message,
  }));
  await db.insert(notifications).values(payloads);
  for (const payload of emailPayloads) {
    try {
      await sendNotificationEmail(db, payload);
    } catch (error) {
      console.error("Email delivery failed; the in-app notification was preserved", error instanceof Error ? error.message : "Unknown email error");
    }
  }
}
