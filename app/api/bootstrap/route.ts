import { and, asc, count, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectIssues, projectMembers, projects, taskAttachments, taskComments, taskSubtasks, taskTimeEntries, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TASK_QUERY_CHUNK_SIZE = 90;

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

const sampleTasks = (email: string) => {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      taskDate: today,
      employeeName: "Ali Eneizat",
      project: "AZAD",
      title: "ZONE 02 Check",
      expectedOutput: "PDF, CAD and coordinated model package",
      priority: "high" as const,
      plannedHours: 7,
      startTime: "08:30",
      endTime: "18:00",
      actualHours: 9.5,
      status: "done" as const,
      managerCheck: "approved" as const,
      managerNote: "Checked and approved",
      createdBy: email,
    },
    {
      taskDate: today,
      employeeName: "Mohannad Al Marei",
      project: "TRO",
      title: "Update Lobby Sections",
      expectedOutput: "Updated and coordinated section sheets",
      priority: "high" as const,
      plannedHours: 5,
      startTime: "09:00",
      endTime: "18:00",
      actualHours: 9,
      status: "done" as const,
      managerCheck: "pending" as const,
      managerNote: "",
      createdBy: email,
    },
    {
      taskDate: today,
      employeeName: "Farah Yousef",
      project: "TRO",
      title: "Door Schedule Check",
      expectedOutput: "Checked door schedule and corrected tags",
      priority: "high" as const,
      plannedHours: 3,
      startTime: "08:15",
      endTime: "11:45",
      actualHours: 3.5,
      status: "needs_revision" as const,
      managerCheck: "returned" as const,
      managerNote: "Revise two door tags",
      createdBy: email,
    },
    {
      taskDate: today,
      employeeName: "Hamza Muslih",
      project: "POJ",
      title: "Revit Model Cleanup",
      expectedOutput: "Clean and coordinated Revit model",
      priority: "medium" as const,
      plannedHours: 4,
      startTime: "09:00",
      endTime: "10:30",
      actualHours: 1.5,
      status: "blocked" as const,
      managerCheck: "pending" as const,
      managerNote: "Waiting for model link",
      createdBy: email,
    },
    {
      taskDate: today,
      employeeName: "Yazan Khatib",
      project: "RITZ",
      title: "Detail Sheet Update",
      expectedOutput: "Updated architectural detail sheet",
      priority: "low" as const,
      plannedHours: 3,
      startTime: "08:45",
      endTime: "11:30",
      actualHours: 2.75,
      status: "done" as const,
      managerCheck: "approved" as const,
      managerNote: "",
      createdBy: email,
    },
  ];
};

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const db = await getDb();
    if (process.env.NODE_ENV !== "production" && isManagement(currentUser)) {
      const [{ total }] = await db.select({ total: count() }).from(tasks);
      if (total === 0) await db.insert(tasks).values(sampleTasks(currentUser.email));
    }

    // Keep the first application request intentionally small. Historical task
    // notes, sessions, subtasks and attachments are loaded only for the task a
    // user opens; returning every historical row here made D1 bootstrap calls
    // exceed the Worker request window as the project grew.
    const userRows = await db.select({
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      discipline: users.discipline,
      profileImageKey: users.profileImageKey,
    }).from(users).where(eq(users.active, true)).orderBy(asc(users.displayName));
    const allProjectRows = await db.select().from(projects).orderBy(asc(projects.code));
    const membershipRows = await db.select().from(projectMembers);
    const allTaskRows = await db.select({
      ...getTableColumns(tasks),
      commentCount: sql<number>`(select count(*) from ${taskComments} where ${taskComments.taskId} = ${tasks.id})`,
      subtaskCount: sql<number>`(select count(*) from ${taskSubtasks} where ${taskSubtasks.taskId} = ${tasks.id})`,
      completedSubtaskCount: sql<number>`(select count(*) from ${taskSubtasks} where ${taskSubtasks.taskId} = ${tasks.id} and ${taskSubtasks.completed} = 1)`,
      attachmentCount: sql<number>`(select count(*) from ${taskAttachments} where ${taskAttachments.taskId} = ${tasks.id})`,
    }).from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id));
    const notificationRows = await db.select().from(notifications)
      .where(eq(notifications.recipientEmail, currentUser.email))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(200);

    const managerDisciplineEmails = new Set(
      userRows
        .filter((user) => user.discipline === currentUser.discipline)
        .map((user) => user.email),
    );
    const assignedProjectIds = new Set<number>();
    const managedProjectIds = new Set<number>();
    const memberEmailsByProject = new Map<number, string[]>();
    const managerEmailsByProject = new Map<number, string[]>();
    for (const membership of membershipRows) {
      const members = memberEmailsByProject.get(membership.projectId);
      if (members) members.push(membership.employeeEmail); else memberEmailsByProject.set(membership.projectId, [membership.employeeEmail]);
      if (membership.isProjectManager) {
        const managers = managerEmailsByProject.get(membership.projectId);
        if (managers) managers.push(membership.employeeEmail); else managerEmailsByProject.set(membership.projectId, [membership.employeeEmail]);
      }
      if (membership.employeeEmail === currentUser.email) {
        assignedProjectIds.add(membership.projectId);
        if (membership.isProjectManager) managedProjectIds.add(membership.projectId);
      }
    }
    const assignedProjectCodes = new Set(allProjectRows.filter((project) => assignedProjectIds.has(project.id)).map((project) => project.code));
    const managedProjectCodes = new Set(allProjectRows.filter((project) => managedProjectIds.has(project.id)).map((project) => project.code));
    const taskRows = currentUser.role === "owner"
      ? allTaskRows.filter((task) =>
        task.visibility === "team" ||
        task.submittedToManager ||
        task.createdBy === currentUser.email ||
        task.employeeEmail === currentUser.email,
      )
      : currentUser.role === "manager"
        ? allTaskRows.filter((task) =>
          (task.createdBy === currentUser.email || task.employeeEmail === currentUser.email || ((task.visibility === "team" || task.submittedToManager) && (managerDisciplineEmails.has(task.employeeEmail) || managedProjectCodes.has(task.project)))) &&
          (task.project === "PERSONAL" || assignedProjectCodes.has(task.project)),
        )
        : allTaskRows.filter((task) => task.employeeEmail === currentUser.email || (task.visibility === "private" && task.createdBy === currentUser.email) || ((task.visibility === "team" || task.submittedToManager) && managedProjectCodes.has(task.project)));
    const displayNameByEmail = new Map(userRows.map((user) => [user.email.toLowerCase(), user.displayName]));
    const disciplineByEmail = new Map(userRows.map((user) => [user.email.toLowerCase(), user.discipline]));
    const profileImageByEmail = new Map(userRows.map((user) => [user.email.toLowerCase(), user.profileImageKey]));
    const taskRowsWithCreator = taskRows.map((task) => ({
      ...task,
      createdByName: displayNameByEmail.get(task.createdBy.toLowerCase()) || "Unknown user",
      createdByProfileImageKey: profileImageByEmail.get(task.createdBy.toLowerCase()) || "",
      employeeDiscipline: disciplineByEmail.get(task.employeeEmail.toLowerCase()) || "",
    }));
    const visibleTaskIds = new Set(taskRows.map((task) => task.id));
    const visibleProjects = currentUser.role === "owner"
      ? allProjectRows
      : allProjectRows.filter((project) => assignedProjectIds.has(project.id));
    const projectRows = visibleProjects.map((project) => ({
      ...project,
      memberEmails: memberEmailsByProject.get(project.id) || [],
      projectManagerEmails: managerEmailsByProject.get(project.id) || [],
    }));
    const timeRows: (typeof taskTimeEntries.$inferSelect)[] = [];
    const linkedIssueRows: {
      id: number;
      issueNumber: string;
      projectCode: string;
      convertedTaskId: number | null;
      createdAt: string;
    }[] = [];

    const visibleTaskById = new Map(taskRows.map((task) => [task.id, task]));

    // Only currently running sessions and issue links are needed to render the
    // first screen. Closed session history and collaborative task details are
    // fetched on demand by /api/task-details.
    for (const taskIds of chunks(Array.from(visibleTaskIds), TASK_QUERY_CHUNK_SIZE)) {
      const chunkTimes = await db.select().from(taskTimeEntries)
        .where(and(inArray(taskTimeEntries.taskId, taskIds), isNull(taskTimeEntries.endedAt)));
      const chunkLinks = await db.select({
        id: projectIssues.id,
        issueNumber: projectIssues.issueNumber,
        projectCode: projectIssues.projectCode,
        convertedTaskId: projectIssues.convertedTaskId,
        createdAt: projectIssues.createdAt,
      }).from(projectIssues).where(inArray(projectIssues.convertedTaskId, taskIds));
      timeRows.push(...chunkTimes.map((entry) => ({
        ...entry,
        // The compact live row represents the task's complete saved duration;
        // taskLoggedHours then adds only the current running interval.
        durationSeconds: Math.max(entry.durationSeconds, Math.round((visibleTaskById.get(entry.taskId)?.actualHours || 0) * 3600)),
      })));
      linkedIssueRows.push(...chunkLinks);
    }

    const assignedProjectMemberEmails = new Set(
      membershipRows
        .filter((membership) => assignedProjectIds.has(membership.projectId))
        .map((membership) => membership.employeeEmail),
    );
    const managedProjectMemberEmails = new Set(
      membershipRows
        .filter((membership) => managedProjectIds.has(membership.projectId))
        .map((membership) => membership.employeeEmail),
    );
    const visibleUsers = currentUser.role === "owner"
      ? userRows
      : currentUser.role === "manager"
        ? userRows.filter((user) =>
          user.email === currentUser.email ||
          assignedProjectMemberEmails.has(user.email) ||
          (user.role === "member" && user.discipline === currentUser.discipline),
        )
        : userRows.filter((user) => user.email === currentUser.email || managedProjectMemberEmails.has(user.email));

    return Response.json({
      currentUser,
      tasks: taskRowsWithCreator,
      users: visibleUsers,
      projects: projectRows,
      timeEntriesMode: "active",
      timeEntries: timeRows,
      taskIssueLinks: linkedIssueRows,
      notifications: notificationRows,
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to load workspace", error);
    return Response.json(
      { error: "Unable to load the workspace right now. Please try again." },
      { status: 500 },
    );
  }
}
