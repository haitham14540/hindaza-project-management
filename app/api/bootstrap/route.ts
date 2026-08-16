import { asc, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectIssues, projectMembers, projects, taskTimeEntries, tasks, users } from "@/db/schema";
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
    if (process.env.NODE_ENV !== "production" && isManagement(currentUser)) {
      const [{ total }] = await db.select({ total: count() }).from(tasks);
      if (total === 0) await db.insert(tasks).values(sampleTasks(currentUser.email));
    }

    // Render the application shell from a deliberately small first request.
    // The complete task history is loaded immediately afterwards in the
    // background, so a large owner workspace can never hold the entire UI
    // behind one long-running D1 response.
    const loadMode = new URL(request.url).searchParams.get("mode");
    if (loadMode === "core") {
      const [userRows, allProjectRows, membershipRows, notificationRows] = await db.batch([
        db.select({
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          discipline: users.discipline,
          profileImageKey: users.profileImageKey,
        }).from(users).where(eq(users.active, true)).orderBy(asc(users.displayName)),
        db.select().from(projects).orderBy(asc(projects.code)),
        db.select().from(projectMembers),
        db.select().from(notifications)
          .where(eq(notifications.recipientEmail, currentUser.email))
          .orderBy(desc(notifications.createdAt), desc(notifications.id))
          .limit(200),
      ]);
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
      const visibleProjects = currentUser.role === "owner"
        ? allProjectRows
        : allProjectRows.filter((project) => assignedProjectIds.has(project.id));
      const projectRows = visibleProjects.map((project) => ({
        ...project,
        memberEmails: memberEmailsByProject.get(project.id) || [],
        projectManagerEmails: managerEmailsByProject.get(project.id) || [],
      }));
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
        loadMode: "core",
        currentUser,
        tasks: [],
        users: visibleUsers,
        projects: projectRows,
        timeEntriesMode: "active",
        timeEntries: [],
        taskIssueLinks: [],
        teamMetrics: [],
        notifications: notificationRows,
      }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
    }

    // Keep the first application request intentionally small. Historical task
    // notes, sessions, subtasks and attachments are loaded only for the task a
    // user opens; returning every historical row here made D1 bootstrap calls
    // exceed the Worker request window as the project grew.
    const [userRows, allProjectRows, membershipRows, allTaskRows, allActiveTimeRows, notificationRows, allLinkedIssueRows] = await db.batch([
      db.select({
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        discipline: users.discipline,
        profileImageKey: users.profileImageKey,
      }).from(users).where(eq(users.active, true)).orderBy(asc(users.displayName)),
      db.select().from(projects).orderBy(asc(projects.code)),
      db.select().from(projectMembers),
      db.select().from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id)),
      db.select().from(taskTimeEntries).where(isNull(taskTimeEntries.endedAt)),
      db.select().from(notifications)
        .where(eq(notifications.recipientEmail, currentUser.email))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(200),
      db.select({
        id: projectIssues.id,
        issueNumber: projectIssues.issueNumber,
        projectCode: projectIssues.projectCode,
        convertedTaskId: projectIssues.convertedTaskId,
        createdAt: projectIssues.createdAt,
      }).from(projectIssues).where(isNotNull(projectIssues.convertedTaskId)),
    ]);
    const activeTaskIds = new Set(allActiveTimeRows.map((entry) => entry.taskId));

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
    const visibleTaskIds = new Set(taskRows.map((task) => task.id));
    const displayNameByEmail = new Map(userRows.map((user) => [user.email.toLowerCase(), user.displayName]));
    const disciplineByEmail = new Map(userRows.map((user) => [user.email.toLowerCase(), user.discipline]));
    const profileImageByEmail = new Map(userRows.map((user) => [user.email.toLowerCase(), user.profileImageKey]));
    const taskRowsWithCreator = taskRows.map((task) => ({
      ...task,
      // Detail counters are intentionally deferred to /api/task-counts. They
      // must never hold the initial workspace render behind historical tables.
      commentCount: 0,
      subtaskCount: 0,
      completedSubtaskCount: 0,
      attachmentCount: 0,
      createdByName: displayNameByEmail.get(task.createdBy.toLowerCase()) || "Unknown user",
      createdByProfileImageKey: profileImageByEmail.get(task.createdBy.toLowerCase()) || "",
      employeeDiscipline: disciplineByEmail.get(task.employeeEmail.toLowerCase()) || "",
    }));
    const teamMetricByEmail = new Map<string, { total: number; done: number; attention: number; planned: number; actual: number; activeProject: string; activeTaskId: number | null; activeUpdatedAt: string }>();
    if (isManagement(currentUser)) {
      for (const task of allTaskRows) {
        const key = task.employeeEmail.toLowerCase();
        if (!key) continue;
        const metric = teamMetricByEmail.get(key) || { total: 0, done: 0, attention: 0, planned: 0, actual: 0, activeProject: "", activeTaskId: null, activeUpdatedAt: "" };
        metric.total += 1;
        if (task.status === "done") metric.done += 1;
        if (!(task.status === "done" && task.managerCheck === "approved")) metric.attention += 1;
        metric.planned += task.plannedHours;
        metric.actual += task.actualHours;
        if (task.visibility !== "private" && activeTaskIds.has(task.id) && task.updatedAt >= metric.activeUpdatedAt) {
          metric.activeProject = task.project;
          metric.activeTaskId = task.id;
          metric.activeUpdatedAt = task.updatedAt;
        }
        teamMetricByEmail.set(key, metric);
      }
    }
    const teamMetrics = isManagement(currentUser) ? userRows.map((user) => {
      const metric = teamMetricByEmail.get(user.email.toLowerCase());
      return {
        email: user.email,
        total: metric?.total || 0,
        done: metric?.done || 0,
        attention: metric?.attention || 0,
        planned: metric?.planned || 0,
        actual: metric?.actual || 0,
        activeProject: metric?.activeProject || "",
        activeTaskId: metric?.activeTaskId || null,
      };
    }) : [];
    const visibleProjects = currentUser.role === "owner"
      ? allProjectRows
      : allProjectRows.filter((project) => assignedProjectIds.has(project.id));
    const projectRows = visibleProjects.map((project) => ({
      ...project,
      memberEmails: memberEmailsByProject.get(project.id) || [],
      projectManagerEmails: managerEmailsByProject.get(project.id) || [],
    }));
    const visibleTaskById = new Map(taskRows.map((task) => [task.id, task]));
    // Only currently running sessions and issue links are needed to render the
    // first screen. Both were fetched in the single D1 batch above so task
    // volume cannot multiply the number of startup round trips.
    const timeRows = allActiveTimeRows
      .filter((entry) => visibleTaskIds.has(entry.taskId))
      .map((entry) => ({
        ...entry,
        // The compact live row represents the task's complete saved duration;
        // taskLoggedHours then adds only the current running interval.
        durationSeconds: Math.max(entry.durationSeconds, Math.round((visibleTaskById.get(entry.taskId)?.actualHours || 0) * 3600)),
      }));
    const linkedIssueRows = allLinkedIssueRows.filter((issue) => issue.convertedTaskId && visibleTaskIds.has(issue.convertedTaskId));

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
      loadMode: "full",
      currentUser,
      tasks: taskRowsWithCreator,
      users: visibleUsers,
      projects: projectRows,
      timeEntriesMode: "active",
      timeEntries: timeRows,
      taskIssueLinks: linkedIssueRows,
      teamMetrics,
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
