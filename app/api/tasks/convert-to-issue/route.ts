import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projectIssues, projectMembers, projects, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const disciplines = ["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"] as const;
const disciplineCodes: Record<string, string> = { Architecture: "ARC", ID: "ID", Structure: "STR", Mechanical: "MECH", Electrical: "ELEC", Infrastructure: "INF" };

function cleanText(value: unknown, max = 1_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function issueNumber(projectCode: string, discipline: string, sequence: number) {
  const projectPrefix = projectCode.replace(/[^A-Z0-9]/gi, "").slice(0, 4).toUpperCase();
  return `${projectPrefix}-${disciplineCodes[discipline] || "ARC"}-${String(sequence).padStart(3, "0")}`;
}

function operationalDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isManagement(currentUser)) return Response.json({ error: "Only the owner or a manager can convert a task to an issue." }, { status: 403 });
    const payload = await request.json() as Record<string, unknown>;
    const taskId = Number(payload.taskId);
    if (!Number.isInteger(taskId)) return Response.json({ error: "Task is required." }, { status: 400 });

    const db = await getDb();
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return Response.json({ error: "Task not found." }, { status: 404 });
    if (task.project === "PERSONAL") return Response.json({ error: "A personal task must be assigned to a project before creating an issue." }, { status: 400 });
    const [existingLink] = await db.select().from(projectIssues).where(eq(projectIssues.convertedTaskId, taskId)).limit(1);
    if (existingLink) return Response.json({ error: `This task is already linked to ${existingLink.issueNumber}.` }, { status: 409 });

    const requestedDiscipline = cleanText(payload.discipline, 40);
    const discipline = currentUser.role === "manager" && disciplines.includes(currentUser.discipline as (typeof disciplines)[number]) ? currentUser.discipline : requestedDiscipline;
    if (!disciplines.includes(discipline as (typeof disciplines)[number])) return Response.json({ error: "Select a valid issue discipline." }, { status: 400 });
    if (currentUser.role === "manager") {
      const [membership] = await db.select({ id: projectMembers.id, isProjectManager: projectMembers.isProjectManager }).from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(and(eq(projects.code, task.project), eq(projectMembers.employeeEmail, currentUser.email))).limit(1);
      if (!membership) return Response.json({ error: "Managers can create linked issues only within assigned projects." }, { status: 403 });
      const [employee] = await db.select({ discipline: users.discipline }).from(users).where(eq(users.email, task.employeeEmail)).limit(1);
      const creatorAccess = task.createdBy === currentUser.email;
      const projectManagerAccess = Boolean(membership.isProjectManager) && Boolean(currentUser.discipline) && employee?.discipline === currentUser.discipline;
      if (!creatorAccess && !projectManagerAccess) {
        return Response.json({ error: "Only the task creator, project manager, or owner can convert this task to an issue." }, { status: 403 });
      }
    }

    const [last] = await db.select({ sequence: projectIssues.sequence }).from(projectIssues)
      .where(and(eq(projectIssues.projectCode, task.project), eq(projectIssues.discipline, discipline as (typeof disciplines)[number])))
      .orderBy(desc(projectIssues.sequence)).limit(1);
    const sequence = (last?.sequence || 0) + 1;
    const description = cleanText(payload.description, 2_000) || `${task.title}${task.expectedOutput ? ` — ${task.expectedOutput}` : ""}`;
    const category = cleanText(payload.category, 120) || "Task Follow-up";
    const priority = task.priority === "high" ? "high" : task.priority === "low" ? "low" : "medium";
    const [issue] = await db.insert(projectIssues).values({
      issueNumber: issueNumber(task.project, discipline, sequence),
      sequence,
      projectCode: task.project,
      status: "open",
      discipline: discipline as (typeof disciplines)[number],
      description,
      category,
      priority,
      assigneeEmail: task.employeeEmail,
      raisedByEmail: currentUser.email,
      raisedByName: currentUser.displayName,
      issueDate: cleanText(payload.issueDate, 10) || operationalDate(),
      convertedTaskId: task.id,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).returning();

    await recordActivity(db, currentUser, { action: "converted", entityType: "task", entityId: task.id, entityLabel: task.title, projectCode: task.project, details: `Converted to ${issue.issueNumber}` });
    await recordActivity(db, currentUser, { action: "created", entityType: "issue", entityId: issue.id, entityLabel: issue.issueNumber, projectCode: task.project, details: `Converted from task #${task.id}` });
    return Response.json({ issue }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to convert task to issue." }, { status: 500 });
  }
}
