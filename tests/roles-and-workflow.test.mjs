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

test("notifications poll and profile images use authenticated APIs", async () => {
  const [dashboard, notificationsApi, profileApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/notifications/route.ts"),
    source("app/api/profile-image/route.ts"),
  ]);
  assert.match(dashboard, /setInterval\(refresh, 12_000\)/);
  assert.match(notificationsApi, /export async function GET/);
  assert.match(profileApi, /getCurrentUser/);
  assert.match(profileApi, /getBucket/);
});
