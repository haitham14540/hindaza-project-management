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
  const [dashboard, bootstrapApi, databaseInit] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/bootstrap/route.ts"),
    source("lib/db-init.ts"),
  ]);
  assert.match(dashboard, /new AbortController\(\)/);
  assert.match(dashboard, /controller\.abort\(\)/);
  assert.match(dashboard, /if \(syncInFlightRef\.current\) return false/);
  assert.match(dashboard, /setTimeout\(\(\) => void loadWorkspace\(true, true\), 0\)/);
  assert.match(dashboard, /<ButtonLabel en="Retry" ar="إعادة المحاولة"/);
  assert.match(bootstrapApi, /no-store, no-cache, must-revalidate/);
  assert.doesNotMatch(bootstrapApi, /selectDistinct\(\{ code: tasks\.project \}\)/);
  assert.match(bootstrapApi, /const \[allTaskRows, userRows, allProjectRows, membershipRows\] = await Promise\.all/);
  assert.match(bootstrapApi, /const \[allCommentRows, allTimeRows, notificationRows\] = await Promise\.all/);
  assert.match(databaseInit, /if \(process\.env\.NODE_ENV === "production"\) return true/);
});

test("project issues use shared projects and users with attachments and linked task conversion", async () => {
  const [schema, issuesApi, attachmentsApi, convertApi, dashboard, issuesModule] = await Promise.all([
    source("db/schema.ts"),
    source("app/api/issues/route.ts"),
    source("app/api/issue-attachments/route.ts"),
    source("app/api/issues/convert/route.ts"),
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
  ]);
  assert.match(schema, /projectIssues = sqliteTable/);
  assert.match(schema, /issueAttachments = sqliteTable/);
  assert.match(schema, /clientReply: text\("client_reply"\)/);
  assert.match(schema, /source: text\("source", \{ enum: \["internal", "client"\] \}\)/);
  assert.match(issuesApi, /disciplineCodes/);
  assert.match(issuesApi, /padStart\(3, "0"\)/);
  assert.match(issuesApi, /row\.sequence - 1/);
  assert.match(attachmentsApi, /form\.getAll\("files"\)/);
  assert.match(attachmentsApi, /application\/octet-stream/);
  assert.doesNotMatch(attachmentsApi, /const ALLOWED/);
  assert.match(attachmentsApi, /getBucket/);
  assert.match(convertApi, /convertedTaskId/);
  assert.match(convertApi, /Source Issue:/);
  assert.match(convertApi, /Select an employee assigned to this project/);
  assert.match(dashboard, /<IssuesModule/);
  assert.match(issuesModule, /Modified to task/);
  assert.match(issuesModule, /<input type="file" multiple onChange=/);
});

test("project issue client responses, closure dates, and single-save behavior are preserved", async () => {
  const [issuesApi, attachmentsApi, issuesModule, dashboard, backupApi, migration] = await Promise.all([
    source("app/api/issues/route.ts"),
    source("app/api/issue-attachments/route.ts"),
    source("app/issues-module.tsx"),
    source("app/task-dashboard.tsx"),
    source("app/api/backup/route.ts"),
    source("drizzle/0012_oval_jubilee.sql"),
  ]);
  assert.match(migration, /issue_attachments` ADD `source`/);
  assert.match(migration, /project_issues` ADD `client_reply`/);
  assert.match(issuesApi, /clientReply: cleanText\(payload\.clientReply, 4_000\)/);
  assert.match(issuesApi, /cleanText\(payload\.resolvedDate, 10\)/);
  assert.match(attachmentsApi, /form\.get\("source"\) === "client"/);
  assert.match(attachmentsApi, /source,/);
  assert.match(issuesModule, /<th>Resolved Date<\/th>/);
  assert.match(issuesModule, /Client Response/);
  assert.match(issuesModule, /Client Reply/);
  assert.match(issuesModule, /client-attachment-indicator/);
  assert.match(issuesModule, /saveInFlightRef\.current/);
  assert.match(issuesModule, /current\.filter\(\(item\) => item\.id !== issue\.id\)/);
  assert.match(issuesModule, /setFiles\(\[\]\); setClientFiles\(\[\]\); setDrawerOpen\(false\)/);
  assert.match(dashboard, /Task Details & Update/);
  assert.match(backupApi, /const SCHEMA_VERSION = 6/);
  assert.match(backupApi, /item\.source === undefined \? "internal"/);
});

test("reports allow task, project issue, and future RFI selection", async () => {
  const [dashboard, issuesModule] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
  ]);
  assert.match(dashboard, /reportType/);
  assert.match(dashboard, /Task Report/);
  assert.match(dashboard, /Project Issues/);
  assert.match(dashboard, /Requests for Information|RFI/);
  assert.match(issuesModule, /IssueReportPanel/);
  assert.match(issuesModule, /Attachments/);
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
  assert.match(dashboard, /className="filter-clear-icon" aria-hidden="true"/);
  assert.doesNotMatch(dashboard, /<ButtonLabel en="Clear filters"/);
  assert.match(dashboard, /setReviewFilter\("all"\)/);
  assert.match(dashboard, /task-table task-data-table/);
  assert.match(styles, /\.task-data-table th \{[^}]*font-size: 11px/);
  assert.match(styles, /\.clear-filters-button \{[^}]*width: 38px;[^}]*height: 38px/);
  assert.match(styles, /\.clear-filters-button \{[^}]*background: #171717;[^}]*color: var\(--yellow\)/);
  assert.match(styles, /\.filter-clear-icon \{[^}]*clip-path:/);
  assert.match(styles, /\.clear-filters-button::before, \.clear-filters-button::after/);
  assert.match(styles, /\.filters input, \.filters select \{[^}]*height: 38px/);
});

test("team and project filters support safe project-member removal", async () => {
  const [dashboard, projectsApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/projects/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /teamDisciplineFilter/);
  assert.match(dashboard, /teamRoleFilter/);
  assert.match(dashboard, /projectStatusFilter/);
  assert.match(dashboard, /Employee cannot be removed yet/);
  assert.match(dashboard, /onResolveMemberTasks/);
  assert.match(dashboard, /setEmployeeFilter\(user\.displayName\)/);
  assert.match(dashboard, /setProjectFilter\(projectCode\)/);
  assert.match(projectsApi, /MEMBER_HAS_PROJECT_TASKS/);
  assert.match(projectsApi, /Reassign the tasks first/);
  assert.match(styles, /\.member-removal-warning/);
  assert.match(styles, /\.directory-filters/);
});

test("task management uses an English left-to-right table and actions", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /task-table-ltr/);
  assert.match(dashboard, /<th>Task \/ Project<\/th>/);
  assert.match(dashboard, /<th>Created Date<\/th><th>Due Date<\/th>/);
  assert.match(dashboard, /<ButtonLabel en="Delete Task" ar="حذف المهمة"/);
  assert.match(dashboard, /en=\{saving \? "Saving\.\.\." : selectedId \? "Save Changes" : "Create Task"\}/);
  assert.match(styles, /\.task-table-ltr \{[^}]*direction: ltr/);
});

test("project issues use persistent categories and discipline-specific raised-by users", async () => {
  const [schema, issuesApi, issuesModule, dashboard, migration] = await Promise.all([
    source("db/schema.ts"),
    source("app/api/issues/route.ts"),
    source("app/issues-module.tsx"),
    source("app/task-dashboard.tsx"),
    source("drizzle/0010_legal_iceman.sql"),
  ]);
  assert.match(schema, /issueCategories = sqliteTable/);
  assert.match(migration, /CREATE TABLE `issue_categories`/);
  assert.match(issuesApi, /const disciplines = \["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"\]/);
  assert.match(issuesApi, /validRaisedBy/);
  assert.match(issuesApi, /rememberCategory/);
  assert.match(issuesApi, /return Response\.json\(\{ issues, categories \}\)/);
  assert.match(issuesModule, /Architecture \(ARC\)/);
  assert.match(issuesModule, /Interior Design \(ID\)/);
  assert.match(issuesModule, /raisedByOptions/);
  assert.match(issuesModule, /Raised by · بواسطة/);
  assert.match(issuesModule, /disabled=\{currentUser\.role === "member" \|\| issueClosed\}/);
  assert.match(issuesModule, /Add Category/);
  assert.match(issuesModule, /normalizedDiscipline\(issue\.discipline\)/);
  assert.doesNotMatch(issuesModule, /select required disabled=\{Boolean\(selected\)\}/);
  assert.match(dashboard, /issuesModuleRef\.current\?\.openNew\(\)/);
});

test("issue notifications, shared notes, owner activity, and centered toasts are wired", async () => {
  const [schema, issuesApi, dashboard, issuesModule, activityApi, styles, migration] = await Promise.all([
    source("db/schema.ts"),
    source("app/api/issues/route.ts"),
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/activity-log/route.ts"),
    source("app/globals.css"),
    source("drizzle/0011_brave_radioactive_man.sql"),
  ]);
  assert.match(schema, /issue_created/);
  assert.match(schema, /activityLogs = sqliteTable/);
  assert.match(issuesApi, /notifyDisciplineManagers/);
  assert.match(issuesApi, /asc\(projectIssues\.projectCode\).*asc\(projectIssues\.discipline\).*asc\(projectIssues\.sequence\)/s);
  assert.match(issuesApi, /Managers can delete issues only in their discipline/);
  assert.match(dashboard, /notification\?\.issueId/);
  assert.match(dashboard, /Activity log/);
  assert.match(dashboard, /commentCounts\.get\(task\.id\)/);
  assert.match(issuesModule, /Notes available/);
  assert.match(issuesModule, /issue\.attachments\.length/);
  assert.match(activityApi, /Owner access required/);
  assert.match(styles, /\.toast \{[^}]*left: 50%/);
  assert.match(styles, /transform: translateX\(-50%\)/);
  assert.match(migration, /CREATE TABLE `activity_logs`/);
  assert.match(migration, /ALTER TABLE `notifications` ADD `issue_id`/);
});

test("the application shell and filters use a left-to-right layout", async () => {
  const [layout, dashboard, issuesModule, styles] = await Promise.all([
    source("app/layout.tsx"),
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(layout, /<html lang="en" dir="ltr">/);
  assert.match(styles, /\.sidebar \{[\s\S]*?inset: 0 auto 0 0;/);
  assert.match(styles, /\.main-content \{ margin-left: 248px;/);
  assert.match(styles, /\.main-content \{ margin-left: 0; padding: 21px 14px 93px;/);
  assert.match(styles, /\.drawer-layer \{[^}]*justify-content: flex-end;/);
  assert.match(styles, /\.drawer-actions \.primary-button \{ margin-left: auto; \}/);
  assert.match(styles, /\.issue-filters \{[^}]*direction: ltr;/);
  assert.match(dashboard, /className="filters"/);
  assert.match(issuesModule, /Clear all project issue filters/);
  assert.match(issuesModule, /setPriorityFilter\("all"\)/);
});

test("navigation and action buttons prioritize English with smaller Arabic labels", async () => {
  const [dashboard, issuesModule, login, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/login/page.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /<strong>\{item\.en\}<\/strong><small dir="rtl">\{item\.ar\}<\/small>/);
  assert.match(dashboard, /<ButtonLabel en="New Task" ar="مهمة جديدة"/);
  assert.match(dashboard, /<ButtonLabel en="New Project" ar="مشروع جديد"/);
  assert.match(dashboard, /<ButtonLabel en="Add Employee" ar="إضافة موظف"/);
  assert.match(dashboard, /<ButtonLabel en="Logout" ar="تسجيل الخروج"/);
  assert.match(dashboard, /<ButtonLabel en="Read all" ar="قراءة الكل"/);
  assert.match(issuesModule, /<ButtonLabel en="Create Issue"|"Create Issue"/);
  assert.match(login, /setup \? "Create owner account"/);
  assert.match(login, /setup \? "إنشاء حساب المالك"/);
  assert.match(styles, /\.button-label \{[^}]*display: grid/);
  assert.match(styles, /\.button-label small \{[^}]*font-size: \.78em/);
  assert.match(styles, /\.topbar \.primary-button \{[^}]*height: 43px;[^}]*border-radius: 12px/);
  assert.match(styles, /\.notification-bell \{[^}]*width: 43px; height: 43px/);
  assert.match(styles, /\.notification-popover \{[^}]*right: 6px;[^}]*left: auto;[^}]*width: min\(320px/);
  assert.match(styles, /\.issue-filters input, \.issue-filters select \{[^}]*height: 38px/);
});

test("record drawer actions are compact, icon-led, and shown above form fields", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /\.task-drawer > \.task-form:not\(\.password-form\) \{[^}]*display: flex;[^}]*flex-direction: column;/);
  assert.match(styles, /> \.drawer-actions \{[^}]*position: sticky;[^}]*top: 0;[^}]*z-index: 3;[^}]*order: -1;/);
  assert.match(styles, /> \.drawer-actions button \{[^}]*min-height: 34px;/);
  assert.match(styles, /\.primary-button::before \{ content: "✓"/);
  assert.match(styles, /\.secondary-button::before \{ content: "×"/);
  assert.match(styles, /\.delete-button::before \{ content: "⌫"/);
});

test("employee deletion links to project-filtered tasks and issue metadata is compact", async () => {
  const [usersApi, dashboard, issuesModule, styles] = await Promise.all([
    source("app/api/users/route.ts"),
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(usersApi, /EMPLOYEE_HAS_ASSIGNED_TASKS/);
  assert.match(usersApi, /groupBy\(tasks\.project\)/);
  assert.match(dashboard, /reviewEmployeeTasks/);
  assert.match(dashboard, /setEmployeeFilter\(employeeName\)/);
  assert.match(dashboard, /setProjectFilter\(projectCode\)/);
  assert.match(dashboard, /dependency-project-links/);
  assert.match(issuesModule, /issue-number-cell/);
  assert.match(issuesModule, /issue-record-meta/);
  assert.match(issuesModule, /issue\.attachments\.length/);
  assert.doesNotMatch(issuesModule, /<th>Attachments<\/th><th>Notes<\/th>/);
  assert.match(styles, /\.issue-record-meta/);
  assert.match(styles, /\.dependency-warning-dialog/);
});

test("issue workflow uses project members and automatic close and reopen behavior", async () => {
  const [issuesApi, convertApi, issuesModule, styles] = await Promise.all([
    source("app/api/issues/route.ts"),
    source("app/api/issues/convert/route.ts"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(issuesApi, /innerJoin\(projectMembers/);
  assert.match(issuesApi, /eq\(projects\.code, projectCode\)/);
  assert.match(issuesApi, /const coreLocked = existing\.status === "closed" && status !== "re_open"/);
  assert.match(issuesApi, /resolvedDate: status === "closed"/);
  assert.match(issuesApi, /operationalDate\(\)/);
  assert.match(convertApi, /eq\(projects\.code, issue\.projectCode\)/);
  assert.match(convertApi, /employee\.discipline !== issue\.discipline/);
  assert.match(issuesModule, /selectedProject\?\.memberEmails\.includes\(user\.email\)/);
  assert.match(issuesModule, /conversionProject\?\.memberEmails\.includes\(user\.email\)/);
  assert.match(issuesModule, /user\.discipline === selected\?\.discipline/);
  assert.match(issuesModule, /Issue Attachments/);
  assert.ok(issuesModule.indexOf("Issue Attachments") < issuesModule.indexOf("Client Response"));
  assert.match(issuesModule, /function changeStatus/);
  assert.match(issuesModule, /resolvedDate: status === "closed" \? today\(\) : ""/);
  assert.match(issuesModule, /disabled=\{issueClosed\}/);
  assert.match(issuesModule, /statusOptions\.map/);
  assert.match(issuesModule, /setForm\(\{ projectCode: issue\.projectCode/);
  assert.match(styles, /\.task-drawer \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow: hidden;/);
  assert.match(styles, /\.drawer-head \{[^}]*position: relative;/);
  assert.match(styles, /\.task-form \{[^}]*overflow-y: auto;/);
  assert.match(styles, /\.client-response-section \{[^}]*background: #eef6ff/);
  assert.match(styles, /\.client-response-section \{[^}]*margin: 0;[^}]*padding: 23px 0;/);
  assert.match(styles, /\.client-response-section \{[^}]*box-shadow: 25px 0 0 #eef6ff/);
  assert.match(styles, /\.issue-details-section \{[^}]*border-bottom: 0/);
  assert.match(styles, /\.issue-attachments-section \{[^}]*border-bottom: 1px solid/);
  assert.match(styles, /\.issue-convert \{[^}]*background: #f7f2ff/);
  assert.match(styles, /\.issue-convert \{[^}]*margin: 0;[^}]*padding: 23px 0;/);
});
