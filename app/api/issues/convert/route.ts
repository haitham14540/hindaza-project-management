import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectIssues, projectMembers, projects, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

function cleanText(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isManagement(currentUser)) return Response.json({ error: "Only management can convert an issue to a task." }, { status: 403 });
    const payload = await request.json() as Record<string, unknown>;
    const issueId = Number(payload.issueId);
    const employeeEmail = cleanText(payload.employeeEmail, 180).toLowerCase();
    if (!Number.isInteger(issueId) || !employeeEmail) return Response.json({ error: "Issue and employee are required." }, { status: 400 });
    const db = await getDb();
    const [issue] = await db.select().from(projectIssues).where(eq(projectIssues.id, issueId)).limit(1);
    if (!issue) return Response.json({ error: "Project issue not found." }, { status: 404 });
    if (issue.convertedTaskId) return Response.json({ error: "This issue has already been converted to a task." }, { status: 409 });
    const [employee] = await db.select({ email: users.email, displayName: users.displayName, discipline: users.discipline, role: users.role })
      .from(users).where(and(eq(users.email, employeeEmail), eq(users.active, true))).limit(1);
    if (!employee || employee.role !== "member") return Response.json({ error: "Select an active team member." }, { status: 400 });
    if (employee.discipline !== issue.discipline) return Response.json({ error: "Select a project member from the same discipline as the issue." }, { status: 400 });
    if (currentUser.role === "manager" && employee.discipline !== currentUser.discipline) return Response.json({ error: "You can assign tasks only within your discipline." }, { status: 403 });
    const [membership] = await db.select({ id: projectMembers.id }).from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projects.code, issue.projectCode), eq(projectMembers.employeeEmail, employeeEmail))).limit(1);
    if (!membership) return Response.json({ error: "Select an employee assigned to this project." }, { status: 400 });

    const task = await db.insert(tasks).values({
      taskDate: cleanText(payload.dueDate, 10) || new Date().toISOString().slice(0, 10),
      employeeName: employee.displayName,
      employeeEmail: employee.email,
      project: issue.projectCode,
      title: cleanText(payload.title, 180) || issue.description.slice(0, 180),
      expectedOutput: `Source Issue: ${issue.issueNumber}\n${issue.description}`.slice(0, 800),
      priority: issue.priority === "critical" || issue.priority === "high" ? "high" : issue.priority === "low" ? "low" : "medium",
      plannedHours: Math.max(0, Math.min(999, Number(payload.plannedHours) || 0)),
      status: "not_started",
      managerCheck: "new",
      visibility: "team",
      submittedToManager: false,
      createdBy: currentUser.email,
    }).returning();
    const updatedIssue = await db.update(projectIssues).set({ convertedTaskId: task[0].id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(projectIssues.id, issueId)).returning();
    await db.insert(notifications).values({
      recipientEmail: employee.email,
      type: "task_assigned",
      taskId: task[0].id,
      title: "Issue converted to task",
      message: `${issue.issueNumber} · ${issue.projectCode}`,
    });
    await recordActivity(db, currentUser, { action: "created", entityType: "task", entityId: task[0].id, entityLabel: task[0].title, projectCode: issue.projectCode, details: `Converted from ${issue.issueNumber}` });
    await recordActivity(db, currentUser, { action: "converted", entityType: "issue", entityId: issue.id, entityLabel: issue.issueNumber, projectCode: issue.projectCode, details: `Converted to task #${task[0].id}` });
    return Response.json({ issue: updatedIssue[0], task: task[0] }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to convert issue to task." }, { status: 500 });
  }
}
