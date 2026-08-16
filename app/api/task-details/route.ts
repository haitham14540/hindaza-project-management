import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projectIssues, taskAttachments, taskComments, taskSubtasks, taskTimeEntries } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { taskForView } from "@/lib/task-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const taskId = Number(new URL(request.url).searchParams.get("taskId"));
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return Response.json({ error: "Invalid task id." }, { status: 400 });
    }

    const db = await getDb();
    const task = await taskForView(db, currentUser, taskId);
    if (!task) return Response.json({ error: "Task not found." }, { status: 404 });

    // Five independent, task-scoped reads stay below D1's connection ceiling
    // and avoid loading the complete project history during application start.
    const [comments, timeEntries, subtasks, attachments, issueLinks] = await Promise.all([
      db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(asc(taskComments.createdAt), asc(taskComments.id)),
      db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, taskId)).orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id)),
      db.select().from(taskSubtasks).where(eq(taskSubtasks.taskId, taskId)).orderBy(asc(taskSubtasks.createdAt), asc(taskSubtasks.id)),
      db.select().from(taskAttachments).where(eq(taskAttachments.taskId, taskId)).orderBy(asc(taskAttachments.createdAt), asc(taskAttachments.id)),
      db.select({
        id: projectIssues.id,
        issueNumber: projectIssues.issueNumber,
        projectCode: projectIssues.projectCode,
        convertedTaskId: projectIssues.convertedTaskId,
        createdAt: projectIssues.createdAt,
      }).from(projectIssues).where(eq(projectIssues.convertedTaskId, taskId)),
    ]);

    return Response.json(
      { comments, timeEntries, subtasks, taskAttachments: attachments, taskIssueLinks: issueLinks },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to load task details", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load task details." },
      { status: 500 },
    );
  }
}
