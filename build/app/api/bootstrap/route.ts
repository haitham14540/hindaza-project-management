import { asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectIssues, projectMembers, projects, taskAttachments, taskComments, taskSubtasks, taskTimeEntries, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
    const [{ total }] = await db.select({ total: count() }).from(tasks);

    if (process.env.NODE_ENV !== "production" && total === 0 && isManagement(currentUser)) {
      await db.insert(tasks).values(sampleTasks(currentUser.email));
    }

    // Keep bootstrap read-only and stay below the Worker's concurrent
    // subrequest limit. Writing projects during every refresh caused D1
    // requests to queue until the browser aborted them.
    const [allTaskRows, userRows, allProjectRows, membershipRows] = await Promise.all([
      db
        .select()
        .from(tasks)
        .orderBy(desc(tasks.createdAt), desc(tasks.id)),
      db.select({
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        discipline: users.discipline,
        profileImageKey: users.profileImageKey,
      }).from(users).where(eq(users.active, true)).orderBy(asc(users.displayName)),
      db.select().from(projects).orderBy(asc(projects.code)),
      db.select().from(projectMembers),
    ]);
    const [allCommentRows, allTimeRows, allSubtaskRows, allTaskAttachmentRows, notificationRows] = await Promise.all([
      db.select().from(taskComments).orderBy(asc(taskComments.createdAt), asc(taskComments.id)),
      db.select().from(taskTimeEntries).orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id)),
      db.select().from(taskSubtasks).orderBy(asc(taskSubtasks.createdAt), asc(taskSubtasks.id)),
      db.select().from(taskAttachments).orderBy(asc(taskAttachments.createdAt), asc(taskAttachments.id)),
      db.select().from(notifications).where(eq(notifications.recipientEmail, currentUser.email)).orderBy(desc(notifications.createdAt), desc(notifications.id)),
    ]);

    const managerDisciplineEmails = new Set(
      userRows
        .filter((user) => user.discipline === currentUser.discipline)
        .map((user) => user.email),
    );
    const assignedProjectIds = new Set(
      membershipRows
        .filter((membership) => membership.employeeEmail === currentUser.email)
        .map((membership) => membership.projectId),
    );
    const managedProjectIds = new Set(
      membershipRows
        .filter((membership) => membership.employeeEmail === currentUser.email && membership.isProjectManager)
        .map((membership) => membership.projectId),
    );
    const assignedProjectCodes = new Set(allProjectRows.filter((project) => assignedProjectIds.has(project.id)).map((project) => project.code));
    const managedProjectCodes = new Set(allProjectRows.filter((project) => managedProjectIds.has(project.id)).map((project) => project.code));
    const taskRows = currentUser.role === "owner"
      ? allTaskRows.filter((task) => task.visibility === "team" || task.submittedToManager)
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
    const taskProjectCodes = new Set(taskRows.map((task) => task.project));
    const visibleProjects = currentUser.role === "owner"
      ? allProjectRows
      : allProjectRows.filter((project) => assignedProjectIds.has(project.id) || taskProjectCodes.has(project.code));
    const projectRows = visibleProjects.map((project) => ({
      ...project,
      memberEmails: membershipRows
        .filter((membership) => membership.projectId === project.id)
        .map((membership) => membership.employeeEmail),
      projectManagerEmails: membershipRows
        .filter((membership) => membership.projectId === project.id && membership.isProjectManager)
        .map((membership) => membership.employeeEmail),
    }));
    const commentRows = allCommentRows.filter((comment) => visibleTaskIds.has(comment.taskId));
    const timeRows = allTimeRows.filter((entry) => visibleTaskIds.has(entry.taskId));
    const subtaskRows = allSubtaskRows.filter((subtask) => visibleTaskIds.has(subtask.taskId));
    const taskAttachmentRows = allTaskAttachmentRows.filter((attachment) => visibleTaskIds.has(attachment.taskId));
    // Keep the task-to-issue relationship sourced from project_issues so the
    // displayed issue number always follows issue renumbering automatically.
    const linkedIssueRows = (await db.select({
      id: projectIssues.id,
      issueNumber: projectIssues.issueNumber,
      projectCode: projectIssues.projectCode,
      convertedTaskId: projectIssues.convertedTaskId,
      createdAt: projectIssues.createdAt,
    }).from(projectIssues)).filter((issue) => issue.convertedTaskId && visibleTaskIds.has(issue.convertedTaskId));

    const visibleUsers = currentUser.role === "owner"
      ? userRows
      : currentUser.role === "manager"
        ? userRows.filter((user) => user.discipline === currentUser.discipline && (user.role === "member" || user.role === "manager"))
        : userRows;

    return Response.json({
      currentUser,
      tasks: taskRowsWithCreator,
      users: visibleUsers,
      projects: projectRows,
      comments: commentRows,
      timeEntries: timeRows,
      subtasks: subtaskRows,
      taskAttachments: taskAttachmentRows,
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
