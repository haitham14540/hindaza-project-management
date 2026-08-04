import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("owner permissions and account tools are enforced", async () => {
  const [usersApi, backupApi, dashboard] = await Promise.all([
    source("app/api/users/route.ts"),
    source("app/api/backup/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(usersApi, /Only an owner can add another owner/);
  assert.match(backupApi, /currentUser\.role !== "owner"/);
  assert.match(dashboard, /currentUser\?\.role === "owner"/);
  assert.doesNotMatch(dashboard, /tab === "notifications"/);
});

test("backup restore stays within D1 limits and preserves owner access", async () => {
  const [backupApi, dashboard] = await Promise.all([
    source("app/api/backup/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(backupApi, /MAX_D1_BOUND_PARAMETERS = 100/);
  assert.match(backupApi, /await d1\.batch\(statements\)/);
  assert.match(backupApi, /passwordHash: ownerRecord\.passwordHash/);
  assert.match(backupApi, /const sessionCookie = await createSession/);
  assert.match(dashboard, /الحفاظ على حساب المالك الحالي وكلمة مروره/);
  assert.match(dashboard, /window\.location\.reload\(\)/);
});

test("task assignment is constrained to project members", async () => {
  const [tasksApi, dashboard] = await Promise.all([
    source("app/api/tasks/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(tasksApi, /isProjectMember/);
  assert.match(tasksApi, /Select an employee assigned to this project/);
  assert.match(dashboard, /selectedProject\?\.memberEmails\.includes/);
  assert.match(dashboard, /showEmployeeFilter=\{currentUser\?\.role !== "member"\}/);
  assert.match(dashboard, /reviewFilter=\{reviewFilter\}/);
});

test("manager scope follows discipline while owner keeps full access", async () => {
  const [usersApi, tasksApi, bootstrapApi, projectsApi, dashboard] = await Promise.all([
    source("app/api/users/route.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/bootstrap/route.ts"),
    source("app/api/projects/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(usersApi, /Managers can add team members only within their own discipline/);
  assert.match(tasksApi, /assignableEmployee/);
  assert.match(tasksApi, /managedEmployee/);
  assert.match(bootstrapApi, /managerDisciplineEmails/);
  assert.match(projectsApi, /Owner access required/);
  assert.match(dashboard, /managerLimited/);
});

test("editing a legacy project removes stale members without blocking the update", async () => {
  const [projectsApi, dashboard] = await Promise.all([
    source("app/api/projects/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(projectsApi, /eq\(users\.active, true\)/);
  assert.match(projectsApi, /const removedInvalidMembers = requestedMembers\.length - assignedMembers\.length/);
  assert.match(projectsApi, /removedInvalidMembers,/);
  assert.match(dashboard, /data\.removedInvalidMembers > 0/);
  assert.match(dashboard, /عضو قديم أو غير صالح/);
});

test("task created date, due date label, and creation-time ordering are used", async () => {
  const [dashboard, bootstrapApi, schema] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/bootstrap/route.ts"),
    source("db/schema.ts"),
  ]);
  assert.match(dashboard, /تاريخ الإنشاء/);
  assert.match(dashboard, /Created Date/);
  assert.match(dashboard, /تاريخ الإنجاز المتوقع · Due Date/);
  assert.match(dashboard, /function formatDueDate/);
  assert.match(dashboard, /function formatCreatedDate/);
  assert.match(dashboard, /"JAN", "FEB", "MAR"/);
  assert.match(dashboard, /className="due-date" dir="ltr"/);
  assert.match(dashboard, /disabled value=\{selectedId \? formatCreatedDate/);
  assert.match(dashboard, /b\.createdAt\.localeCompare\(a\.createdAt\)/);
  assert.match(bootstrapApi, /orderBy\(desc\(tasks\.createdAt\), desc\(tasks\.id\)\)/);
  assert.match(schema, /createdAt: text\("created_at"\)\.notNull\(\)\.default\(sql`CURRENT_TIMESTAMP`\)/);
  assert.doesNotMatch(dashboard, /b\.taskDate\.localeCompare\(a\.taskDate\)/);
});

test("workspace data syncs automatically, notifications open fresh tasks, and tabs persist", async () => {
  const [dashboard, notificationsApi, profileApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/notifications/route.ts"),
    source("app/api/profile-image/route.ts"),
  ]);
  assert.match(dashboard, /setInterval\(refresh, 3_000\)/);
  assert.match(dashboard, /fetchWorkspaceData/);
  assert.match(dashboard, /applyWorkspaceData\(data, initialize\)/);
  assert.match(dashboard, /freshData\?\.tasks\.find/);
  assert.match(dashboard, /setTab\(savedTab\(\)\)/);
  assert.match(dashboard, /localStorage\.setItem\(activeTabStorageKey, tab\)/);
  assert.match(notificationsApi, /export async function GET/);
  assert.match(profileApi, /getCurrentUser/);
  assert.match(profileApi, /getBucket/);
});

test("workspace loading times out safely, prevents overlap, and can be retried", async () => {
  const [dashboard, bootstrapApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/bootstrap/route.ts"),
  ]);
  assert.match(dashboard, /new AbortController\(\)/);
  assert.match(dashboard, /controller\.abort\(\)/);
  assert.match(dashboard, /if \(syncInFlightRef\.current\) return false/);
  assert.match(dashboard, /setTimeout\(\(\) => void loadWorkspace\(true, true\), 0\)/);
  assert.match(dashboard, /إعادة المحاولة · Retry/);
  assert.match(bootstrapApi, /no-store, no-cache, must-revalidate/);
});

test("typography is enlarged and task titles are emphasized", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /\.nav-list button > span:last-child \{[^}]*font-size: 14px/);
  assert.match(styles, /\.panel-heading h2 \{[^}]*font-size: 18px/);
  assert.match(styles, /\.task-table td \{[^}]*font-size: 10px/);
  assert.match(styles, /\.task-cell strong \{[^}]*font-size: 14px/);
  assert.match(styles, /\.mobile-task > strong \{[^}]*font-size: 15px/);
});

test("task table count, clear filters, and header emphasis follow the review notes", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /filteredCount === 1 \? "Task" : "Tasks"/);
  assert.match(dashboard, /className="clear-filters-button"/);
  assert.match(dashboard, /setReviewFilter\("all"\)/);
  assert.match(dashboard, /task-table task-data-table/);
  assert.match(styles, /\.task-data-table th \{[^}]*font-size: 11px/);
});
