import { count, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projectMembers, projects, taskAttachments, taskComments, taskSubtasks, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TASK_QUERY_CHUNK_SIZE = 90;

function chunks<T>(values: T[], size = TASK_QUERY_CHUNK_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const db = await getDb();
    const [userRows, projectRows, membershipRows, taskRows] = await db.batch([
      db.select({ email: users.email, discipline: users.discipline })
        .from(users)
        .where(eq(users.active, true)),
      db.select({ id: projects.id, code: projects.code }).from(projects),
      db.select({
        projectId: projectMembers.projectId,
        employeeEmail: projectMembers.employeeEmail,
        isProjectManager: projectMembers.isProjectManager,
      }).from(projectMembers),
      db.select({
        id: tasks.id,
        employeeEmail: tasks.employeeEmail,
        project: tasks.project,
        visibility: tasks.visibility,
        submittedToManager: tasks.submittedToManager,
        createdBy: tasks.createdBy,
      }).from(tasks),
    ]);

    const managerDisciplineEmails = new Set(
      userRows.filter((user) => user.discipline === currentUser.discipline).map((user) => user.email),
    );
    const assignedProjectIds = new Set<number>();
    const managedProjectIds = new Set<number>();
    for (const membership of membershipRows) {
      if (membership.employeeEmail !== currentUser.email) continue;
      assignedProjectIds.add(membership.projectId);
      if (membership.isProjectManager) managedProjectIds.add(membership.projectId);
    }
    const assignedProjectCodes = new Set(projectRows.filter((project) => assignedProjectIds.has(project.id)).map((project) => project.code));
    const managedProjectCodes = new Set(projectRows.filter((project) => managedProjectIds.has(project.id)).map((project) => project.code));
    const visibleTasks = currentUser.role === "owner"
      ? taskRows.filter((task) =>
        task.visibility === "team" ||
        task.submittedToManager ||
        task.createdBy === currentUser.email ||
        task.employeeEmail === currentUser.email,
      )
      : currentUser.role === "manager"
        ? taskRows.filter((task) =>
          (task.createdBy === currentUser.email || task.employeeEmail === currentUser.email || ((task.visibility === "team" || task.submittedToManager) && (managerDisciplineEmails.has(task.employeeEmail) || managedProjectCodes.has(task.project)))) &&
          (task.project === "PERSONAL" || assignedProjectCodes.has(task.project)),
        )
        : taskRows.filter((task) => task.employeeEmail === currentUser.email || (task.visibility === "private" && task.createdBy === currentUser.email) || ((task.visibility === "team" || task.submittedToManager) && managedProjectCodes.has(task.project)));

    const visibleTaskIds = visibleTasks.map((task) => task.id);
    const countByTask = new Map<number, { commentCount: number; subtaskCount: number; completedSubtaskCount: number; attachmentCount: number }>();
    for (const taskIds of chunks(visibleTaskIds)) {
      const [commentRows, subtaskRows, attachmentRows] = await db.batch([
        db.select({ taskId: taskComments.taskId, total: count() })
          .from(taskComments)
          .where(inArray(taskComments.taskId, taskIds))
          .groupBy(taskComments.taskId),
        db.select({
          taskId: taskSubtasks.taskId,
          total: count(),
          completed: sql<number>`sum(case when ${taskSubtasks.completed} = 1 then 1 else 0 end)`,
        }).from(taskSubtasks)
          .where(inArray(taskSubtasks.taskId, taskIds))
          .groupBy(taskSubtasks.taskId),
        db.select({ taskId: taskAttachments.taskId, total: count() })
          .from(taskAttachments)
          .where(inArray(taskAttachments.taskId, taskIds))
          .groupBy(taskAttachments.taskId),
      ]);
      for (const taskId of taskIds) countByTask.set(taskId, { commentCount: 0, subtaskCount: 0, completedSubtaskCount: 0, attachmentCount: 0 });
      for (const row of commentRows) countByTask.get(row.taskId)!.commentCount = Number(row.total) || 0;
      for (const row of subtaskRows) {
        const taskCount = countByTask.get(row.taskId)!;
        taskCount.subtaskCount = Number(row.total) || 0;
        taskCount.completedSubtaskCount = Number(row.completed) || 0;
      }
      for (const row of attachmentRows) countByTask.get(row.taskId)!.attachmentCount = Number(row.total) || 0;
    }

    return Response.json({
      counts: visibleTaskIds.map((taskId) => ({ taskId, ...countByTask.get(taskId)! })),
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to load task counters", error);
    return Response.json({ error: "Unable to load task counters." }, { status: 500 });
  }
}
