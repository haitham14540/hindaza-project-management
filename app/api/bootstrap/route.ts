import { asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";

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

    if (process.env.NODE_ENV !== "production" && total === 0 && currentUser.role === "manager") {
      await db.insert(tasks).values(sampleTasks(currentUser.email));
    }

    const taskProjects = await db
      .selectDistinct({ code: tasks.project })
      .from(tasks);
    for (const item of taskProjects) {
      if (!item.code) continue;
      await db
        .insert(projects)
        .values({ code: item.code, name: item.code })
        .onConflictDoNothing({ target: projects.code });
    }

    const [taskRows, userRows, projectRows] = await Promise.all([
      db
        .select()
        .from(tasks)
        .orderBy(desc(tasks.taskDate), desc(tasks.updatedAt), desc(tasks.id)),
      db.select({
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        discipline: users.discipline,
      }).from(users).where(eq(users.active, true)).orderBy(asc(users.displayName)),
      db.select().from(projects).orderBy(asc(projects.code)),
    ]);

    return Response.json({
      currentUser,
      tasks: taskRows,
      users: userRows,
      projects: projectRows,
    });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load tasks" },
      { status: 500 },
    );
  }
}
