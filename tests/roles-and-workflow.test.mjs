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
  assert.match(tasksApi, /canManageTask/);
  assert.match(bootstrapApi, /managerDisciplineEmails/);
  assert.match(projectsApi, /Owner access required/);
  assert.match(dashboard, /managerLimited/);
});

test("task creation date stays automatic and table-only while due dates remain editable", async () => {
  const [dashboard, bootstrapApi, schema] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/bootstrap/route.ts"),
    source("db/schema.ts"),
  ]);
  assert.match(dashboard, /<th>Created Date<\/th>/);
  assert.doesNotMatch(dashboard, /Created Date · تاريخ الإنشاء/);
  assert.match(dashboard, /Due Date · تاريخ الإنجاز المتوقع/);
  assert.match(dashboard, /function formatDueDate/);
  assert.match(dashboard, /function formatCreatedDate/);
  assert.match(dashboard, /"JAN", "FEB", "MAR"/);
  assert.match(dashboard, /className="due-date" dir="ltr"/);
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
  assert.match(dashboard, /setInterval\(refresh, 60_000\)/);
  assert.match(dashboard, /Date\.now\(\) - lastWorkspaceSyncAtRef\.current < 20_000/);
  assert.match(dashboard, /fetchWorkspaceData/);
  assert.match(dashboard, /applyWorkspaceData\(data, initialize\)/);
  assert.match(dashboard, /freshData\?\.tasks\.find/);
  assert.match(dashboard, /const initialTab = tabFromLocation\(\)/);
  assert.match(dashboard, /window\.history\.pushState/);
  assert.match(dashboard, /window\.addEventListener\("popstate", onPopState\)/);
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
  assert.doesNotMatch(bootstrapApi, /const \[allTaskRows, userRows, allProjectRows, membershipRows\] = await Promise\.all/);
  assert.doesNotMatch(bootstrapApi, /const \[allCommentRows, allTimeRows, allSubtaskRows, allTaskAttachmentRows, notificationRows\] = await Promise\.all/);
  assert.match(databaseInit, /if \(process\.env\.NODE_ENV === "production"\) return true/);
  assert.match(databaseInit, /PRAGMA table_info\(tasks\)/);
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
  assert.match(issuesModule, /Converted to Task/);
  assert.match(issuesModule, /<input type="file" multiple onChange=/);
});

test("project issue client response notes, closure dates, and single-save behavior are preserved", async () => {
  const [issuesApi, issueCommentsApi, attachmentsApi, issuesModule, dashboard, backupApi, migration, notesMigration, repairMigration, storageRepair] = await Promise.all([
    source("app/api/issues/route.ts"),
    source("app/api/issue-comments/route.ts"),
    source("app/api/issue-attachments/route.ts"),
    source("app/issues-module.tsx"),
    source("app/task-dashboard.tsx"),
    source("app/api/backup/route.ts"),
    source("drizzle/0012_oval_jubilee.sql"),
    source("drizzle/0015_short_pestilence.sql"),
    source("drizzle/0016_repair_issue_comments.sql"),
    source("lib/issue-comments-storage.ts"),
  ]);
  assert.match(migration, /issue_attachments` ADD `source`/);
  assert.match(migration, /project_issues` ADD `client_reply`/);
  assert.match(issuesApi, /db\.select\(\)\.from\(issueComments\)/);
  assert.match(issueCommentsApi, /section === "client"/);
  assert.match(issueCommentsApi, /COMMENT_EDIT_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(issueCommentsApi, /Only the owner can delete issue notes/);
  assert.match(notesMigration, /CREATE TABLE IF NOT EXISTS `issue_comments`/);
  assert.match(notesMigration, /INSERT INTO `issue_comments`/);
  assert.match(repairMigration, /CREATE TABLE IF NOT EXISTS `issue_comments`/);
  assert.match(repairMigration, /NOT EXISTS/);
  assert.match(storageRepair, /SELECT name FROM sqlite_master/);
  assert.match(storageRepair, /d1\.batch/);
  assert.match(issuesApi, /ensureIssueCommentsStorage/);
  assert.match(issueCommentsApi, /ensureIssueCommentsStorage/);
  assert.match(issuesApi, /cleanText\(payload\.resolvedDate, 10\)/);
  assert.match(attachmentsApi, /form\.get\("source"\) === "client"/);
  assert.match(attachmentsApi, /source,/);
  assert.match(issuesModule, /<th>Resolved Date<\/th>/);
  assert.match(issuesModule, /Client Response/);
  assert.match(issuesModule, /Client Response Notes/);
  assert.match(issuesModule, /client-attachment-indicator/);
  assert.match(issuesModule, /saveInFlightRef\.current/);
  assert.match(issuesModule, /current\.filter\(\(item\) => item\.id !== issue\.id\)/);
  assert.match(issuesModule, /setFiles\(\[\]\); setClientFiles\(\[\]\);/);
  assert.match(issuesModule, /if \(!selectedId\) setDrawerOpen\(false\)/);
  assert.match(dashboard, /Task Details & Update/);
  assert.match(backupApi, /const SCHEMA_VERSION = 11/);
  assert.match(backupApi, /issueComments/);
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
  assert.match(dashboard, /props\.filteredCount === 1 \? "Task" : "Tasks"/);
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
  assert.match(dashboard, /teamSearch/);
  assert.match(dashboard, /memberSearch/);
  assert.match(dashboard, /aria-label="Search employee"/);
  assert.match(dashboard, /aria-label="Search project employees"/);
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
  assert.match(dashboard, /<th>Task<\/th>/);
  assert.match(dashboard, /<th>Created By<\/th>/);
  assert.match(dashboard, /<th>Created Date<\/th><th>Due Date<\/th>/);
  assert.match(dashboard, /className="employee-cell creator-person-cell"/);
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
  assert.match(issuesModule, /disabled=\{currentUser\.role !== "owner" \|\| issueClosed\}/);
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
  assert.match(issuesModule, /issue notes/);
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
  assert.match(dashboard, /className="filters task-filters-with-views"/);
  assert.match(issuesModule, /Clear all project issue filters/);
  assert.match(issuesModule, /setPriorityFilter\("all"\)/);
});

test("buttons use English-only labels, global tooltips, and unified report and navigation icons", async () => {
  const [dashboard, issuesModule, login, confirmDialog, layout, tooltips, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/login/page.tsx"),
    source("app/confirm-dialog.tsx"),
    source("app/layout.tsx"),
    source("app/button-tooltips.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /<strong>\{item\.en\}<\/strong><small dir="rtl">\{item\.ar\}<\/small><\/span><\/button>/);
  assert.match(dashboard, /<strong>Overview<\/strong><small dir="rtl">نظرة عامة<\/small>/);
  assert.match(dashboard, /ar: "التقارير"/);
  assert.match(dashboard, /projectWorkspaceTab === "tasks"[\s\S]*?className="button-icon"[^>]*>✓<\/span><span>New Task<\/span>/);
  assert.match(dashboard, /projectWorkspaceTab === "issues"[\s\S]*?className="button-icon"[^>]*>!<\/span><span>New Issue<\/span>/);
  assert.match(dashboard, /tab === "projects"[\s\S]*?src="\/icons\/projects-v2\.png"[\s\S]*?<span>New Project<\/span>/);
  assert.match(dashboard, /tab === "team"[\s\S]*?src="\/icons\/team-v2\.png"[\s\S]*?<span>Add Employee<\/span>/);
  assert.doesNotMatch(dashboard, /<ButtonLabel en="(?:New Task|New Issue|New Project|Add Employee)"/);
  assert.doesNotMatch(dashboard, /tab === "overview"[\s\S]{0,180}topbar-icon-action/);
  assert.doesNotMatch(dashboard, /function openNewTaskFromOverview/);
  const topbarActions = dashboard.slice(dashboard.indexOf('<div className="topbar-actions">'), dashboard.indexOf('</header>'));
  assert.ok(topbarActions.indexOf("Add Employee") < topbarActions.indexOf('className="notification-center"'));
  assert.match(dashboard, /function openNewIssue\(\)[\s\S]*?openProjectWorkspace\(projectCode, "issues"\)[\s\S]*?issuesModuleRef\.current\?\.openNew\(\)/);
  assert.match(dashboard, /function ButtonLabel\(\{ en \}:[\s\S]*?<strong>\{en\}<\/strong><\/span>/);
  assert.match(issuesModule, /function ButtonLabel\(\{ en \}:[\s\S]*?<strong>\{en\}<\/strong><\/span>/);
  assert.match(login, /function ButtonLabel\(\{ en \}:[\s\S]*?<strong>\{en\}<\/strong><\/span>/);
  assert.doesNotMatch(confirmDialog, /<small>إلغاء<\/small>|confirmLabelAr \|\| "حذف"/);
  assert.match(issuesModule, /<ButtonLabel en="Create Issue"|"Create Issue"/);
  assert.match(login, /setup \? "Create owner account"/);
  assert.match(styles, /\.button-label \{[^}]*display: grid/);
  assert.match(styles, /\.topbar \.primary-button \{[^}]*height: 43px;[^}]*border-radius: 12px/);
  assert.match(styles, /\.topbar-icon-action \{[^}]*width: 43px; height: 43px;/);
  assert.match(styles, /\.task-action-icon:not\(\.private-task-action-icon\) \{ border-color: transparent; \}/);
  assert.match(styles, /\.issue-action-icon \{[^}]*background: var\(--yellow\);[^}]*color: #171717/);
  assert.match(styles, /\.private-task-action-icon \{[^}]*background: #f3edff;[^}]*color: #5f4788/);
  assert.match(styles, /\.topbar \.topbar-add-button \{[^}]*font-size: 11px;[^}]*font-weight: 400/);
  assert.doesNotMatch(styles, /\.topbar-icon-action::after/);
  assert.match(dashboard, /className="nav-icon has-image"><img src="\/icons\/projects-v2\.png"/);
  assert.match(dashboard, /\{ key: "team", icon: "\/icons\/team-v2\.png"/);
  assert.match(dashboard, /\{ key: "reports", icon: "\/icons\/reports-v2\.png"/);
  assert.match(dashboard, /<img src=\{item\.icon\} alt="" aria-hidden="true"/);
  assert.match(styles, /\.nav-icon \{[^}]*width: 29px; height: 29px;[^}]*background: rgba\(255,255,255,\.08\)/);
  assert.match(styles, /\.nav-icon\.has-image \{[^}]*background: rgba\(255,255,255,\.08\)/);
  assert.match(styles, /\.nav-icon\.has-image img \{[^}]*filter: invert\(80%\);[^}]*transform: scale\(1\.18\)/);
  assert.match(styles, /\.nav-list button\.active \.nav-icon\.has-image img \{ filter: none; \}/);
  assert.match(styles, /\.topbar \.topbar-add-button \.icon-image \{[^}]*width: 29px; height: 29px; min-width: 29px;[^}]*background: transparent;/);
  assert.match(dashboard, /className="report-type-icon"[^>]*>✓<\/span><span>Task Report<\/span>/);
  assert.match(dashboard, /className="report-type-icon"[^>]*>!<\/span><span>Project Issues<\/span>/);
  assert.match(dashboard, /className="report-type-icon"[^>]*>\?<\/span><span>RFI<\/span>/);
  assert.doesNotMatch(dashboard, /Task Report <small>|Project Issues <small>|>RFI <small>/);
  assert.match(styles, /\.report-type-icon \{[^}]*border: 1\.5px solid #171717;[^}]*background: transparent;[^}]*color: #171717/);
  assert.match(dashboard, /fetch\("\/report-logo\.png"\)/);
  assert.match(dashboard, /xl\/media\/report-logo\.png/);
  assert.match(dashboard, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(dashboard, /src="\/report-logo\.png" alt="HINDAZA"/);
  assert.match(layout, /<ButtonTooltips \/>/);
  assert.match(tooltips, /document\.querySelectorAll<HTMLButtonElement>\("button"\)/);
  assert.match(tooltips, /button\.title = tooltipFor\(button\)/);
  assert.match(tooltips, /new MutationObserver\(applyTooltips\)/);
  assert.match(styles, /label:has\(input:required, select:required, textarea:required\)[^}]*content: " \*";[^}]*color: #d71920/);
  assert.match(dashboard, /<input required type="datetime-local" value=\{startedAt\}/);
  assert.match(dashboard, /<input required type="datetime-local" value=\{endedAt\}/);
  assert.match(issuesModule, /<select value=\{convertEmployee\}/);
  assert.match(issuesModule, /Unassigned · تعيين لاحقًا/);
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

test("open drawers and attachment previews isolate wheel scrolling from background tables", async () => {
  const [layout, scrollLock, styles] = await Promise.all([
    source("app/layout.tsx"),
    source("app/overlay-scroll-lock.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(layout, /<OverlayScrollLock \/>/);
  assert.match(scrollLock, /\.drawer-layer, \.attachment-preview-layer, \.app-confirm-layer/);
  assert.match(scrollLock, /\.attachment-preview-content, \.task-form, \.dependency-warning-dialog, \.app-confirm-dialog/);
  assert.match(scrollLock, /document\.addEventListener\("wheel", redirectWheel, \{ capture: true, passive: false \}\)/);
  assert.match(scrollLock, /scrollTarget\.scrollBy\(\{ left: event\.deltaX, top: event\.deltaY, behavior: "auto" \}\)/);
  assert.match(scrollLock, /document\.documentElement\.classList\.toggle\("overlay-scroll-locked", locked\)/);
  assert.match(scrollLock, /document\.body\.classList\.toggle\("overlay-scroll-locked", locked\)/);
  assert.match(styles, /html\.overlay-scroll-locked, body\.overlay-scroll-locked \{ overflow: hidden; overscroll-behavior: none; \}/);
  assert.match(styles, /attachment-preview-content[^}]*overscroll-behavior: contain/);
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

test("project-scoped managers, owner project deletion, and four-character issue numbers are enforced", async () => {
  const [projectsApi, bootstrapApi, tasksApi, issuesApi, convertApi] = await Promise.all([
    source("app/api/projects/route.ts"),
    source("app/api/bootstrap/route.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/issues/route.ts"),
    source("app/api/issues/convert/route.ts"),
  ]);
  assert.match(projectsApi, /Managers can edit only projects they are assigned to/);
  assert.match(projectsApi, /disciplineByEmail\.get\(email\) === currentUser\.discipline/);
  assert.match(projectsApi, /PROJECT_NOT_EMPTY/);
  assert.match(projectsApi, /projectIssues/);
  assert.match(bootstrapApi, /assignedProjectCodes/);
  assert.match(tasksApi, /canManageProject/);
  assert.match(tasksApi, /row\[0\]\.role !== "member" && row\[0\]\.role !== "manager"/);
  assert.match(issuesApi, /slice\(0, 4\)\.toUpperCase\(\)/);
  assert.match(issuesApi, /isAssignedToProject/);
  assert.match(convertApi, /employee\.role !== "member" && employee\.role !== "manager"/);
});

test("task and issue tables use compact counts, discipline-sorted employees, and team clear filters", async () => {
  const [dashboard, issuesModule] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
  ]);
  assert.match(dashboard, /employeeOptions/);
  assert.match(dashboard, /a\.discipline\.localeCompare\(b\.discipline\)/);
  assert.match(dashboard, /\{employee\.name\} \(\{employee\.discipline\}\)/);
  assert.match(dashboard, /className="count-badge filter-count"/);
  assert.match(dashboard, /Clear all team filters/);
  assert.doesNotMatch(dashboard, /<div className="panel-heading"><div><h2>\{props\.tab === "overview"/);
  assert.doesNotMatch(issuesModule, /<div className="panel-heading"><div><h2>Project Issues<\/h2>/);
  assert.match(issuesModule, /count-badge filter-count/);
});

test("project and team directories use compact filter rows and explain blocked project deletion", async () => {
  const [dashboard, styles, projectsApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("app/api/projects/route.ts"),
  ]);
  assert.doesNotMatch(dashboard, /<h2>سجل المشاريع<\/h2>/);
  assert.doesNotMatch(dashboard, /<h2>ملخص الفريق<\/h2>/);
  assert.match(dashboard, /directory-filters project-filter-row/);
  assert.match(dashboard, /directory-filters team-filter-row/);
  assert.match(dashboard, /filteredProjectRows\.length === 1 \? "Project" : "Projects"/);
  assert.match(dashboard, /filteredTeamRows\.length === 1 \? "Employee" : "Employees"/);
  assert.match(dashboard, /response\.status === 409 && data\.code === "PROJECT_NOT_EMPTY"/);
  assert.match(dashboard, /project-dependency-counts/);
  assert.match(projectsApi, /dependencies = \{ tasks: taskCount\.total, issues: issueCount\.total, team: teamCount\.total, rfi: 0 \}/);
  assert.match(styles, /\.directory-filters\.project-filter-row/);
  assert.match(styles, /\.project-dependency-counts/);
});

test("project team picker filters by discipline and shows each member role", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /const \[disciplineFilter, setDisciplineFilter\] = useState\("all"\)/);
  assert.match(dashboard, /availableDisciplines/);
  assert.match(dashboard, /filteredTeamMembers/);
  assert.match(dashboard, /Filter project team by discipline/);
  assert.match(dashboard, /Search project employees/);
  assert.match(dashboard, /All disciplines · كل التخصصات/);
  assert.match(dashboard, /\(\{roleLabel\(user\.role\)\}\)/);
  assert.match(styles, /\.project-team-controls select/);
  assert.match(styles, /\.member-picker \.member-role/);
});

test("management can audit submitted work sessions and directories use the requested tables", async () => {
  const [dashboard, timerApi, issuesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-timer/route.ts"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(timerApi, /export async function PATCH/);
  assert.match(timerApi, /export async function DELETE/);
  assert.match(timerApi, /membership\?\.isProjectManager/);
  assert.match(timerApi, /canAuditTask/);
  assert.match(dashboard, /updateWorkSession/);
  assert.match(dashboard, /deleteWorkSession/);
  assert.match(dashboard, /canAuditSessions/);
  assert.match(dashboard, /teamView === "table"/);
  assert.match(dashboard, /teamView, setTeamView\] = useState<DirectoryView>\("table"\)/);
  assert.match(dashboard, /className="task-table directory-table project-management-table"/);
  assert.match(dashboard, /className="project-settings-button"/);
  assert.match(dashboard, /view-switcher/);
  assert.match(issuesModule, /attachment-preview-dialog/);
  assert.match(issuesModule, /download>Download/);
  assert.match(styles, /\.attachment-preview-layer/);
  assert.match(styles, /\.session-editor/);
});

test("project overview is a detailed drill-down dashboard and Office attachments preview in-app", async () => {
  const [dashboard, issuesModule, issuesApi, bootstrapApi, styles, packageJson] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/issues/route.ts"),
    source("app/api/bootstrap/route.ts"),
    source("app/globals.css"),
    source("package.json"),
  ]);
  assert.match(dashboard, /overview: "PROJECT OVERVIEW"/);
  assert.doesNotMatch(dashboard, /Team Daily Overview/);
  assert.match(dashboard, /ProjectOverviewDashboard/);
  assert.match(dashboard, /PORTFOLIO HEALTH/);
  assert.match(dashboard, /Tasks needing attention/);
  assert.match(dashboard, /Issues needing attention/);
  assert.match(dashboard, /openIssueFromOverview/);
  assert.match(dashboard, /fetchWorkspaceData\(timeoutMs = 15_000\)/);
  assert.match(issuesModule, /function OfficePreview/);
  assert.match(issuesModule, /mammoth\/mammoth\.browser/);
  assert.match(issuesModule, /sheet_to_html/);
  assert.match(issuesModule, /ppt\\\/slides\\\/slide/);
  assert.match(issuesModule, /sandbox="" srcDoc=\{html\}/);
  assert.match(issuesModule, /30_000/);
  assert.match(issuesModule, /!drawerOpen && !saving/);
  assert.match(issuesApi, /Unable to update the project issue right now/);
  assert.doesNotMatch(bootstrapApi, /error instanceof Error \? error\.message/);
  assert.match(styles, /\.overview-kpis/);
  assert.match(styles, /\.office-preview-loading/);
  assert.match(packageJson, /"mammoth"/);
  assert.match(packageJson, /"xlsx"/);
  assert.match(packageJson, /"jszip"/);
});

test("issue attachments use a compact clickable table, chunked 25 MB uploads, and aligned date fields", async () => {
  const [issuesModule, attachmentsApi, styles] = await Promise.all([
    source("app/issues-module.tsx"),
    source("app/api/issue-attachments/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(issuesModule, /className="attachment-table"/);
  assert.match(issuesModule, /aria-label=\{`Preview \$\{attachment\.fileName\}`\}/);
  assert.match(issuesModule, /Download · تنزيل/);
  assert.match(issuesModule, /Delete · حذف/);
  assert.doesNotMatch(issuesModule, /<button type="button" onClick=\{\(\) => setPreview\(attachment\)\}>View/);
  assert.match(issuesModule, /attachment-row-actions" onClick=\{\(event\) => event\.stopPropagation\(\)\}><button type="button" className="attachment-delete"/);
  assert.match(issuesModule, /response\.status === 413/);
  assert.match(issuesModule, /payload too large/i);
  assert.match(issuesModule, /for \(const file of selectedFiles\)/);
  assert.match(issuesModule, /action=start/);
  assert.match(issuesModule, /action=chunk/);
  assert.match(issuesModule, /action=complete/);
  assert.match(issuesModule, /file\.slice/);
  assert.match(issuesModule, /MAX_ATTACHMENT_BYTES = 25 \* 1024 \* 1024/);
  assert.match(attachmentsApi, /MAX_FILE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(attachmentsApi, /CHUNK_BYTES = 768 \* 1024/);
  assert.match(issuesModule, /form-grid issue-date-grid/);
  assert.match(styles, /\.issue-date-grid input\[type="date"\] \{ height: 44px; min-height: 44px;/);
  assert.match(styles, /\.attachment-table-wrap/);
  assert.doesNotMatch(issuesModule, /className="attachment-grid"/);
});

test("deletions use centered in-app confirmation and dashboard summaries follow role and LTR rules", async () => {
  const [dashboard, issuesModule, confirmDialog, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/confirm-dialog.tsx"),
    source("app/globals.css"),
  ]);
  assert.doesNotMatch(dashboard, /window\.confirm|window\.alert/);
  assert.doesNotMatch(issuesModule, /window\.confirm|window\.alert/);
  assert.match(dashboard, /Delete work session\?/);
  assert.match(dashboard, /Delete task\?/);
  assert.match(dashboard, /Delete project\?/);
  assert.match(dashboard, /Delete employee\?/);
  assert.match(dashboard, /Delete profile image\?/);
  assert.match(issuesModule, /Delete attachment\?/);
  assert.match(issuesModule, /Delete \$\{selected\.issueNumber\}\?/);
  assert.match(confirmDialog, /className="app-confirm-layer"/);
  assert.match(confirmDialog, /role="dialog" aria-modal="true"/);
  assert.match(styles, /\.app-confirm-layer \{ position: fixed; z-index: 320;/);
  assert.match(dashboard, /isEmployee=\{currentUser\?\.role === "member"\}/);
  assert.match(dashboard, /employee-project-kpi/);
  assert.match(dashboard, /completedProjects.*onHoldProjects.*total/s);
  assert.match(dashboard, /stats-grid task-stats-ltr/);
  assert.match(dashboard, /Total Tasks · إجمالي المهام/);
  assert.match(dashboard, /Pending Review · بانتظار المراجعة/);
  assert.match(dashboard, /Approved · معتمدة/);
  assert.match(dashboard, /Returned · مُعادة/);
});

test("page headings and overview titles are English-only while typography matches task tables", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /const pageTitle: Record<Tab, string>/);
  assert.match(dashboard, /reports: "REPORTS"/);
  assert.match(dashboard, /projects: "PROJECT MANAGEMENT"/);
  assert.match(dashboard, /<div className="project-heading-line"><h1 dir="ltr">\{tab === "projects" && selectedProject \? selectedProject\.name : pageTitle\[tab\]\}<\/h1>/);
  assert.doesNotMatch(dashboard, /pageTitle\[tab\]\.ar|page-title-ar/);
  assert.match(dashboard, /<span>Active Projects<\/span>/);
  const overview = dashboard.slice(dashboard.indexOf("function ProjectOverviewDashboard"), dashboard.indexOf("function TaskTable"));
  assert.doesNotMatch(overview, /[\u0600-\u06ff]/);
  assert.match(styles, /--font-ui: "HINDAZA Arabic", Arial, "Segoe UI", Tahoma, sans-serif/);
  assert.match(styles, /button, input, select, textarea, table, th, td \{ font-family: var\(--font-ui\); \}/);
  assert.match(styles, /\.issue-table th \{ padding-block: 13px; color: #5e6c75; font-size: 11px;/);
  assert.match(styles, /\.issue-table td \{ font-size: 10px; \}/);
  assert.match(styles, /\.issue-description strong .*font-size: 14px;/);
  assert.match(styles, /\.attachment-table td .*font-size: 10px;/);
});

test("project navigation scopes tasks and issues without changing reports", async () => {
  const [dashboard, issuesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /onClick=\{openProjectDirectory\} aria-label="Projects" title="Projects"/);
  assert.doesNotMatch(dashboard, /Toggle Project list|projectMenuOpen|project-nav-list/);
  assert.match(dashboard, /<tr key=\{project\.id\} onClick=\{\(\) => openProjectWorkspace\(project\.code\)\}/);
  assert.match(dashboard, /event\.stopPropagation\(\); openProject\(project\)/);
  assert.match(dashboard, /<th>Issues<\/th><th>RFI<\/th>/);
  assert.match(dashboard, /project\.closedIssues/);
  assert.match(dashboard, /project\.closedRfi/);
  assert.match(dashboard, /type ProjectWorkspaceTab = "tasks" \| "issues" \| "rfi"/);
  assert.match(dashboard, /role="tablist" aria-label="Project sections"/);
  assert.match(dashboard, /className="report-type-icon" aria-hidden="true">✓<\/span> Tasks/);
  assert.match(dashboard, /className="project-switcher" ref=\{projectSwitcherRef\}/);
  assert.match(dashboard, /className="project-switcher-button"/);
  assert.match(dashboard, /className="project-switcher-menu" role="menu"/);
  assert.match(dashboard, /aria-label="Switch project"/);
  assert.match(dashboard, /value=\{projectSearch\}/);
  assert.match(dashboard, /aria-label="Clear all project filters"/);
  assert.match(dashboard, /setProjectSearch\(""\); setProjectStatusFilter\("all"\)/);
  assert.match(dashboard, /className="project-table-identity"><span className="project-name-live"><strong>\{project\.name\}<\/strong>\{projectLiveIndicators\(project\.code\)\}<\/span><small className="project-code">\{project\.code\}<\/small>/);
  assert.doesNotMatch(dashboard, /<small>Tasks in this project<\/small>/);
  assert.doesNotMatch(dashboard, /project-workspace-header panel/);
  assert.match(dashboard, /lockedProjectCode=\{selectedProject\.code\}/);
  assert.match(dashboard, /!props\.lockedProjectCode && <select[\s\S]*?Filter by project/);
  assert.match(issuesModule, /lockedProjectCode\?: string/);
  assert.match(issuesModule, /!lockedProjectCode && <select value=\{projectFilter\}/);
  assert.match(dashboard, /tab === "reports" && <div className="reports-workspace"/);
  assert.match(styles, /\.project-workspace-tabs/);
  assert.match(styles, /\.project-switcher/);
  assert.match(styles, /\.project-switcher-menu \{ position: absolute;[^}]*left: 0;[^}]*right: auto;/);
  assert.match(styles, /\.project-switcher-menu strong \{ color: #171717;/);
  assert.match(styles, /\.project-table-identity > strong/);
});

test("project managers have project-wide visibility and modern project navigation", async () => {
  const [schema, migration, projectsApi, bootstrapApi, access, attachmentsApi, dashboard, styles] = await Promise.all([
    source("db/schema.ts"),
    source("drizzle/0014_smooth_carlie_cooper.sql"),
    source("app/api/projects/route.ts"),
    source("app/api/bootstrap/route.ts"),
    source("lib/task-access.ts"),
    source("app/api/task-attachments/route.ts"),
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(schema, /isProjectManager: integer\("is_project_manager"/);
  assert.match(migration, /ADD `is_project_manager` integer DEFAULT false NOT NULL/);
  assert.match(projectsApi, /projectManagerEmails/);
  assert.match(projectsApi, /isProjectManager: assignedProjectManagers\.includes\(employeeEmail\)/);
  assert.match(bootstrapApi, /managedProjectCodes/);
  assert.match(bootstrapApi, /managedProjectCodes\.has\(task\.project\)/);
  assert.match(bootstrapApi, /projectManagerEmails:/);
  assert.match(access, /export async function canViewTask/);
  assert.match(access, /membership\?\.isProjectManager/);
  assert.match(attachmentsApi, /taskForView/);
  assert.match(dashboard, /Project Manager/);
  assert.match(dashboard, /toggleProjectManager/);
  assert.match(dashboard, /aria-label="Back to Projects" title="Back to Projects"/);
  assert.match(dashboard, /<svg viewBox="0 0 24 24"/);
  assert.match(styles, /\.project-switcher-button .*background: linear-gradient/);
  assert.match(styles, /\.project-directory-back/);
});

test("project managers see assignments while submitted employee tasks can be accepted", async () => {
  const [dashboard, tasksApi, taskAccess, timerApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
    source("lib/task-access.ts"),
    source("app/api/task-timer/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /currentUserIsProjectManager/);
  assert.match(dashboard, /showEmployeeFilter=\{currentUser\?\.role !== "member" \|\| currentUserIsProjectManager\}/);
  assert.match(dashboard, /const managerTaskAccess = Boolean/);
  assert.match(dashboard, /task\.createdBy\.toLowerCase\(\) === currentUser\.email\.toLowerCase\(\)/);
  assert.match(dashboard, /readOnly=\{!canCollaborate\}/);
  assert.match(tasksApi, /canManageExistingTask/);
  assert.match(tasksApi, /Managers can edit or delete only tasks they created/);
  assert.match(taskAccess, /if \(task\.createdBy === currentUser\.email\) return true;[\s\S]*?Boolean\(membership\.isProjectManager\)/);
  assert.match(timerApi, /if \(task\.createdBy === currentUser\.email\) return true/);
  assert.match(tasksApi, /canAdoptSubmittedTask/);
  assert.match(dashboard, /className="project-settings-topbar"/);
  assert.match(dashboard, /aria-label="Project settings" title="Project settings"/);
  assert.match(styles, /\.project-directory-back \{ height: 43px; min-height: 43px;/);
  assert.match(styles, /\.project-settings-topbar \{ width: 43px; height: 43px;/);
});

test("projects archive cleanly and tasks support guarded subtasks with optional attachments", async () => {
  const [dashboard, schema, projectsApi, subtasksApi, attachmentsApi, tasksApi, timerApi, taskDetailsApi, styles, migration] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("db/schema.ts"),
    source("app/api/projects/route.ts"),
    source("app/api/task-subtasks/route.ts"),
    source("app/api/task-attachments/route.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/task-timer/route.ts"),
    source("app/api/task-details/route.ts"),
    source("app/globals.css"),
    source("drizzle/0013_outstanding_lady_vermin.sql"),
  ]);
  assert.match(schema, /"active", "on_hold", "completed", "archived"/);
  assert.match(projectsApi, /"active", "on_hold", "completed", "archived"/);
  assert.match(dashboard, /useState\("active"\)/);
  assert.match(dashboard, /archived: "Archived · مؤرشف"/);
  assert.match(schema, /export const taskSubtasks/);
  assert.match(schema, /export const taskAttachments/);
  assert.match(migration, /CREATE TABLE `task_subtasks`/);
  assert.match(migration, /CREATE TABLE `task_attachments`/);
  assert.match(subtasksApi, /type: "subtask_completed"/);
  assert.match(subtasksApi, /taskForCollaboration/);
  assert.match(attachmentsApi, /MAX_FILE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(attachmentsApi, /action === "chunk"/);
  assert.match(attachmentsApi, /subtaskId/);
  assert.doesNotMatch(tasksApi, /Complete all subtasks before sending this task/);
  assert.match(timerApi, /Complete all subtasks before \$\{submitForReview \? "submitting" : "finishing"\} this task/);
  assert.match(taskDetailsApi, /subtasks, taskAttachments: attachments/);
  assert.match(taskDetailsApi, /taskForView/);
  assert.match(dashboard, /Task Attachments/);
  assert.match(dashboard, /Subtasks/);
  assert.match(dashboard, /className="subtask-indicator"/);
  assert.match(dashboard, /uploadTaskAttachment/);
  assert.match(styles, /\.subtask-table/);
});

test("task creation drafts subtasks while uploads report progress and private activity stays private", async () => {
  const [dashboard, tasksApi, subtasksApi, timerApi, issuesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
    source("app/api/task-subtasks/route.ts"),
    source("app/api/task-timer/route.ts"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /type DraftSubtask/);
  assert.match(dashboard, /setDraftSubtasks\(\(current\) => \[\.\.\.current/);
  assert.match(dashboard, /subtasks: draftSubtasks\.map/);
  assert.match(tasksApi, /initialSubtaskTitles/);
  assert.match(tasksApi, /subtasks: createdSubtasks/);
  assert.match(tasksApi, /Created by \$\{currentUser\.displayName\}/);
  assert.match(tasksApi, /Private task shared with management/);
  assert.match(tasksApi, /const ownPrivateTask = currentUser\.role === "member"/);
  assert.match(tasksApi, /You can delete only your own private tasks/);
  assert.match(dashboard, /memberOwnPrivate/);
  assert.match(dashboard, /Share with Manager/);
  assert.match(dashboard, /team: "TEAM"/);
  assert.match(dashboard, /className="subtask-number">\{index \+ 1\}/);
  assert.match(dashboard, /className=\{`assignment-time-grid/);
  assert.match(dashboard, /\{management && \(form\.visibility !== "private" \|\| acceptingEmployeeTask\) && <label className="assignment-employee"/);
  assert.match(dashboard, /<option key=\{user\.email\} value=\{user\.email\}>\{user\.displayName\}\{user\.discipline/);
  assert.match(styles, /assignment-time-grid\.management \{ grid-template-columns: minmax\(0, 1\.35fr\)/);
  assert.match(dashboard, /setTaskAttachmentProgress/);
  assert.match(dashboard, /<progress max="100" value=\{progress\.percent\}/);
  assert.match(issuesModule, /setUploadProgress/);
  assert.match(issuesModule, /<progress max="100" value=\{item\.percent\}/);
  assert.match(subtasksApi, /task\.visibility === "private" && !task\.submittedToManager/);
  assert.match(subtasksApi, /managementNotified/);
  assert.match(dashboard, /data\.managementNotified/);
  assert.match(dashboard, /Subtask closed · أُغلقت المهمة الفرعية/);
  assert.match(dashboard, /privateFinishOnly/);
  assert.match(dashboard, /privateFinishOnly \? "✓ Finish" : "✓ Finish & Submit"/);
  assert.match(timerApi, /managerCheck: submitForReview \? "pending" : "new"/);
  assert.match(timerApi, /submittedForReview: action === "finish" && submitForReview/);
  assert.match(dashboard, /className="subtask-attachment-list"/);
  assert.match(styles, /\.subtask-attachment-list/);
});

test("project tabs are compact, task notes edit for fifteen minutes, and due dates filter tasks", async () => {
  const [dashboard, commentsApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-comments/route.ts"),
    source("app/globals.css"),
  ]);
  const workspaceStart = dashboard.indexOf('aria-label={`${selectedProject.name} workspace`}');
  const tabsStart = dashboard.indexOf('className="project-workspace-tabs"', workspaceStart);
  const statsStart = dashboard.indexOf('className="stats-grid task-stats-ltr"', workspaceStart);
  assert.ok(workspaceStart >= 0 && tabsStart > workspaceStart && tabsStart < statsStart);
  assert.match(styles, /\.project-workspace-tabs button \{ min-height: 38px;/);
  assert.match(styles, /\.report-type-selector button \{ min-height: 38px;/);
  assert.match(dashboard, /aria-label="Filter by due date"/);
  assert.match(dashboard, /!dueDateFilter \|\| task\.taskDate === dueDateFilter/);
  assert.match(dashboard, /setDueDateFilter\(""\)/);
  assert.match(dashboard, /task\.status === "done" && task\.managerCheck === "approved"[\s\S]*?label: "OK"/);
  assert.match(dashboard, /task\.status === "done"[\s\S]*?label: "Wait"/);
  assert.match(dashboard, /task\.taskDate && task\.taskDate < localToday\(\)[\s\S]*?label: "Late"/);
  assert.match(dashboard, /label: "NA"/);
  assert.match(dashboard, /canEditComment\(comment, currentUser, clock\)/);
  assert.match(dashboard, /className="comment-edit-button"/);
  assert.match(dashboard, /fetch\("\/api\/task-comments"[\s\S]*?method: "PATCH"/);
  assert.match(commentsApi, /COMMENT_EDIT_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(commentsApi, /comment\.authorEmail\.toLowerCase\(\) !== currentUser\.email\.toLowerCase\(\)/);
  assert.match(commentsApi, /elapsed > COMMENT_EDIT_WINDOW_MS/);
  assert.match(commentsApi, /Only the note author can edit it/);
});

test("task project settings return to the task and project leaders can filter tasks by discipline", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /openProjectSettings=\{openProjectFromTask\}/);
  assert.match(dashboard, /className="task-project-settings"/);
  assert.match(dashboard, /aria-label="Project settings" title="Project settings"/);
  assert.match(dashboard, /if \(projectDrawerReturnToTask\) \{[\s\S]*?setProjectDrawerOpen\(false\)/);
  assert.match(dashboard, /showDisciplineColumn=\{currentUser\?\.role === "owner" \|\| currentUser\?\.role === "manager" \|\| currentUserIsProjectManager\}/);
  assert.match(dashboard, /aria-label="Filter by discipline"/);
  assert.match(dashboard, /<th>Discipline<\/th>/);
  assert.match(dashboard, /className="task-discipline"/);
  assert.match(styles, /\.task-project-settings/);
  assert.match(styles, /\.task-discipline/);
});

test("managers see task disciplines and project team members open in a returning editor", async () => {
  const [dashboard, bootstrapApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/bootstrap/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /showDisciplineColumn=\{currentUser\?\.role === "owner" \|\| currentUser\?\.role === "manager" \|\| currentUserIsProjectManager\}/);
  assert.match(bootstrapApi, /createdByName: displayNameByEmail\.get\(task\.createdBy\.toLowerCase\(\)\) \|\| "Unknown user"/);
  assert.match(bootstrapApi, /employeeDiscipline: disciplineByEmail\.get\(task\.employeeEmail\.toLowerCase\(\)\) \|\| ""/);
  assert.match(dashboard, /const creatorName = task\.createdByName/);
  assert.doesNotMatch(dashboard, /creator\?\.displayName \|\| task\.createdBy \|\| "—"/);
  assert.match(dashboard, /className="project-member-settings"/);
  assert.match(dashboard, /onEditUser=\{openUserFromProject\}/);
  assert.match(dashboard, /if \(userDrawerReturnToProject\) \{[\s\S]*?setUserDrawerOpen\(false\)/);
  assert.match(styles, /\.project-member-settings/);
});

test("task completion and notes notify only the responsible creator and counterpart", async () => {
  const [timerApi, subtasksApi, issueCommentsApi, taskAccess, tasksApi, commentsApi, dashboard] = await Promise.all([
    source("app/api/task-timer/route.ts"),
    source("app/api/task-subtasks/route.ts"),
    source("app/api/issue-comments/route.ts"),
    source("lib/task-access.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/task-comments/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(timerApi, /eq\(users\.email, task\.createdBy\)/);
  assert.match(timerApi, /recipientEmail: creator\.email/);
  assert.doesNotMatch(timerApi, /managers\.map/);
  assert.match(subtasksApi, /eq\(users\.email, task\.createdBy\)/);
  assert.match(subtasksApi, /recipientEmail: creator\.email/);
  assert.match(tasksApi, /canManageTask/);
  assert.match(commentsApi, /task\[0\]\.createdBy === currentUser\.email/);
  assert.match(commentsApi, /type: "task_note_added"/);
  assert.match(commentsApi, /currentUser\.role === "member" \? taskDetails\.createdBy : taskDetails\.employeeEmail/);
  assert.match(commentsApi, /Only the owner can delete task notes/);
  assert.match(taskAccess, /export async function canCollaborateOnTask[\s\S]*?if \(task\.createdBy === currentUser\.email\) return true;[\s\S]*?return canManageTask/);
  assert.match(dashboard, /const managerTaskAccess = Boolean/);
  assert.match(dashboard, /\{canComment && <div className="comment-composer">/);
  assert.match(issueCommentsApi, /issueCreatorEmail/);
  assert.match(issueCommentsApi, /eq\(activityLogs\.action, "created"\)/);
  assert.match(issueCommentsApi, /recipientEmail = issue\.raisedByEmail/);
  assert.match(issueCommentsApi, /type: "issue_note_added"/);
  assert.match(issueCommentsApi, /currentUser\.email === issue\.raisedByEmail/);
});

test("V77 converts issues to optionally unassigned tasks and keeps them visible to their creator", async () => {
  const [convertApi, issuesModule, tasksApi, bootstrapApi] = await Promise.all([
    source("app/api/issues/convert/route.ts"),
    source("app/issues-module.tsx"),
    source("app/api/tasks/route.ts"),
    source("app/api/bootstrap/route.ts"),
  ]);
  assert.match(convertApi, /employeeName: employee\?\.displayName \|\| "Unassigned"/);
  assert.match(convertApi, /employeeEmail: employee\?\.email \|\| ""/);
  assert.match(convertApi, /if \(employee\) \{[\s\S]*?type: "task_assigned"/);
  assert.match(issuesModule, /Employee assignment is optional/);
  assert.match(issuesModule, /disabled=\{saving\}/);
  assert.match(tasksApi, /canManageTask/);
  assert.match(bootstrapApi, /task\.createdBy === currentUser\.email/);
});

test("V78 adds compact project views, guarded dates, creation notes and attachments, raised-by roles, and profile images", async () => {
  const [dashboard, styles, projectsApi, tasksApi, issuesApi, issuesModule, profileApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("app/api/projects/route.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/issues/route.ts"),
    source("app/issues-module.tsx"),
    source("app/api/profile-image/route.ts"),
  ]);
  assert.match(dashboard, /projectView, setProjectView\] = useState<DirectoryView>\("table"\)/);
  assert.match(dashboard, /projectView === "cards"/);
  assert.match(styles, /\.project-management-table td \{ padding-top: 7px/);
  assert.match(styles, /\.project-table-identity \{ display: grid; justify-items: start;/);
  assert.match(projectsApi, /invalidProjectDates/);
  assert.match(projectsApi, /start date must be before the target date/);
  assert.match(tasksApi, /initialNote/);
  assert.match(tasksApi, /createdComments/);
  assert.match(dashboard, /draftTaskAttachments/);
  assert.match(dashboard, /Add Attachments/);
  assert.match(issuesApi, /if \(account\.role === "owner"\) return account/);
  assert.match(issuesModule, /onOpenProjectSettings/);
  assert.match(issuesModule, /IssueUserAvatar/);
  assert.match(dashboard, /UserAvatar/);
  assert.match(profileApi, /searchParams\.get\("email"\)/);
});

test("V79 fixes project settings placement, person cells, account email, titles, and issue numbering", async () => {
  const [dashboard, issuesModule, issuesApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/issues/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /employee-cell creator-person-cell/);
  assert.match(dashboard, /<UserAvatar user=\{creator\} name=\{creatorName\}/);
  assert.match(dashboard, /\{currentUser\?\.email\}/);
  assert.match(dashboard, /<span>\{form\.name\}<\/span> Edit/);
  assert.match(dashboard, /"Add new project"/);
  assert.match(dashboard, /<span>\{form\.displayName\}<\/span> Edit/);
  assert.match(dashboard, /"New Team"/);
  assert.match(issuesModule, /task-project-label/);
  assert.doesNotMatch(issuesModule, /<\/div>\{selectedProject && \(currentUser\.role === "owner"/);
  assert.match(issuesModule, /<IssueUserAvatar user=\{raisedBy\}/);
  assert.match(issuesApi, /replace\(\/\[\^A-Z0-9\]\/gi, ""\)\.slice\(0, 4\)\.toUpperCase\(\)/);
  assert.match(issuesApi, /`\$\{projectPrefix\}-\$\{disciplineCodes\[discipline\]/);
  assert.match(styles, /task-project-label > \.task-project-settings \{ position: absolute/);
  assert.match(styles, /drawer-record-title span \{ color: #c92f35/);
});

test("V80 simplifies task and issue tables and normalizes legacy issue numbers", async () => {
  const [dashboard, issuesModule, issuesApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/issues/route.ts"),
  ]);
  assert.match(dashboard, /sortHeader\("title", "Task"\).*sortHeader\("employee", "Employee"\).*sortHeader\("createdBy", "Created By"\)/s);
  assert.doesNotMatch(dashboard, /<span className="project-code">\{task\.project\}<\/span>/);
  assert.match(dashboard, /employee-cell creator-person-cell/);
  assert.match(issuesModule, /<th>Issue Number<\/th><th>Description<\/th><th>Raised By<\/th><th>Discipline<\/th>/);
  assert.doesNotMatch(issuesModule, /<span className="project-code">\{issue\.projectCode\}<\/span>/);
  assert.doesNotMatch(issuesModule, /Raised by \{issue\.raisedByName\}/);
  assert.match(issuesApi, /issueNumber: issueNumber\(issue\.projectCode, issue\.discipline, issue\.sequence\)/);
});

test("V82 shows a framed employee image in the editor and lets only the owner manage it", async () => {
  const [dashboard, styles, profileApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("app/api/profile-image/route.ts"),
  ]);
  assert.match(dashboard, /className="drawer-head user-drawer-head"/);
  assert.match(dashboard, /className="user-drawer-heading"/);
  assert.match(dashboard, /className="user-drawer-avatar"/);
  assert.match(dashboard, /uploadProfileImageFile\(image, selectedEmail, setImageUploadProgress\)/);
  assert.match(dashboard, /currentUser\?\.role === "owner"/);
  assert.match(styles, /\.avatar\.user-drawer-avatar \{ width: 66px; height: 66px; border: 4px solid var\(--yellow\)/);
  assert.match(styles, /\.user-drawer-heading \{ min-width: 0; display: flex; align-items: center; gap: 16px/);
  assert.match(profileApi, /targetEmail !== currentUser\.email && currentUser\.role !== "owner"/);
  assert.match(profileApi, /Only the owner can change another user's profile image/);
  assert.match(profileApi, /Only the owner can remove another user's profile image/);
  assert.match(profileApi, /uploadedBy: currentUser\.email/);
});

test("V83 makes owner image removal resilient and shows circular upload progress", async () => {
  const [dashboard, styles, profileApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("app/api/profile-image/route.ts"),
  ]);
  assert.match(dashboard, /setImageUploadProgress/);
  assert.match(dashboard, /role="progressbar"/);
  assert.match(dashboard, /user-photo-progress/);
  assert.match(dashboard, /owner && selectedEmail && <button[^>]*user-photo-remove/);
  assert.doesNotMatch(dashboard, /owner && selectedEmail && selectedUser\?\.profileImageKey && <button/);
  assert.match(styles, /conic-gradient\(var\(--yellow\) var\(--profile-upload-progress\)/);
  assert.match(styles, /user-photo-progress span/);
  assert.match(profileApi, /await db\.update\(users\)\.set\(\{ profileImageKey: "" \}\)/);
  assert.match(profileApi, /Profile image reference cleared; R2 cleanup will be retried later/);
  assert.match(profileApi, /profileImageKey: ""/);
});

test("V84 chunks profile images below the gateway limit and removes them with an owner-authorized JSON action", async () => {
  const [dashboard, profileApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/profile-image/route.ts"),
  ]);
  assert.match(profileApi, /const CHUNK_BYTES = 256 \* 1024/);
  assert.match(profileApi, /action === "chunk"/);
  assert.match(profileApi, /action === "complete" \|\| action === "abort"/);
  assert.match(profileApi, /action === "remove"/);
  assert.match(profileApi, /currentUser\.role !== "owner"/);
  assert.match(profileApi, /await db\.update\(users\)\.set\(\{ profileImageKey: "" \}\)/);
  assert.match(dashboard, /image\.slice\(startOffset, endOffset\)/);
  assert.match(dashboard, /endOffset \/ image\.size/);
  assert.match(dashboard, /\/api\/profile-image\?action=remove/);
  assert.doesNotMatch(dashboard, /new XMLHttpRequest\(\)/);
});

test("V85 shows attachment and issue-note counts in the task and issue tables", async () => {
  const [dashboard, issuesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /attachments=\{taskAttachments\}/);
  assert.match(dashboard, /const attachmentsByTaskId = useMemo\(\(\) => rowsByTaskId\(props\.attachments\)/);
  assert.match(dashboard, /const attachmentCount = detailsLoaded \? attachmentsByTaskId\.get\(task\.id\)\?\.length \|\| 0 : task\.attachmentCount \|\| 0/);
  assert.match(dashboard, /task-attachment-indicator/);
  assert.match(issuesModule, /const internalNoteCount = issue\.notes\.filter\(\(note\) => note\.section === "internal"\)\.length/);
  assert.match(issuesModule, /const clientNoteCount = issue\.notes\.filter\(\(note\) => note\.section === "client"\)\.length/);
  assert.match(issuesModule, /\{internalNoteCount\} issue notes/);
  assert.match(issuesModule, /\{clientNoteCount\} client response notes/);
  assert.match(styles, /task-tags \.task-attachment-indicator/);
  assert.match(styles, /client-reply-indicator small/);
});

test("V87 keeps private tasks on the open project and unlocks reassignment only after review submission", async () => {
  const [dashboard, tasksApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
  ]);
  assert.match(tasksApi, /!requestedPrivate && !selfAssigned && !\(await isProjectMember/);
  assert.match(tasksApi, /const privateSelfEdit = management/);
  assert.match(tasksApi, /reassignmentAfterSubmission = existing\[0\]\.submittedToManager \|\| existing\[0\]\.managerCheck === "pending"/);
  assert.match(tasksApi, /employeeChanged \|\| convertingPrivate/);
  assert.match(dashboard, /managementPrivateProjectLocked/);
  assert.match(dashboard, /task\.project !== "PERSONAL" \? task\.project/);
  assert.match(dashboard, /Convert to Employee Task · تحويل إلى مهمة موظف/);
  assert.match(dashboard, /const assignmentLocked = Boolean\(activeEntry\) \|\| \(timeEntries\.length > 0 && !canReassignAfterWork && !convertingPrivateInForm\)/);
  assert.match(dashboard, /title=\{assignmentLocked \? assignmentLockHint : undefined\}/);
  assert.match(dashboard, /form\.visibility !== "private" \|\| acceptingEmployeeTask/);
});

test("V88 keeps one cumulative timer row per review cycle and stabilizes Raised By identity cells", async () => {
  const [timerApi, issuesApi, issuesModule, styles] = await Promise.all([
    source("app/api/task-timer/route.ts"),
    source("app/api/issues/route.ts"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(timerApi, /async function resumeCycleEntry/);
  assert.match(timerApi, /const accumulatedSeconds = cycleEntries\.reduce/);
  assert.match(timerApi, /db\.delete\(taskTimeEntries\)\.where\(inArray\(taskTimeEntries\.id/);
  assert.match(timerApi, /await closeActiveEntries\(db, currentUser\.email, now\)/);
  assert.match(timerApi, /await resumeCycleEntry\(db, task, currentUser\.email, currentUser\.displayName, now\)/);
  assert.match(issuesApi, /raisedByProfileImageKey: account\?\.profileImageKey \|\| ""/);
  assert.match(issuesModule, /email\.toLowerCase\(\) === issue\.raisedByEmail\.toLowerCase\(\)/);
  assert.match(issuesModule, /employee-cell issue-raised-by-cell/);
  assert.match(styles, /\.issue-raised-by-cell strong/);
});

test("V89 bounds issue loading and keeps D1 reads below the concurrent subrequest limit", async () => {
  const [issuesApi, issuesModule] = await Promise.all([
    source("app/api/issues/route.ts"),
    source("app/issues-module.tsx"),
  ]);
  assert.match(issuesApi, /const issues = await db\.select\(\)\.from\(projectIssues\)/);
  assert.match(issuesApi, /const \[chunkAttachments, chunkNotes, chunkActivities\] = await db\.batch/);
  assert.match(issuesApi, /ISSUE_QUERY_CHUNK_SIZE = 85/);
  assert.match(issuesApi, /inArray\(issueAttachments\.issueId, issueIds\)/);
  assert.doesNotMatch(issuesApi, /\[issues, attachments, notes, createdActivities, raisedByAccounts\] = await Promise\.all/);
  assert.match(issuesModule, /const ISSUE_LOAD_TIMEOUT_MS = 15_000/);
  assert.match(issuesModule, /signal: controller\.signal/);
  assert.match(issuesModule, /void load\(\);\s*\n\s*\}, \[load\]\)/);
  assert.match(issuesModule, /Retry · إعادة المحاولة/);
});

test("V90 adds automatic field direction, guarded subtask title editing, aligned task dates, and code-sorted projects", async () => {
  const [dashboard, subtasksApi, styles, directionController, layout] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-subtasks/route.ts"),
    source("app/globals.css"),
    source("app/automatic-text-direction.tsx"),
    source("app/layout.tsx"),
  ]);
  assert.match(directionController, /function applyAutomaticTextDirection/);
  assert.match(directionController, /document\.addEventListener\("input", syncDirection, true\)/);
  assert.match(directionController, /target\.style\.direction = direction/);
  assert.match(layout, /<AutomaticTextDirection \/>/);
  assert.match(dashboard, /function EditableSubtaskTitle/);
  assert.match(dashboard, /const canEditSubtaskTitles = Boolean/);
  assert.match(dashboard, /updateSubtaskTitle\(subtask, title\)/);
  assert.match(subtasksApi, /function canEditSubtaskTitle/);
  assert.match(subtasksApi, /return canManageTask\(db, currentUser, task\)/);
  assert.match(dashboard, /a\.code\.localeCompare\(b\.code, undefined, \{ numeric: true, sensitivity: "base" \}\)/);
  assert.match(styles, /\.project-table-identity \{ display: grid; justify-items: start;/);
  assert.match(styles, /\.task-project-date-grid select, \.task-project-date-grid input\[type="date"\] \{ height: 39px;/);
});

test("V91 adds password visibility, employee settings controls, and grouped employee task review", async () => {
  const [dashboard, login, passwordInput, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/login/page.tsx"),
    source("app/password-input.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /Name · الاسم/);
  assert.match(dashboard, /Discipline · التخصص/);
  assert.doesNotMatch(dashboard, /<h3>بيانات الموظف/);
  assert.match(login, /<PasswordInput required/);
  assert.match(dashboard, /<PasswordInput required minLength=\{10\}/);
  assert.match(passwordInput, /aria-label=\{visible \? "Hide password" : "Show password"\}/);
  assert.match(dashboard, /className="project-settings-button team-settings-button"/);
  assert.match(dashboard, /function EmployeeTasksDialog/);
  assert.match(dashboard, /task\.managerCheck !== "approved"/);
  assert.match(dashboard, /a\.localeCompare\(b, undefined, \{ numeric: true, sensitivity: "base" \}\)/);
  assert.match(dashboard, /aria-expanded=\{!collapsed\}/);
  assert.match(dashboard, /Right-click to open it in a new tab/);
  assert.match(dashboard, /&task=\$\{task\.id\}/);
  assert.match(styles, /\.employee-tasks-dialog/);
});

test("V93 keeps employee task navigation in history and uses a centered 80 percent dialog", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /hindazaEmployeeTasks/);
  assert.match(dashboard, /window\.history\.pushState\([^;]*hindazaTask: task\.id/);
  assert.match(dashboard, /event\.stopPropagation\(\); openUser\(row\)/);
  assert.match(styles, /\.employee-tasks-dialog \{[^}]*top: 50%; left: 50%;/);
  assert.match(styles, /\.employee-tasks-dialog \{[^}]*width: 81\.4vw; height: 90vh;/);
});

test("V94 lets management assign a new task to themselves inside the standard New Task flow", async () => {
  const [dashboard, tasksApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
  ]);
  assert.doesNotMatch(dashboard, /Task for Me/);
  assert.doesNotMatch(dashboard, /selfAssigned: selfTaskDraft/);
  assert.match(tasksApi, /const requestedEmployeeEmail = management && !requestedPrivate/);
  assert.match(tasksApi, /const selfAssigned = management && !requestedPrivate && requestedEmployeeEmail === currentUser\.email/);
  assert.match(tasksApi, /const employeeEmail = selfAssigned \? currentUser\.email/);
  assert.match(tasksApi, /!selfAssigned && !\(await isProjectMember/);
  assert.match(tasksApi, /const managementSelfTask = management && existing\[0\]\.createdBy === currentUser\.email/);
});

test("V94 closes the employee task dialog back to the team table without reopening a task", async () => {
  const dashboard = await source("app/task-dashboard.tsx");
  assert.match(dashboard, /window\.history\.replaceState\(\{ \.\.\.window\.history\.state, hindazaEmployeeTasks: null, hindazaTask: null \}/);
  assert.match(dashboard, /url\.searchParams\.delete\("task"\);[\s\S]*setTaskDrawerOpen\(false\);[\s\S]*setSelectedTaskId\(null\);/);
  assert.doesNotMatch(dashboard, /stateEmail\) \{\s*window\.history\.back\(\)/);
});

test("V97 uses the mouse wheel for the window and limits each project to four visible task rows", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /className="employee-dialog-avatar"/);
  assert.match(dashboard, /className="employee-dialog-meta"/);
  assert.doesNotMatch(dashboard, /employee-tasks-scroll-hint/);
  assert.match(dashboard, /projectTasks\.length > 4 \? " has-more-tasks"/);
  assert.match(dashboard, /scroll for more tasks/);
  assert.match(styles, /\.employee-tasks-dialog \{[^}]*top: 50%; left: 50%;[^}]*transform: translate\(-50%, -50%\)/);
  assert.match(styles, /\.avatar\.employee-dialog-avatar \{[^}]*width: 58px; height: 58px;[^}]*display: grid; place-items: center;/);
  assert.match(styles, /\.employee-project-groups \{[^}]*min-height: 0;[^}]*flex: 1 1 0;[^}]*overflow-y: scroll;/);
  assert.match(styles, /\.employee-project-groups-content \{[^}]*display: flex; flex-direction: column;/);
  assert.match(styles, /\.employee-project-group \{[^}]*flex: 0 0 auto;/);
  assert.match(styles, /\.employee-task-table-wrap\.has-more-tasks \{[^}]*max-height: 225px; overflow-y: scroll;/);
  assert.match(styles, /\.employee-task-table tbody tr \{ height: 49px;/);
});

test("V98 routes mouse-wheel scrolling and prints every filtered employee task with the report logo", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /const handleDialogWheel = \(event: React\.WheelEvent<HTMLDivElement>\)/);
  assert.match(dashboard, /projectScroller\.scrollTop \+= Math\.sign\(event\.deltaY\) \* consumed/);
  assert.match(dashboard, /remainingDelta = Math\.sign\(event\.deltaY\) \* \(Math\.abs\(event\.deltaY\) - consumed\)/);
  assert.match(dashboard, /if \(remainingDelta\) outer\.scrollTop \+= remainingDelta/);
  assert.match(dashboard, /ref=\{projectGroupsRef\} onWheel=\{handleDialogWheel\}/);
  assert.match(dashboard, /className="employee-tasks-print"/);
  assert.match(dashboard, /Print employee tasks as PDF/);
  assert.match(dashboard, /<img class="logo" src="\/report-logo\.png"/);
  assert.match(dashboard, /projectTasks\.map\(\(task\) =>/);
  assert.match(dashboard, /window\.onload=\(\)=>\{window\.print\(\);\}/);
  assert.match(styles, /\.employee-tasks-header-actions \{[^}]*display: flex;/);
  assert.match(styles, /\.employee-project-groups \{[^}]*touch-action: pan-y;/);
  assert.match(styles, /\.employee-tasks-print, \.employee-tasks-settings \{[^}]*background: var\(--yellow\);[^}]*color: #171717;/);
  assert.match(dashboard, /className="employee-tasks-print"[^>]*><svg viewBox="0 0 24 24"/);
  assert.match(styles, /\.employee-tasks-print svg \{[^}]*width: 24px; height: 24px;[^}]*stroke-width: 1\.65;/);
});

test("V101 shows active employee work globally and one live project pulse per working employee", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /timeEntries\.filter\(\(entry\) => !entry\.endedAt\)/);
  assert.match(dashboard, /task\.status === "in_progress" \|\| activeEntryByTask\.has\(task\.id\)/);
  assert.match(dashboard, /const activeEmployeeWork = currentUser/);
  assert.match(dashboard, /className="employee-active-work-banner"/);
  assert.match(dashboard, /onClick=\{\(\) => openEmployeeTask\(activeEmployeeWork\.task\)\}/);
  assert.match(dashboard, /className="project-live-workers"/);
  assert.match(dashboard, /workers\.map\(\(\{ employeeEmail, employeeName, task \}\) => <i/);
  assert.match(dashboard, /projectLiveIndicators\(project\.code\)/);
  assert.match(styles, /\.active-work-pulse \{[^}]*animation: activeWorkPulse/);
  assert.match(styles, /\.project-live-workers i \{[^}]*animation: activeWorkPulse/);
});

test("V103 links converted issues dynamically and expands the English employee task table", async () => {
  const [dashboard, bootstrap, issuesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/bootstrap/route.ts"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(bootstrap, /taskIssueLinks: linkedIssueRows/);
  assert.match(bootstrap, /convertedTaskId: projectIssues\.convertedTaskId/);
  assert.match(dashboard, /sortHeader\("issueLink", "Issue Link"\)/);
  assert.match(dashboard, /record-link-button/);
  assert.match(dashboard, /props\.openIssue\(issueLink\)/);
  assert.match(dashboard, /openProjectWorkspace\(link\.projectCode, "issues"\)/);
  assert.match(issuesModule, /onIssueChanged\(data\.issue\)/);
  assert.match(dashboard, /className="employee-task-live-pulse"/);
  assert.match(dashboard, /<th>Task<\/th><th>Created By<\/th><th>Created Date<\/th><th>Due Date<\/th>/);
  assert.match(dashboard, /<th>Hours<\/th><th>Indicator<\/th>/);
  assert.match(dashboard, /tableStatusLabel\[task\.status\]/);
  assert.match(dashboard, /tableCheckLabel\[task\.managerCheck\]/);
  assert.match(styles, /\.employee-task-live-pulse \{[^}]*animation: activeWorkPulse/);
});

test("V104 converts tasks to linked issues and color-codes the originating record", async () => {
  const [dashboard, issueModule, issueApi, convertApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/issues/route.ts"),
    source("app/api/tasks/convert-to-issue/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /sortHeader\("indicator", "Indicator"\).*sortHeader\("issueLink", "Issue Link"\)/s);
  assert.match(dashboard, /className="form-section task-to-issue-section"/);
  assert.match(dashboard, /fetch\("\/api\/tasks\/convert-to-issue"/);
  assert.match(convertApi, /convertedTaskId: task\.id/);
  assert.match(convertApi, /issueNumber\(task\.project, discipline, sequence\)/);
  assert.match(convertApi, /Only the owner or a manager can convert a task to an issue/);
  assert.match(issueApi, /linkedTaskCreatedAt/);
  assert.match(issueModule, /Task #\{issue\.convertedTaskId\}/);
  assert.match(issueModule, /issueFirst \? "issue-first" : "task-first"/);
  assert.match(dashboard, /task\.createdAt <= issueLink\.createdAt \? "task-first" : "issue-first"/);
  assert.match(styles, /\.record-link-button\.issue-first/);
  assert.match(styles, /\.record-link-button\.task-first/);
});

test("V105 labels both conversion directions and places the full-width task conversion area after notes", async () => {
  const [dashboard, issuesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /"Converted to Issue" : "Converted from Issue"/);
  assert.match(issuesModule, /selectedIssueFirst \? "Converted to Task" : "Converted from Task"/);
  assert.ok(dashboard.indexOf('className="form-section comments-section"') < dashboard.indexOf('className="form-section task-to-issue-section"'));
  assert.match(styles, /\.task-to-issue-section \{[^}]*width: 100%;[^}]*background: #f7f2ff;[^}]*border: 0;[^}]*box-shadow:/);
  assert.doesNotMatch(styles, /\.task-to-issue-section \{[^}]*border-left:/);
  assert.match(dashboard, /setTaskDrawerOpen\(false\); setSelectedTaskId\(null\); window\.setTimeout\(\(\) => openLinkedIssue\(link\), 0\)/);
});

test("V106 unifies Arabic typography, bilingual task toasts, and narrows the employee task dialog", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(styles, /font-family: "HINDAZA Arabic"/);
  assert.match(styles, /unicode-range: U\+0600-06FF/);
  assert.match(styles, /--font-ui: "HINDAZA Arabic", Arial/);
  assert.match(styles, /\.employee-tasks-dialog \{[^}]*height: 90vh;/);
  assert.match(dashboard, /Task updated successfully · تم تحديث المهمة بنجاح/);
  assert.match(dashboard, /Task note added successfully · تمت إضافة الملاحظة إلى سجل المهمة/);
  assert.match(dashboard, /Task timer started · بدأ تسجيل وقت المهمة/);
  assert.doesNotMatch(dashboard, /setToast\("تم/);
});

test("V107 enlarges the employee task dialog by ten percent without changing its height", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /\.employee-tasks-dialog \{[^}]*width: 81\.4vw; height: 90vh; max-width: 1549px;/);
});

test("V108 adds an employee settings shortcut beside the lighter print icon", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /onEditEmployee=\{openUserFromEmployeeTasks\}/);
  assert.match(dashboard, /className="employee-tasks-settings"[^>]*onClick=\{\(\) => onEditEmployee\(employee\)\}/);
  assert.match(styles, /\.employee-tasks-print, \.employee-tasks-settings \{[^}]*background: var\(--yellow\);/);
  assert.match(styles, /\.employee-tasks-print svg \{[^}]*stroke-width: 1\.65;/);
});

test("V109 returns from employee editing to the task dialog and opens tasks from the full row", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /function openUserFromEmployeeTasks\(user: User\)/);
  assert.match(dashboard, /hindazaEmployeeTasks: null, hindazaEmployeeEdit: user\.email/);
  assert.match(dashboard, /if \(employeeTasksState\) \{[\s\S]*?setUserDrawerOpen\(false\);[\s\S]*?setUserDrawerReturnToEmployeeTasks\(null\);/);
  assert.match(dashboard, /if \(!open && \(userDrawerReturnToEmployeeTasks \|\| userDrawerReturnToReport\)\) \{ window\.history\.back\(\); return; \}/);
  assert.match(dashboard, /className="employee-task-clickable-row"[^>]*onClick=\{\(event\) => \{[^}]*onOpenTask\(task\);/);
  assert.match(dashboard, /<td><a href=\{href\} onClick=\{openTaskLink\}>\{task\.createdByName/);
  assert.match(styles, /\.employee-task-table tbody tr\.employee-task-clickable-row \{ cursor: pointer; \}/);
});

test("V110 opens account details from the user identity and shows sidebar image upload progress", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /const \[profileImageProgress, setProfileImageProgress\] = useState\(0\)/);
  assert.match(dashboard, /uploadProfileImageFile\(image, currentUser\?\.email \|\| "", setProfileImageProgress\)/);
  assert.match(dashboard, /className=\{`sidebar-user-trigger\$\{accountMenuOpen \? " open" : ""\}`\}/);
  assert.match(dashboard, /className="sidebar-photo-progress"[\s\S]*?aria-valuenow=\{profileImageProgress\}/);
  assert.doesNotMatch(dashboard, /className=\{`account-toggle/);
  assert.match(styles, /\.sidebar-user-trigger \{[^}]*width: 100%;/);
  assert.match(styles, /\.sidebar-photo-progress::before \{[^}]*conic-gradient/);
  assert.match(dashboard, /async function exportActivityExcel\(\)/);
  assert.match(dashboard, /currentUser\?\.role !== "owner" \|\| activity\.length === 0/);
  assert.match(dashboard, /sheet name="Activity Log"/);
  assert.match(dashboard, /zip\.file\("xl\/media\/report-logo\.png", logo\)/);
  assert.match(dashboard, /HINDAZA_activity_log_\$\{localToday\(\)\}\.xlsx/);
  assert.match(dashboard, /exportActivityExcel/);
  assert.match(styles, /\.activity-heading-actions \{/);
});

test("V111 uses yellow activity icons, unified linked-record actions, and creator image metadata", async () => {
  const [dashboard, issuesModule, bootstrap, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/bootstrap/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /className="activity-icon-button activity-excel-icon"/);
  assert.match(dashboard, /className="activity-icon-button activity-refresh-icon"/);
  assert.match(styles, /\.activity-icon-button \{[^}]*background: var\(--yellow\);/);
  assert.match(styles, /\.task-to-issue-section \.record-link-button, \.issue-convert \.record-link-button, \.task-to-issue-section \.convert-issue-button, \.issue-convert \.convert-task-button \{[^}]*width: 100%;[^}]*min-height: 43px;[^}]*font-family: var\(--font-ui\);[^}]*font-size: 10px;/);
  assert.match(issuesModule, /className=\{`linked-task-panel record-link-button/);
  assert.match(bootstrap, /createdByProfileImageKey: profileImageByEmail\.get\(task\.createdBy\.toLowerCase\(\)\) \|\| ""/);
  assert.match(dashboard, /profileImageKey: task\.createdByProfileImageKey \|\| ""/);
});

test("V112 uses reference-inspired refresh, Excel, and PDF icons on yellow buttons", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /function ActionIcon\(\{ kind \}: \{ kind: "refresh" \| "excel" \| "pdf" \}\)/);
  assert.match(dashboard, /<ActionIcon kind="refresh" \/>/);
  assert.equal((dashboard.match(/<ActionIcon kind="excel" \/>/g) || []).length, 2);
  assert.match(dashboard, /<ActionIcon kind="pdf" \/>/);
  assert.match(dashboard, /className="report-download-icon-button excel-button"/);
  assert.match(dashboard, /className="report-download-icon-button pdf-button"/);
  assert.match(styles, /\.report-download-icon-button \{[^}]*background: var\(--yellow\);/);
  assert.match(styles, /\.refresh-action-icon \{[^}]*stroke-width: 2\.8;/);
  assert.match(styles, /\.pdf-action-icon text \{[^}]*font-weight: 900;/);
});

test("V113 makes reports English, review-based, printable, and fully drillable", async () => {
  const [dashboard, issues, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /type ReportMetric = "all" \| "approved" \| "wip" \| "pending"/);
  assert.match(dashboard, /<h2>Task Report Settings<\/h2>/);
  assert.match(dashboard, /Manager Approved/);
  assert.match(dashboard, /Needs Review/);
  assert.match(dashboard, /Returned/);
  assert.match(dashboard, /function ReportTasksDialog/);
  assert.match(dashboard, /hindazaReportTasks: metric/);
  assert.match(dashboard, /function openReportRow\(key: string\)/);
  assert.match(dashboard, /\.logo\{display:block;width:220px;/);
  assert.match(dashboard, /<div class="legend">/);
  assert.match(dashboard, /print-color-adjust:exact/);
  assert.match(dashboard, /cx="2286000" cy="833000"/);
  assert.doesNotMatch(issues, /<p>Issue totals and status by project<\/p>/);
  assert.doesNotMatch(issues, /تقرير أولي لمشاكل المشاريع/);
  assert.match(styles, /\.report-filter-stats button \{/);
  assert.match(styles, /\.bar-approved, \.legend-approved \{ background: #2f8a64; \}/);
});

test("V114 adds counted report bars, printable issue drilldowns, and stable navigation", async () => {
  const [dashboard, issues, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /const displayedReportRows = reportRows/);
  assert.match(dashboard, /row\.projectCount\} projects/);
  assert.match(dashboard, /row\.approved > 0 && <b>\{row\.approved\}<\/b>/);
  assert.match(dashboard, /function ReportTasksDialog/);
  assert.match(dashboard, /printReportTasks/);
  assert.match(dashboard, /Print report tasks as PDF/);
  assert.doesNotMatch(dashboard, /<table><thead><tr><th>Group<\/th><th>Total Tasks/);
  assert.match(issues, /type IssueReportMetric = "all" \| "open" \| "re_open" \| "closed"/);
  assert.match(issues, /function IssueReportDialog/);
  assert.match(issues, /hindazaIssueReport/);
  assert.match(issues, /Print report issues as PDF/);
  assert.match(issues, /Project Issues Status/);
  assert.match(issues, /onOpenIssue: \(id: number, projectCode: string\) => void/);
  assert.match(styles, /\.issue-report-track i b/);
  assert.match(styles, /\.report-tasks-dialog \.employee-task-table \{ min-width: 1180px; \}[\s\S]*?\.report-tasks-dialog \.employee-task-table \{ table-layout: fixed; \}/);
  assert.match(styles, /\.issue-report-dialog \.employee-task-table \{ min-width: 1120px; table-layout: fixed; \}/);
});

test("V115 uses calendar reports and dedicated task and issue project dialogs", async () => {
  const [dashboard, issues, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /useState<"week" \| "month" \| "custom">\("month"\)/);
  assert.match(dashboard, /<span>Calendar Period<\/span>/);
  assert.match(dashboard, /<option value="custom">Custom Range<\/option>/);
  assert.match(dashboard, /type=\{reportPeriod === "week" \? "week" : "month"\}/);
  assert.match(dashboard, /className="period-nav"/);
  assert.doesNotMatch(dashboard, /Filter \{reportGroup === "project" \? "Project" : "Employee"\} Names/);
  assert.doesNotMatch(dashboard, /Weekly or monthly, grouped by project or employee/);
  assert.match(dashboard, /className="report-project-count"/);
  assert.match(dashboard, /hindazaReportRow/);
  assert.match(dashboard, /report-dialog-filterbar/);
  assert.match(dashboard, /Open Project Tasks/);
  assert.match(dashboard, /reportRowKey && <ReportTasksDialog/);
  assert.match(issues, /hindazaIssueProject/);
  assert.match(issues, /openProjectIssues/);
  assert.match(issues, />Open<\/button>/);
  assert.match(issues, /setStatusView\("closed"\)/);
  assert.match(issues, /openMetric\("closed"\)/);
  assert.doesNotMatch(issues, /Filter Project Names/);
  assert.match(styles, /\.report-project-count/);
  assert.match(styles, /\.report-dialog-filterbar/);
  assert.match(styles, /\.issue-report-scroll/);
});

test("V116 restores report period navigation and refines task and issue dialogs", async () => {
  const [dashboard, issues, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /const customRangeInvalid = reportPeriod === "custom"/);
  assert.match(dashboard, /min=\{reportCustomStart \|\| undefined\}/);
  assert.match(dashboard, /To date must be the same as or after From date\./);
  assert.match(dashboard, /reportPeriod !== "custom" \? <div className="period-nav"/);
  assert.match(dashboard, /employee=\{reportGroup === "employee"/);
  assert.match(dashboard, /onProjectSettings=\{openReportProjectSettings\}/);
  assert.match(dashboard, /onEmployeeSettings=\{openReportEmployeeSettings\}/);
  assert.match(dashboard, /event\.key === "Escape"/);
  assert.match(issues, /ref=\{issueGroupsRef\} onWheel=\{handleIssueWheel\}/);
  assert.match(issues, /\{projectCode && <th>Attachments<\/th>\}/);
  assert.match(issues, /issue\.attachmentCount \?\? issue\.attachments\.length/);
  assert.doesNotMatch(issues, /Issue totals and status by project/);
  assert.match(styles, /\.report-project-count \{ display: block;/);
  assert.match(styles, /\.issue-report-track \{ direction: ltr;[^}]*display: flex;/);
  assert.match(styles, /\.report-date-warning/);
});

test("V117 returns from report settings and adds project controls and issue status colors", async () => {
  const [dashboard, issues, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /hindazaReportProjectEdit: project\.id/);
  assert.match(dashboard, /hindazaReportEmployeeEdit: user\.email/);
  assert.match(dashboard, /projectDrawerReturnToReport/);
  assert.match(dashboard, /userDrawerReturnToReport/);
  assert.match(dashboard, /if \(!open && \(projectDrawerReturnToReport \|\| projectDrawerReturnToUserEmail\)\) \{ window\.history\.back\(\); return; \}/);
  assert.match(dashboard, /userDrawerReturnToEmployeeTasks \|\| userDrawerReturnToReport/);
  assert.match(issues, /onProjectSettings: \(project: IssueProject\) => void/);
  assert.match(issues, /title="Project settings">⚙<\/button>/);
  assert.match(issues, /row\.open > 0 && <b>\{row\.open\}<\/b>/);
  assert.match(issues, /row\.reopen > 0 && <b>\{row\.reopen\}<\/b>/);
  assert.match(issues, /row\.closed > 0 && <b>\{row\.closed\}<\/b>/);
  assert.match(styles, /\.issue-bar-open, \.legend-issue-open \{ background: #cf3e47; \}/);
  assert.match(styles, /\.issue-bar-reopen, \.legend-issue-reopen \{ background: #e18421; \}/);
  assert.match(styles, /\.issue-bar-closed, \.legend-issue-closed \{ background: #2f8b63; \}/);
});

test("V118 normalizes each report status line and centers non-zero counts", async () => {
  const [dashboard, issues, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /reportGroup === "project" \? "Project Task Review" : "Employee Task Review"/);
  assert.doesNotMatch(dashboard, /Comparison by project|Comparison by employee|Task Review Breakdown/);
  assert.match(dashboard, /row\.approved \/ row\.total/);
  assert.match(dashboard, /value \/ Math\.max\(1, row\.total\)/);
  assert.doesNotMatch(dashboard, /maxReportTotal/);
  assert.match(issues, /Project Issues Status/);
  assert.doesNotMatch(issues, /Issue Status Breakdown|Comparison by project/);
  assert.match(issues, /row\.open \/ row\.total/);
  assert.match(issues, /row\.open > 0 && <b>\{row\.open\}<\/b>/);
  assert.doesNotMatch(issues, /issue-report-counts|const maximum/);
  assert.match(styles, /\.issue-report-track i b \{[^}]*place-items: center;/);
});

test("V119 ignores cleared or invalid report calendar values without crashing", async () => {
  const dashboard = await source("app/task-dashboard.tsx");
  assert.match(dashboard, /function changeReportCalendar\(value: string\)/);
  assert.match(dashboard, /if \(!value\) return;/);
  assert.match(dashboard, /if \(\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(value\)\) setReportAnchor\(`\$\{value\}-01`\)/);
  assert.match(dashboard, /value\.match\(\/\^\(\\d\{4\}\)-W\(\\d\{2\}\)\$\/\)/);
  assert.match(dashboard, /onChange=\{\(event\) => changeReportCalendar\(event\.currentTarget\.value\)\}/);
  assert.doesNotMatch(dashboard, /setReportAnchor\(`\$\{event\.target\.value\}-01`\)/);
});

test("V120 uses project names and codes in task reports and expands small report dialogs", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /function projectReportLabel\(projects: Project\[\], code: string\)/);
  assert.match(dashboard, /return project \? `\$\{project\.name\} \(\$\{project\.code\}\)` : code/);
  assert.match(dashboard, /label: reportGroup === "project" \? projectReportLabel\(projects, key\) : key/);
  assert.match(dashboard, /<option key=\{code\} value=\{code\}>\{projectReportLabel\(projects, code\)\}<\/option>/);
  assert.match(dashboard, /title=\{reportGroup === "project" \? projectReportLabel\(projects, reportRowKey\) : reportRowKey\}/);
  assert.match(dashboard, /useState<"week" \| "month" \| "custom">\("month"\)/);
  assert.match(dashboard, /report-task-group-count-\$\{Math\.min\(groups\.length, 3\)\}/);
  assert.match(dashboard, /className="report-date-warning"/);
  assert.match(styles, /\.report-tasks-dialog \.report-task-group-count-1 \.employee-task-table-wrap\.has-more-tasks \{ max-height: calc\(90vh - 245px\); \}/);
  assert.match(styles, /\.report-tasks-dialog \.report-task-group-count-2 \.employee-task-table-wrap\.has-more-tasks/);
});

test("V121 allows same-day custom reports and warns only when To precedes From", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /reportCustomEnd < reportCustomStart/);
  assert.doesNotMatch(dashboard, /reportCustomEnd <= reportCustomStart/);
  assert.match(dashboard, /min=\{reportCustomStart \|\| undefined\}/);
  assert.match(dashboard, /To date must be the same as or after From date\./);
  assert.match(styles, /\.report-date-warning/);
});

test("V122 sends email best-effort after preserving every in-app notification", async () => {
  const [delivery, tasksApi, taskComments, taskSubtasks, taskTimer, issuesApi, issueComments, issueConvert] = await Promise.all([
    source("lib/notification-delivery.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/task-comments/route.ts"),
    source("app/api/task-subtasks/route.ts"),
    source("app/api/task-timer/route.ts"),
    source("app/api/issues/route.ts"),
    source("app/api/issue-comments/route.ts"),
    source("app/api/issues/convert/route.ts"),
  ]);
  assert.match(delivery, /EMAIL_NOTIFICATIONS_ENABLED/);
  assert.match(delivery, /await db\.insert\(notifications\)\.values\(payloads\)/);
  assert.match(delivery, /Email delivery failed; the in-app notification was preserved/);
  for (const route of [tasksApi, taskComments, taskSubtasks, taskTimer, issuesApi, issueComments, issueConvert]) {
    assert.match(route, /createNotifications/);
  }
});

test("V123 sends notification email through Cloudflare without embedding credentials", async () => {
  const [delivery, readme] = await Promise.all([
    source("lib/notification-delivery.ts"),
    source("README.md"),
  ]);
  assert.match(delivery, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(delivery, /CLOUDFLARE_EMAIL_API_TOKEN/);
  assert.match(delivery, /api\.cloudflare\.com\/client\/v4\/accounts/);
  assert.match(delivery, /email\/sending\/send/);
  assert.match(delivery, /result\?\.success === false/);
  assert.doesNotMatch(delivery, /0cd81fe600d9478279869856357fd9af/);
  assert.match(readme, /HINDAZA Projects <pm@hindaza\.com>/);
  assert.match(readme, /Account → Email Sending → Edit/);
});

test("V124 formats the Cloudflare sender display name as a named address", async () => {
  const delivery = await source("lib/notification-delivery.ts");
  assert.match(delivery, /function senderAddress\(value: string\)/);
  assert.match(delivery, /return \{ address: namedAddress\[2\], name: namedAddress\[1\]/);
  assert.match(delivery, /from: senderAddress\(environment\.EMAIL_FROM\)/);
});

test("V130 links the header company logo to the application home", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /<a className="brand-block" href="https:\/\/pm\.hindaza\.com\/"/);
  assert.match(dashboard, /aria-label="Go to HINDAZA Project Management home"/);
  assert.match(styles, /\.brand-block:focus-visible/);
});

test("V131 opens on overview and adds task progress, actor-aware email, project member email, and management timer pause", async () => {
  const [dashboard, styles, schema, init, tasksApi, timerApi, delivery, migration, backfill] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("db/schema.ts"),
    source("lib/db-init.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/task-timer/route.ts"),
    source("lib/notification-delivery.ts"),
    source("drizzle/0017_colorful_misty_knight.sql"),
    source("drizzle/0018_backfill_task_completion.sql"),
  ]);
  assert.match(dashboard, /return tabValues\.includes\(value as Tab\) \? value as Tab : "overview";/);
  assert.match(dashboard, /className="project-member-email" dir="ltr">\{user\.email\}/);
  assert.match(dashboard, /const taskCompletionOptions = \[0, 25, 50, 75, 100\] as const/);
  assert.match(dashboard, /function TaskProgressControl/);
  assert.match(dashboard, /<th>Task<\/th>/);
  assert.match(dashboard, /canPauseEmployeeTimer/);
  assert.match(dashboard, /Pause Employee Timer/);
  assert.match(styles, /\.task-progress-circle/);
  assert.match(schema, /completionPercent: integer\("completion_percent"\)\.notNull\(\)\.default\(0\)/);
  assert.match(init, /ALTER TABLE tasks ADD COLUMN completion_percent INTEGER DEFAULT 0 NOT NULL/);
  assert.match(migration, /ADD `completion_percent` integer DEFAULT 0 NOT NULL/);
  assert.match(backfill, /WHERE `status` = 'done' AND `completion_percent` = 0/);
  assert.match(tasksApi, /action === "update_completion"/);
  assert.match(tasksApi, /\[0, 25, 50, 75, 100\]\.includes/);
  assert.match(timerApi, /managementPause/);
  assert.match(timerApi, /task\.employeeEmail/);
  assert.match(delivery, /actorName\?: string/);
  assert.match(delivery, /\? "Created By" : "Action By"/);
});

test("V132 moves progress into the task field and restores it when review is returned", async () => {
  const [dashboard, styles, schema, init, tasksApi, timerApi, migration] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("db/schema.ts"),
    source("lib/db-init.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/task-timer/route.ts"),
    source("drizzle/0019_quiet_mikhail_rasputin.sql"),
  ]);
  assert.match(dashboard, /sortHeader\("title", "Task"\).*sortHeader\("employee", "Employee"\).*sortHeader\("createdBy", "Created By"\)/s);
  assert.doesNotMatch(dashboard, /className="task-progress-value"/);
  assert.match(dashboard, /className="wide task-title-field"/);
  assert.match(dashboard, /task-title-drawer-progress/);
  assert.match(dashboard, /<span>\{completionPercent\}%<\/span>/);
  assert.match(dashboard, /hsl\(\$\{completionPercent \* 1\.2\} 68% 43%\)/);
  assert.match(dashboard, /completingTask \? "POST" : "PATCH"/);
  assert.match(dashboard, /\? \{ taskId, action: "finish" \}/);
  assert.match(styles, /box-shadow: 0 0 0 2px var\(--task-progress-color\)/);
  assert.match(schema, /completionBeforeReview: integer\("completion_before_review"\)\.notNull\(\)\.default\(0\)/);
  assert.match(init, /ALTER TABLE tasks ADD COLUMN completion_before_review INTEGER DEFAULT 0 NOT NULL/);
  assert.match(migration, /ADD `completion_before_review` integer DEFAULT 0 NOT NULL/);
  assert.match(timerApi, /completionBeforeReview: submitForReview \? task\.completionPercent : task\.completionBeforeReview/);
  assert.match(tasksApi, /const returningForRevision = movingToReturned && \["pending", "approved"\]\.includes\(existing\[0\]\.managerCheck\)/);
  assert.match(tasksApi, /\? existing\[0\]\.completionBeforeReview/);
  assert.match(tasksApi, /Task completion is locked during or after manager review/);
});

test("V133 scopes reports, protects project manager assignment, and shows progress across task dialogs", async () => {
  const [dashboard, styles, bootstrap, projectsApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("app/api/bootstrap/route.ts"),
    source("app/api/projects/route.ts"),
  ]);
  assert.match(dashboard, /className="task-title-input-row"/);
  assert.match(styles, /\.task-title-input-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 42px;/);
  assert.match(dashboard, /function canEditTaskCompletion/);
  assert.match(dashboard, /className="window-task-title-progress"/);
  assert.match(dashboard, /hideEmployeeColumn=\{reportGroup === "employee"\}/);
  assert.match(dashboard, /\{!hideEmployeeColumn && <th>Employee<\/th>\}/);
  assert.match(dashboard, /\{!hideEmployeeColumn && <select value=\{employeeFilter\}/);
  assert.match(dashboard, /className="assigned-project-settings"/);
  assert.match(dashboard, /hindazaUserProjectEdit: project\.id/);
  assert.match(dashboard, /projectDrawerReturnToUserEmail/);
  assert.match(dashboard, /disabled=\{!owner \|\| !selected\}/);
  assert.match(dashboard, /const reportEligibleTasks = useMemo\(\(\) => tasks\.filter\(\(task\) => reportProjectCodes\.has\(task\.project\)\)/);
  assert.match(dashboard, /const reportEmployees = useMemo/);
  assert.match(bootstrap, /assignedProjectMemberEmails/);
  assert.match(bootstrap, /managedProjectMemberEmails/);
  assert.match(bootstrap, /allProjectRows\.filter\(\(project\) => assignedProjectIds\.has\(project\.id\)\)/);
  assert.match(projectsApi, /currentRows[\s\S]*?filter\(\(row\) => row\.isProjectManager && assignedMembers\.includes\(row\.employeeEmail\)\)/);
});

test("V134 separates task completion, defaults projects to unapproved, reorders review, and counts report employees", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /reviewFilter === "unapproved" \? task\.managerCheck !== "approved"/);
  assert.match(dashboard, /setReviewFilter\("unapproved"\)/);
  assert.match(dashboard, /<option value="unapproved">Unapproved<\/option>/);
  assert.match(dashboard, /const allProjectTasks = useMemo/);
  assert.match(dashboard, /\["new", "pending", "returned", "approved"\] as const/);
  assert.match(dashboard, /<div className="wide task-title-field"><label htmlFor="task-title-input">/);
  assert.match(dashboard, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(dashboard, /employeeCount: new Set/);
  assert.match(dashboard, /row\.employeeCount} employees/);
  assert.match(styles, /\.task-title-field > label/);
});

test("V135 restores the nearest populated task report period and places Approved last", async () => {
  const dashboard = await source("app/task-dashboard.tsx");
  assert.match(dashboard, /const reportAnchorAutoSelectedRef = useRef\(false\)/);
  assert.match(dashboard, /reportEligibleTasks\.some\(\(task\) => task\.taskDate >= visibleRange\.start && task\.taskDate <= visibleRange\.end\)/);
  assert.match(dashboard, /dates\.filter\(\(date\) => date <= localToday\(\)\)\.at\(-1\) \|\| dates\[0\]/);
  assert.match(dashboard, /stat-card amber[\s\S]*?projectStats\.returned[\s\S]*?stat-card green[\s\S]*?projectStats\.approved/);
  assert.match(dashboard, /stat-card amber[\s\S]*?stats\.returned[\s\S]*?stat-card green[\s\S]*?stats\.approved/);
});

test("V136 keeps task progress migrations explicit and returns safe task errors", async () => {
  const [init, tasksApi] = await Promise.all([
    source("lib/db-init.ts"),
    source("app/api/tasks/route.ts"),
  ]);
  assert.match(init, /if \(process\.env\.NODE_ENV === "production"\) return true/);
  assert.match(init, /ALTER TABLE tasks ADD COLUMN completion_percent INTEGER DEFAULT 0 NOT NULL/);
  assert.match(init, /ALTER TABLE tasks ADD COLUMN completion_before_review INTEGER DEFAULT 0 NOT NULL/);
  assert.match(tasksApi, /console\.error\("Unable to create task", error\)/);
  assert.match(tasksApi, /Unable to create the task right now\. Please retry\./);
  assert.doesNotMatch(tasksApi, /\{ error: error instanceof Error \? error\.message : "Unable to create task" \}/);
});

test("V137 names the task creator explicitly in assignment emails", async () => {
  const [tasksApi, delivery] = await Promise.all([
    source("app/api/tasks/route.ts"),
    source("lib/notification-delivery.ts"),
  ]);
  assert.match(tasksApi, /type: "task_assigned"[\s\S]*?actorName: currentUser\.displayName/);
  assert.match(delivery, /notification\.type === "task_assigned" \? "Created By" : "Action By"/);
  assert.match(delivery, /\{ label: actorLabel, value: notification\.actorName \}/);
});

test("V138 sends an explicit Created By label with every new task assignment", async () => {
  const [tasksApi, delivery] = await Promise.all([
    source("app/api/tasks/route.ts"),
    source("lib/notification-delivery.ts"),
  ]);
  assert.match(tasksApi, /type: "task_assigned"[\s\S]*?actorName: currentUser\.displayName,[\s\S]*?actorLabel: "Created By"/);
  assert.match(delivery, /actorLabel\?: string/);
  assert.match(delivery, /notification\.actorLabel \|\| \(notification\.type === "task_assigned" \? "Created By" : "Action By"\)/);
});

test("V139 keeps owner private tasks, expands live indicators, and improves navigation, team, and exports", async () => {
  const [bootstrap, tasksApi, dashboard, styles] = await Promise.all([
    source("app/api/bootstrap/route.ts"),
    source("app/api/tasks/route.ts"),
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(bootstrap, /currentUser\.role === "owner"[\s\S]*?task\.visibility === "team"[\s\S]*?task\.submittedToManager[\s\S]*?task\.createdBy === currentUser\.email[\s\S]*?task\.employeeEmail === currentUser\.email/);
  assert.match(dashboard, /createdBy: task\.createdBy/);
  assert.match(dashboard, /currentUser\?\.role === "owner"[\s\S]*?assignment-created-by[\s\S]*?updateForm\("createdBy"/);
  assert.match(tasksApi, /const requestedCreatedBy = currentUser\.role === "owner"/);
  assert.match(tasksApi, /Created By changed from/);
  assert.match(dashboard, /projectSwitcherSearch/);
  assert.match(dashboard, /placeholder="Search project\.\.\."/);
  assert.match(styles, /\.project-switcher-search/);
  assert.match(dashboard, /a\.displayName\.localeCompare\(b\.displayName/);
  assert.match(styles, /\.team-management-table td \{ padding-top: 8px; padding-bottom: 8px;/);
  assert.match(dashboard, /className="task-progress-live-wrap"/);
  assert.match(dashboard, /report-detail-table/);
  assert.match(dashboard, /\$\{reportTable\}<div class="footer">/);
  assert.doesNotMatch(dashboard, /<table className="report-detail-table"/);
});

test("V143 scopes production reads so workspace loading stays responsive", async () => {
  const [bootstrap, taskCounts, issuesApi, dashboard, schema, migration] = await Promise.all([
    readFile("app/api/bootstrap/route.ts", "utf8"),
    readFile("app/api/task-counts/route.ts", "utf8"),
    readFile("app/api/issues/route.ts", "utf8"),
    readFile("app/task-dashboard.tsx", "utf8"),
    readFile("db/schema.ts", "utf8"),
    readFile("drizzle/0020_tired_miracleman.sql", "utf8"),
  ]);
  assert.doesNotMatch(bootstrap, /allCommentRows|allSubtaskRows|allTaskAttachmentRows/);
  assert.match(bootstrap, /timeEntriesMode: "active"/);
  assert.match(taskCounts, /TASK_QUERY_CHUNK_SIZE = 90/);
  assert.match(bootstrap, /isNull\(taskTimeEntries\.endedAt\)/);
  assert.match(bootstrap, /isNotNull\(projectIssues\.convertedTaskId\)/);
  assert.match(bootstrap, /\.limit\(200\)/);
  assert.match(bootstrap, /process\.env\.NODE_ENV !== "production" && isManagement\(currentUser\)/);
  assert.match(issuesApi, /summaryOnly = url\.searchParams\.get\("summary"\) === "1"/);
  assert.match(issuesApi, /requestedProject \? eq\(projectIssues\.projectCode, requestedProject\) : undefined/);
  assert.match(dashboard, /fetch\("\/api\/issues\?summary=1"/);
  assert.match(dashboard, /setInterval\(refresh, 60_000\)/);
  assert.match(schema, /project_issues_converted_task_idx/);
  assert.match(migration, /CREATE INDEX `tasks_project_created_idx`/);
});

test("V142 places live pulses after task names and keeps newly invited discipline members visible to managers", async () => {
  const [bootstrap, dashboard, css] = await Promise.all([
    readFile("app/api/bootstrap/route.ts", "utf8"),
    readFile("app/task-dashboard.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);
  assert.match(bootstrap, /user\.role === "member" && user\.discipline === currentUser\.discipline/);
  assert.match(dashboard, /const livePulse = task\.status === "in_progress"/);
  assert.match(css, /\.task-title-progress \.task-progress-live-wrap > \.employee-task-live-pulse/);
  assert.match(css, /\.task-table tbody tr:has\(\.live-hours\) \.task-title-progress::after/);
  assert.match(dashboard, /<span className="employee-task-title"><strong dir="auto">\{task\.title\}<\/strong>\{active && <i className="employee-task-live-pulse"/);
  assert.match(css, /\.employee-task-title \{[^}]*flex-direction: row;[^}]*direction: ltr;/);
});

test("V144 keeps report pulses on the task right and removes hidden high-volume bottlenecks", async () => {
  const [dashboard, issuesModule, issuesApi, backupApi, projectsApi, timerApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/issues/route.ts"),
    source("app/api/backup/route.ts"),
    source("app/api/projects/route.ts"),
    source("app/api/task-timer/route.ts"),
  ]);
  assert.match(dashboard, /const timeEntriesByTaskId = useMemo\(\(\) => rowsByTaskId\(timeEntries\)/);
  assert.match(dashboard, /const activeTaskIds = useMemo/);
  assert.match(dashboard, /<span className="employee-task-title"><strong dir="auto">\{task\.title\}<\/strong>\{active && <i className="employee-task-live-pulse"/);
  assert.match(issuesModule, /fetchIssues\("", true\)/);
  assert.match(issuesModule, /Unable to load issue report/);
  assert.match(issuesApi, /reportOnly = url\.searchParams\.get\("report"\) === "1"/);
  assert.match(issuesApi, /issues: await issueRows\(existing\.projectCode\)/);
  assert.match(backupApi, /await db\.batch\(\[/);
  assert.match(projectsApi, /const \[\[taskCount\], \[issueCount\], \[teamCount\]\] = await db\.batch/);
  assert.match(timerApi, /const \[taskRows, entryRows\] = await db\.batch/);
});

test("V145 renders the workspace before loading task history and fetches task details on demand", async () => {
  const [bootstrap, taskDetails, taskCounts, dashboard] = await Promise.all([
    source("app/api/bootstrap/route.ts"),
    source("app/api/task-details/route.ts"),
    source("app/api/task-counts/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.doesNotMatch(bootstrap, /from\(taskComments\)/);
  assert.doesNotMatch(bootstrap, /from\(taskSubtasks\)/);
  assert.doesNotMatch(bootstrap, /from\(taskAttachments\)/);
  assert.match(taskCounts, /groupBy\(taskComments\.taskId\)/);
  assert.match(taskCounts, /groupBy\(taskSubtasks\.taskId\)/);
  assert.match(taskCounts, /groupBy\(taskAttachments\.taskId\)/);
  assert.match(bootstrap, /isNull\(taskTimeEntries\.endedAt\)/);
  assert.match(bootstrap, /timeEntriesMode: "active"/);
  assert.match(taskDetails, /taskForView\(db, currentUser, taskId\)/);
  assert.match(taskDetails, /await Promise\.all\(\[/);
  assert.match(dashboard, /fetchTaskDetails\(taskId/);
  assert.match(dashboard, /taskDetailsLoaderRef\.current\(task\.id\)/);
  assert.match(dashboard, /current\.filter\(\(row\) => row\.taskId !== taskId\)/);
});

test("V146 expands governed task collaboration, aggregate team status, linked cleanup, and future project modules", async () => {
  const [dashboard, styles, bootstrap, tasksApi, projectsApi, taskAccess, conversionApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
    source("app/api/bootstrap/route.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/projects/route.ts"),
    source("lib/task-access.ts"),
    source("app/api/tasks/convert-to-issue/route.ts"),
  ]);
  assert.match(taskAccess, /export async function canManageTask/);
  assert.match(taskAccess, /Boolean\(membership\.isProjectManager\) \|\| Boolean\(task\.originatedByEmail\) \|\| task\.submittedToManager/);
  assert.match(tasksApi, /requestedCheck === "approved"/);
  assert.match(tasksApi, /completionPercent:[\s\S]*?approving[\s\S]*?100/);
  assert.match(tasksApi, /insert\(taskTimeEntries\)/);
  assert.match(tasksApi, /set\(\{ convertedTaskId: null/);
  assert.match(projectsApi, /Only the owner can assign or remove project managers/);
  assert.match(conversionApi, /Only the task creator, project manager, or owner/);
  assert.match(bootstrap, /teamMetrics/);
  assert.match(bootstrap, /activeTaskIds\.has\(task\.id\)/);
  assert.match(dashboard, /className="team-employee-name"/);
  assert.match(dashboard, /TaskRecordIndicators task=\{task\}/);
  assert.match(dashboard, /projectWorkspaceTab === "notes"/);
  assert.match(dashboard, /projectWorkspaceTab === "mom"/);
  assert.match(styles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.task-title-drawer-progress \{ position: relative; z-index: 1;/);
});

test("V147 keeps bootstrap to one D1 batch and loads task counters after the workspace is visible", async () => {
  const [bootstrap, taskCounts, dashboard] = await Promise.all([
    source("app/api/bootstrap/route.ts"),
    source("app/api/task-counts/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(bootstrap, /await db\.batch\(\[/);
  assert.doesNotMatch(bootstrap, /for \(const taskIds of chunks/);
  assert.match(bootstrap, /Detail counters are intentionally deferred to \/api\/task-counts/);
  assert.match(taskCounts, /const \[userRows, projectRows, membershipRows, taskRows\] = await db\.batch/);
  assert.match(taskCounts, /const \[commentRows, subtaskRows, attachmentRows\] = await db\.batch/);
  assert.match(dashboard, /fetchTaskCounts\(timeoutMs = 30_000\)/);
  assert.match(dashboard, /window\.setTimeout\(\(\) => void loadTaskCounts\(\), 0\)/);
  assert.match(dashboard, /Counters enhance task rows but must never hide or delay the workspace/);
});

test("V149 renders a compact owner workspace before loading the complete task history", async () => {
  const [bootstrap, dashboard] = await Promise.all([
    source("app/api/bootstrap/route.ts"),
    source("app/task-dashboard.tsx"),
  ]);
  assert.match(bootstrap, /loadMode === "core"/);
  assert.match(bootstrap, /loadMode: "core"/);
  assert.match(bootstrap, /loadMode: "full"/);
  assert.match(dashboard, /fetch\("\/api\/bootstrap\?mode=core"/);
  assert.match(dashboard, /const isCoreLoad = data\.loadMode === "core"/);
  assert.match(dashboard, /fetchWorkspaceData\(60_000\)/);
  assert.match(dashboard, /setTimeout\(\(\) => void loadWorkspaceDetails\(\), 0\)/);
  assert.match(dashboard, /timeZone: "Asia\/Amman"/);
});

test("V150 never runs schema mutations during production authentication and indexes notification startup reads", async () => {
  const [init, schema] = await Promise.all([
    source("lib/db-init.ts"),
    source("db/schema.ts"),
  ]);
  assert.match(init, /if \(process\.env\.NODE_ENV === "production"\) return true/);
  assert.match(schema, /notifications_recipient_created_idx/);
  assert.match(schema, /table\.recipientEmail, table\.createdAt, table\.id/);
});

test("V148 converts paused management private work safely and tightens manager project controls", async () => {
  const [dashboard, tasksApi, projectsApi, bootstrap] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
    source("app/api/projects/route.ts"),
    source("app/api/bootstrap/route.ts"),
  ]);
  assert.match(tasksApi, /reassignmentAfterSubmission = existing\[0\]\.submittedToManager \|\| existing\[0\]\.managerCheck === "pending" \|\| convertingPrivate/);
  assert.match(tasksApi, /isNull\(taskTimeEntries\.endedAt\)/);
  assert.match(tasksApi, /Pause the private task timer before converting it/);
  assert.doesNotMatch(tasksApi, /A private task cannot be converted after its timer has started/);
  assert.match(dashboard, /const convertingPrivateInForm = Boolean\(task\?\.visibility === "private" && form\.visibility === "team"\)/);
  assert.match(dashboard, /const privateConversionLocked = Boolean\(activeEntry\)/);
  assert.match(dashboard, /currentUser\?\.role === "manager" && currentUser\.discipline[\s\S]*?baseProjectUsers\.filter\(\(user\) => user\.discipline === currentUser\.discipline\)/);
  assert.match(projectsApi, /currentManagerIsProjectManager = Boolean\(membership\.isProjectManager\)/);
  assert.match(projectsApi, /removesAnotherManager && !currentManagerIsProjectManager/);
  assert.match(dashboard, /Only a project manager can remove another manager · مدير المشروع فقط يستطيع إزالة مسؤول آخر/);
  assert.match(bootstrap, /task\.visibility !== "private" && activeTaskIds\.has\(task\.id\)/);
  assert.match(dashboard, /Project updated successfully · تم تحديث المشروع بنجاح/);
});

test("V151 adds guarded task start dates and table, Kanban, calendar, and Gantt views", async () => {
  const [dashboard, tasksApi, schema, migration, backup, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
    source("db/schema.ts"),
    source("drizzle/0022_bouncy_norrin_radd.sql"),
    source("app/api/backup/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(schema, /startDate: text\("start_date"\)/);
  assert.match(migration, /ALTER TABLE `tasks` ADD `start_date`/);
  assert.match(tasksApi, /Start Date must be on or before Due Date/);
  assert.match(backup, /startDate: optionalStringField\(item, "startDate", 10\)/);
  assert.match(dashboard, /type TaskViewMode = "table" \| "kanban" \| "calendar" \| "gantt"/);
  assert.match(dashboard, /Kanban by manager review/);
  assert.match(dashboard, /Manager Review/);
  assert.match(dashboard, /Start to Due Date/);
  assert.match(dashboard, /30-day timeline/);
  assert.match(styles, /\.task-kanban-board/);
  assert.match(styles, /\.task-calendar-grid/);
  assert.match(styles, /\.task-gantt-chart/);
});

test("V152 keeps project metadata and date on one compact line below the project name", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /\.project-context-topbar \{ min-height: 60px; margin-bottom: 11px;/);
  assert.match(styles, /grid-template-areas: "project-title project-title" "project-meta project-date"/);
  assert.match(styles, /\.project-context-topbar \.project-heading-meta \{ grid-area: project-meta; min-width: 0; margin-top: 0; flex-wrap: nowrap;/);
  assert.match(styles, /\.project-context-topbar \.subhead \{ grid-area: project-date; margin: 0; padding-left: 10px;/);
});

test("V153 compacts task statistics and keeps filters and view controls on one toolbar", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /className="filters task-filters-with-views"/);
  assert.match(dashboard, /<option value="all">All employees<\/option>/);
  assert.match(dashboard, /employeeStatusKeys\.map/);
  assert.match(dashboard, /Object\.entries\(tableCheckLabel\)/);
  assert.doesNotMatch(dashboard, /All employee statuses · كل حالات الموظف/);
  assert.match(styles, /\.task-stats-ltr \.stat-card \{ min-height: 66px;/);
  assert.match(styles, /\.task-filter-cluster > \.task-search-box \{ flex: 0 1 205px;/);
  assert.match(styles, /\.task-filter-cluster > \.clear-filters-button \{ flex: 0 0 38px;/);
  assert.match(styles, /\.task-view-cluster \{ min-width: 0; display: flex;/);
});

test("V154 uses reference-style view icons and stable filter and view regions", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /function TaskViewIcon/);
  assert.match(dashboard, /<TaskViewIcon view="kanban" \/>/);
  assert.match(dashboard, /className="task-filter-cluster"/);
  assert.match(dashboard, /className="task-view-cluster"/);
  assert.doesNotMatch(dashboard, /gantt-range-hint|Start Date → End Date/);
  assert.doesNotMatch(dashboard, /className="task-gantt-note"/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(310px, \.55fr\) auto/);
  assert.match(styles, /\.task-view-icon { width: 17px; height: 15px;/);
});

test("V155 makes management Kanban review-only, draggable, and timer-safe", async () => {
  const [dashboard, tasksApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
    source("app/globals.css"),
  ]);
  assert.doesNotMatch(dashboard, /KanbanGroupMode|kanbanGroupMode|kanban-group-select/);
  assert.match(dashboard, /draggable=\{canDrag && !saving\}/);
  assert.match(dashboard, /aria-label="Kanban by manager review"/);
  assert.match(dashboard, /hideApproved=\{props\.reviewFilter === "unapproved"\}/);
  assert.match(dashboard, /reviewColumns\.filter\(\(column\) => column\.key !== "approved"\)/);
  assert.match(dashboard, /action: "kanban_review"/);
  assert.match(tasksApi, /const kanbanReviewUpdate = payload\.action === "kanban_review"/);
  assert.match(tasksApi, /Only authorized management can move this task in Kanban/);
  assert.match(tasksApi, /activeReviewSessions[\s\S]*?isNull\(taskTimeEntries\.endedAt\)/);
  assert.match(tasksApi, /timerPausedByReview \? "paused"/);
  assert.match(tasksApi, /timeEntries: refreshedTimeEntries,\s*timerPaused: timerPausedByReview/);
  assert.match(styles, /\.task-kanban-column\.is-drop-target/);
});

test("V156 labels private tasks in Kanban, calendar, and Gantt views", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /task-board-card-person[\s\S]*?task\.visibility === "private"[\s\S]*?task-private-indicator/);
  assert.match(dashboard, /calendar-task-signals[\s\S]*?task\.visibility === "private"[\s\S]*?task-private-indicator/);
  assert.match(dashboard, /task-gantt-details[\s\S]*?task\.visibility === "private"[\s\S]*?task-private-indicator/);
  assert.match(dashboard, /Private Task/);
  assert.match(styles, /\.task-private-indicator/);
  assert.match(styles, /\.calendar-task-signals/);
  assert.match(styles, /\.task-gantt-details/);
});

test("V157 gives employees a draggable status Kanban while management keeps review Kanban", async () => {
  const [dashboard, timerApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-timer/route.ts"),
  ]);
  assert.match(dashboard, /function EmployeeTaskKanbanBoard/);
  assert.match(dashboard, /aria-label="Kanban by employee status"/);
  assert.match(dashboard, /employeeStatusKanban = props\.currentUser\?\.role === "member"/);
  assert.match(dashboard, /employeeStatusKanban && props\.currentUser \? <EmployeeTaskKanbanBoard/);
  assert.match(dashboard, /task\.employeeEmail\.toLowerCase\(\) === currentUser\.email\.toLowerCase\(\)/);
  assert.match(dashboard, /in_progress: "start"[\s\S]*?paused: "pause"[\s\S]*?done: "finish"/);
  assert.doesNotMatch(dashboard, /not_started: "reset"/);
  assert.match(dashboard, /managerControlled: true/);
  assert.match(timerApi, /type TimerAction = "start" \| "pause" \| "finish"/);
  assert.doesNotMatch(timerApi, /action === "reset"/);
});

test("V158 removes Blocked while the unified management Kanban shows every filtered task", async () => {
  const [dashboard, timerApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-timer/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /const employeeStatusKeys: Task\["status"\]\[\] = \["not_started", "in_progress", "paused", "needs_revision", "done"\]/);
  assert.match(dashboard, /filter === "paused"[\s\S]*?status === "paused" \|\| status === "blocked"/);
  assert.doesNotMatch(dashboard, /\{ key: "blocked", label: "Blocked" \}/);
  assert.doesNotMatch(timerApi, /\| "block"/);
  assert.doesNotMatch(dashboard, /managementKanbanScope|Employee Task Reviews|Management Private Tasks/);
  assert.match(dashboard, /<TaskKanbanBoard tasks=\{props\.tasks\}/);
  assert.doesNotMatch(styles, /\.kanban-scope-select/);
});

test("V159 keeps Kanban dragging separate from opening and synchronizes employee status with management review", async () => {
  const [dashboard, timerApi] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-timer/route.ts"),
  ]);
  assert.match(dashboard, /const suppressClickAfterDrag = useRef\(false\)/);
  assert.match(dashboard, /if \(suppressClickAfterDrag\.current\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(dashboard, /Revision \(from Manager\)/);
  assert.match(timerApi, /assignedUserAction \? \{ managerCheck: "new" as const \} : \{\}/);
  assert.doesNotMatch(timerApi, /status: "not_started", managerCheck: "new"/);
  assert.match(dashboard, /onDoubleClick=\{\(event\) => \{ if \(!canReorder \|\| \(event\.target as HTMLElement\)\.closest\("\.task-board-card"\)\) return; createTask\(\); \}\}/);
  assert.match(dashboard, /createTask=\{\(\) => props\.createTask\(props\.lockedProjectCode \|\| ""\)\}/);
  assert.match(dashboard, /props\.tasks\.length === 0 && viewMode !== "kanban"/);
});

test("V160 keeps Not Started management-owned in the employee Kanban", async () => {
  const [dashboard, timerApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-timer/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /Not Started \(New from Manager\)/);
  assert.match(dashboard, /key: "not_started"[\s\S]*?managerControlled: true/);
  assert.match(dashboard, /event\.dataTransfer\.dropEffect = acceptsDrop \? "move" : "none"/);
  assert.match(dashboard, /managerControlled \|\| !task/);
  assert.doesNotMatch(dashboard, /not_started: "reset"/);
  assert.doesNotMatch(timerApi, /"reset"/);
  assert.match(styles, /employee-status-kanban\.drag-active \.manager-controlled-column[\s\S]*?cursor: not-allowed !important/);
});

test("V161 synchronizes review status, preserves views, and makes calendar and Gantt timeline-aware", async () => {
  const [dashboard, tasksApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(tasksApi, /const movingToPending = management && kanbanReviewUpdate && requestedCheck === "pending"/);
  assert.match(tasksApi, /const movingToReturned = management && kanbanReviewUpdate && requestedCheck === "returned"/);
  assert.match(tasksApi, /movingToReturned \? "needs_revision" : movingToPending \? "done"/);
  assert.match(dashboard, /\{ key: "done", label: "Done" \}/);
  assert.match(dashboard, /window\.sessionStorage\.getItem\(taskViewModeSessionKey\)/);
  assert.match(dashboard, /window\.sessionStorage\.setItem\(taskViewModeSessionKey, viewMode\)/);
  assert.doesNotMatch(dashboard, /managementKanbanScope|gantt-range-hint|Start Date → End Date/);
  assert.match(dashboard, /gridColumn: `\$\{startColumn \+ 1\} \/ \$\{endColumn \+ 2\}`/);
  assert.match(dashboard, /className="task-calendar-events"/);
  assert.match(dashboard, /const totalDays = 30/);
  assert.match(dashboard, /const visibleStart = addTaskViewDays\(anchorDate, -7\)/);
  assert.match(dashboard, /className="task-gantt-today-line"/);
  assert.match(dashboard, /task-gantt-resize-handle start/);
  assert.match(dashboard, /onDoubleClick=\{\(event\) => \{ if \(\(event\.target as HTMLElement\)\.closest\("\.task-gantt-resize-handle"\)\) return; openTask\(task\); \}\}/);
  assert.match(tasksApi, /payload\.action === "gantt_dates"/);
  assert.match(tasksApi, /canManageTask\(db, currentUser, existing\[0\]\)/);
  assert.match(styles, /\.task-gantt-resize-handle/);
  assert.match(styles, /\.task-gantt-today-line/);
});

test("V162 refines employee Kanban ordering, centers views, and adds weekly calendar navigation", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /key: "paused", label: "Paused"[\s\S]*?key: "done", label: "Done"[\s\S]*?key: "needs_revision", label: "Revision \(from Manager\)"/);
  assert.match(dashboard, /className="task-view-cluster"><div className="task-view-switcher"[\s\S]*?<\/div><\/div><span className="count-badge filter-count"/);
  assert.match(styles, /\.task-filters-with-views \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(310px, \.55fr\) auto/);
  assert.match(styles, /\.task-view-cluster \{[^}]*justify-content: center/);
  assert.match(styles, /\.task-filters-with-views > \.filter-count \{[^}]*justify-self: end/);
  assert.match(dashboard, /function shiftCalendarWeek/);
  assert.match(dashboard, /aria-label="Previous month"/);
  assert.match(dashboard, /aria-label="Next month"/);
  assert.match(dashboard, /const gridStart = new Date\(monthStart\)/);
  assert.match(dashboard, /onMouseDown=\{\(event\) => \{ if \(event\.detail > 1\) event\.preventDefault\(\); \}\}/);
  assert.match(dashboard, /className=\{`task-gantt-row[\s\S]*?onDoubleClick=\{\(event\) =>/);
  assert.match(styles, /\.task-calendar-day > header span \{[^}]*font-size: 12px/);
  assert.match(styles, /\.task-calendar-week-nav button \{[^}]*width: 27px/);
  assert.match(styles, /\.task-gantt-row \{[^}]*user-select: none/);
});

test("V163 renders continuous calendar ranges, navigates Gantt weekly, and delivers authorized task mentions", async () => {
  const [dashboard, commentsApi, schema, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/task-comments/route.ts"),
    source("db/schema.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /className="task-calendar-week"[\s\S]*?--calendar-lanes/);
  assert.match(dashboard, /gridColumn: `\$\{startColumn \+ 1\} \/ \$\{endColumn \+ 2\}`/);
  assert.match(dashboard, /aria-label="Navigate calendar by month"/);
  assert.match(dashboard, /aria-label="Navigate Gantt by week"/);
  assert.match(dashboard, /shiftCalendarWeek\(anchor, -1\)/);
  assert.match(dashboard, /shiftCalendarWeek\(anchor, 1\)/);
  assert.doesNotMatch(dashboard, /<b>Today<\/b>/);
  assert.match(styles, /\.task-gantt-axis \.task-gantt-track > span \{[^}]*font-size: 8px/);
  assert.match(dashboard, /Type @ to mention/);
  assert.match(dashboard, /mentionedEmails/);
  assert.match(commentsApi, /permittedMentions/);
  assert.match(commentsApi, /canViewTask\(db, safeUser\(candidate\), task\)/);
  assert.match(commentsApi, /type: "task_mentioned"/);
  assert.match(commentsApi, /await createNotifications\(db, notificationPayloads\)/);
  assert.match(schema, /"task_mentioned"/);
  assert.match(styles, /\.comment-mention-menu/);
});

test("V164 shows active-work pulse in Gantt and compacts issue summary cards like task cards", async () => {
  const [dashboard, issuesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /className="task-gantt-title"[\s\S]*?task\.status === "in_progress"[\s\S]*?employee-task-live-pulse/);
  assert.match(styles, /\.task-gantt-title \.employee-task-live-pulse/);
  assert.match(issuesModule, /className="issue-stats task-stats-ltr"/);
  assert.match(styles, /\.issue-stats\.task-stats-ltr article \{[^}]*min-height: 66px[^}]*display: flex/);
  assert.match(styles, /\.issue-stats\.task-stats-ltr article > strong \{[^}]*font-size: 24px/);
});

test("V165 keeps Kanban task drawers closed after drag and drop", async () => {
  const dashboard = await source("app/task-dashboard.tsx");
  assert.match(dashboard, /onDragStart=\{\(event\) => \{ suppressClickAfterDrag\.current = true;/);
  assert.match(dashboard, /window\.setTimeout\(\(\) => \{ suppressClickAfterDrag\.current = false; \}, 350\)/);
  assert.match(dashboard, /if \(suppressClickAfterDrag\.current\) \{ event\.preventDefault\(\); return; \}/);
});

test("V166 adds persistent project Notes with rich editing, mind maps, and PDF export", async () => {
  const [dashboard, notesModule, notesApi, schema, backupApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/project-notes-module.tsx"),
    source("app/api/project-notes/route.ts"),
    source("db/schema.ts"),
    source("app/api/backup/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(schema, /sqliteTable\(\s*"project_notes"/);
  assert.match(notesApi, /canAccessProject/);
  assert.match(notesApi, /Only the note creator or owner can delete this page/);
  assert.match(dashboard, /import ProjectNotesModule/);
  assert.match(dashboard, /projectWorkspaceTab === "notes" && currentUser && <ProjectNotesModule/);
  assert.match(notesModule, /className="project-notes-app"/);
  assert.match(notesModule, /contentEditable/);
  assert.match(notesModule, /document\.execCommand/);
  assert.match(notesModule, /editor\.innerHTML = selectedNote\.contentHtml/);
  assert.match(notesModule, /editor\.dataset\.noteId = noteMarker/);
  assert.match(notesModule, /className="notes-trash-icon"/);
  assert.match(notesModule, />Mind Map</);
  assert.match(notesModule, /window\.print\(\)/);
  assert.match(notesModule, /report-logo\.png/);
  assert.match(styles, /\.project-notes-app \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\)/);
  assert.match(backupApi, /projectNotes/);
  assert.match(backupApi, /SCHEMA_VERSION = 11/);
});

test("V167 collapses the desktop sidebar to icons while preserving responsive layout and concise tooltips", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /sidebarStateStorageKey/);
  assert.match(dashboard, /sidebarCollapsed \? " sidebar-collapsed"/);
  assert.match(dashboard, /className="sidebar-collapse-toggle"/);
  assert.match(dashboard, /aria-label="Overview" title="Overview"/);
  assert.match(dashboard, /aria-label="Projects" title="Projects"/);
  assert.doesNotMatch(dashboard, /aria-label="Open Overview"|aria-label="Open Project Management"|aria-label=\{`Open \$\{item\.en\}`\}/);
  assert.match(styles, /\.app-shell\.sidebar-collapsed \.sidebar \{[^}]*width: 82px/);
  assert.match(styles, /\.app-shell\.sidebar-collapsed \.main-content \{[^}]*margin-left: 82px/);
  assert.match(styles, /\.sidebar-collapse-toggle \{[^}]*background: #151515/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*?\.sidebar-collapse-toggle \{ display: none; \}/);
});

test("V168 anchors the sidebar arrow in a circular tab that protrudes from its edge", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /\.sidebar-collapse-toggle \{[^}]*border-radius: 50%/);
});

test("V169 reduces the sidebar tab to a subtle less-than-half protrusion", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /\.sidebar-collapse-toggle \{[^}]*right: -17px;[^}]*width: 40px;[^}]*height: 40px/);
  assert.match(styles, /\.sidebar-collapse-toggle \{[^}]*border: 3px solid #050505/);
  assert.match(styles, /\.sidebar-collapse-toggle span \{[^}]*font-size: 18px;[^}]*transform: translate\(4px,-1px\)/);
});

test("V170 prevents transient page-level horizontal scrolling while the sidebar animates", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /html \{[^}]*max-width: 100%;[^}]*overflow-x: hidden;[^}]*overflow-x: clip/);
  assert.match(styles, /body \{[^}]*max-width: 100%;[^}]*overflow-x: hidden;[^}]*overflow-x: clip/);
  assert.match(styles, /\.app-shell \{[^}]*width: 100%;[^}]*overflow-x: clip/);
  assert.match(styles, /\.task-table-wrap \{[^}]*overflow-x: auto/);
});

test("V171 sanitizes external note paste and keeps the formatting toolbar visible", async () => {
  const [notesModule, styles] = await Promise.all([
    source("app/project-notes-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(notesModule, /function sanitizePastedNoteHtml/);
  assert.match(notesModule, /style,script,link,meta,iframe,object,embed,form,input,button,textarea,select/);
  assert.match(notesModule, /onPaste=\{pasteIntoEditor\}/);
  assert.match(notesModule, /latestDraftRef/);
  assert.doesNotMatch(notesModule, /editorRef\.current\.innerHTML = saved\.contentHtml/);
  assert.match(styles, /\.notes-editor-toolbar \{[^}]*z-index: 3;[^}]*flex: 0 0 auto/);
  assert.match(styles, /\.notes-rich-editor \{[^}]*min-height: 0;[^}]*flex: 1 1 0/);
});

test("V172 prints A4 multi-page notes and edits persistent note tables", async () => {
  const [notesModule, notesApi, styles] = await Promise.all([
    source("app/project-notes-module.tsx"),
    source("app/api/project-notes/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(notesModule, /function printNote\(\)/);
  assert.match(notesModule, /@page\{size:A4 portrait;margin:16mm\}/);
  assert.match(notesModule, /report-logo\.png/);
  assert.match(notesModule, /className="notes-print-icon"/);
  assert.match(notesModule, /function insertTable\(\)/);
  assert.match(notesModule, /editSelectedTable\(action: "add-row" \| "add-column" \| "delete-row" \| "delete-column" \| "delete-table"\)/);
  assert.match(notesModule, /Insert 3 × 3 table/);
  assert.match(notesApi, /"table", "thead", "tbody", "tfoot", "tr", "th", "td"/);
  assert.match(styles, /\.notes-rich-editor table \{[^}]*border-collapse: collapse/);
});

test("V173 restores workspace state and upgrades note editing controls", async () => {
  const [dashboard, notesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/project-notes-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /workspaceUiSessionKey/);
  assert.match(dashboard, /workspaceScrollSessionKey/);
  assert.match(dashboard, /initialSection === "notes" \|\| initialSection === "mom"/);
  assert.match(dashboard, /taskCalendarAnchorSessionKey/);
  assert.match(notesModule, /noteSessionKey/);
  assert.match(notesModule, /function editorKeyboardShortcut/);
  assert.match(notesModule, /className="notes-list-tool"/);
  assert.match(notesModule, /className="notes-table-menu"/);
  assert.match(notesModule, /className="notes-print-icon"/);
  assert.match(styles, /\.assignment-time-section \.assignment-time-grid\.management/);
});

test("project Notes use sections, A4 pages, independent table selections, and live mind maps", async () => {
  const [notesModule, notesApi, styles] = await Promise.all([
    source("app/project-notes-module.tsx"),
    source("app/api/project-notes/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(notesModule, /<small>Sections · \{notes\.length\}/);
  assert.match(notesModule, /pageCount \* 1123/);
  assert.match(notesModule, /selectTableGroup\("column"\)/);
  assert.match(notesModule, /formatSelectedTableBackground/);
  assert.match(notesModule, /Live from the current note/);
  assert.match(notesApi, /"width", "height", "min-width"/);
  assert.match(styles, /\.notes-editor-shell \.notes-rich-editor \{[^}]*width: min\(794px/);
  assert.match(styles, /data-table-selected="column"/);
});

test("project Notes use the active notebook, mouse-resizable tables, and distinct row and column selection", async () => {
  const [notesModule, styles] = await Promise.all([
    source("app/project-notes-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.doesNotMatch(notesModule, /<aside className="notes-projects-column">/);
  assert.match(notesModule, /notes-notebook-name/);
  assert.match(notesModule, /notes-notebook-code/);
  assert.match(notesModule, /<small>Sections · \{notes\.length\}/);
  assert.match(notesModule, /closeTableMenuOutside/);
  assert.match(notesModule, /handleTableResizeStart/);
  assert.match(notesModule, /handleTableResizeHover/);
  assert.match(notesModule, /data-table-selected", "column"/);
  assert.match(notesModule, /data-table-selected", "row"/);
  assert.match(notesModule, /tableCellColors\.map/);
  assert.match(styles, /grid-template-columns: 300px minmax\(0, 1fr\)/);
  assert.match(styles, /data-table-selected="column"/);
  assert.match(styles, /data-table-selected="row"/);
});

test("V175 keeps Notes visible and auto-saved while task tables sort from Created Date", async () => {
  const [dashboard, notesModule, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/project-notes-module.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(styles, /\.project-switcher-menu \{[^}]*left: 0;[^}]*right: auto;/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.project-switcher-menu \{[^}]*position: fixed;[^}]*left: 12px;[^}]*right: 12px;/);
  assert.match(notesModule, /window\.setTimeout\(\(\) => \{ void saveNoteRef\.current\(true\); \}, 700\)/);
  assert.match(notesModule, /keepalive: true/);
  assert.doesNotMatch(notesModule, /className="notes-save-button"/);
  assert.match(notesModule, /const targets = tableFormattingTargets\(\);\s*if \(!targets\.length\)/);
  assert.match(dashboard, /useState<\{ key: TaskSortKey; direction: "asc" \| "desc" \}>\(\{ key: "createdAt", direction: "desc" \}\)/);
  assert.match(dashboard, /aria-sort=/);
  assert.match(dashboard, /sortedTasks\.map\(\(task\)/);
});

test("V176 adds Word-style table handles, resizable note images, and mobile issues", async () => {
  const [notesModule, notesApi, imageApi, styles] = await Promise.all([
    source("app/project-notes-module.tsx"),
    source("app/api/project-notes/route.ts"),
    source("app/api/project-note-images/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(notesModule, /className="notes-table-edge-handle column"/);
  assert.match(notesModule, /className="notes-table-edge-handle row"/);
  assert.match(notesModule, /function selectTableGroup\(kind: "column" \| "row"\)/);
  assert.match(notesModule, /function uploadNoteImage\(file: File\)/);
  assert.match(notesModule, /className="notes-image-size"/);
  assert.match(imageApi, /const MAX_IMAGE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(imageApi, /project-note-images\/uploads/);
  assert.match(notesApi, /allowedTags = new Set\(\[[^\]]*"img"/);
  assert.match(styles, /\.issues-panel \.task-table-wrap \{ display: block;/);
  assert.match(styles, /\.issues-panel \.issue-table \{ min-width: 1080px;/);
});

test("V177 refines note controls and sorts issues and task dialogs from creation date", async () => {
  const [notesModule, notesApi, issuesModule, dashboard, styles] = await Promise.all([
    source("app/project-notes-module.tsx"),
    source("app/api/project-notes/route.ts"),
    source("app/issues-module.tsx"),
    source("app/task-dashboard.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(notesModule, /tableRect\.top - 9/);
  assert.match(notesModule, /setTableHandlePosition\(null\)/);
  assert.match(notesModule, /alignSelectedImage\("center"\)/);
  assert.match(notesModule, /setEditorDirection\("rtl"\)/);
  assert.match(notesModule, /Uploading image \{imageUploadProgress\}%/);
  assert.match(notesApi, /const dirMatch = match\[3\]\.match/);
  assert.match(issuesModule, /useState<\{ key: IssueSortKey; direction: "asc" \| "desc" \}>\(\{ key: "createdAt", direction: "desc" \}\)/);
  assert.match(issuesModule, /interactive-sort-header/);
  assert.match(dashboard, /type WindowTaskSortKey/);
  assert.match(dashboard, /sortWindowTasks/);
  assert.match(dashboard, /useWindowTaskTableSorting\("\.report-tasks-dialog"/);
  assert.match(dashboard, /useWindowTaskTableSorting\("\.employee-tasks-dialog:not\(\.report-tasks-dialog\)"/);
  assert.match(styles, /\.notes-image-align/);
});

test("V178 adds overview drilldowns, discipline reports, issue mentions, and editable client replies", async () => {
  const [dashboard, issuesModule, issuesApi, issueCommentsApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/issues-module.tsx"),
    source("app/api/issues/route.ts"),
    source("app/api/issue-comments/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(issuesApi, /clientReply: cleanText\(payload\.clientReply, 4_000\)/);
  assert.match(issueCommentsApi, /notifyMentionedUsers/);
  assert.match(issueCommentsApi, /mentionedEmails/);
  assert.match(issuesModule, /Client Response · رد العميل/);
  assert.match(issuesModule, /comment-mention-menu/);
  assert.match(dashboard, /type ReportGroup = "project" \| "employee" \| "discipline"/);
  assert.match(dashboard, /<option value="discipline">Discipline<\/option>/);
  assert.match(dashboard, /hindazaOverviewTasks/);
  assert.match(dashboard, /OverviewIssuesDialog/);
  assert.match(dashboard, /groupBy=\{reportGroup === "project" \? "employee" : "project"\}/);
  assert.match(dashboard, /kpi-rfi/);
  assert.match(dashboard, /metricButtons=\{\[/);
  assert.match(dashboard, /overview-task-toolbar/);
  assert.match(dashboard, /label: "All Tasks"[\s\S]*label: "Pending"[\s\S]*label: "New\/WIP"[\s\S]*label: "Approved"/);
  assert.doesNotMatch(dashboard, /label: "Closed", metric: "closed"/);
  assert.match(dashboard, /overviewFilters/);
  assert.match(dashboard, /overview-task-toolbar-filters/);
  assert.match(dashboard, /closeOverviewTasksToOverview/);
  assert.match(dashboard, /closeOverviewIssuesToOverview/);
  assert.match(dashboard, /overviewFilters[\s\S]*onClose=\{closeOverviewTasksToOverview\}/);
  assert.match(dashboard, /OverviewIssuesDialog[\s\S]*onClose=\{closeOverviewIssuesToOverview\}/);
  assert.match(dashboard, /changeOverviewTaskMetric/);
  assert.match(dashboard, /changeOverviewIssueMetric/);
  assert.match(dashboard, /overview-issue-toolbar-filters/);
  assert.match(dashboard, /Filter overview issues by discipline/);
  assert.doesNotMatch(dashboard, /kpi-projects"[\s\S]*<i>↗<\/i>/);
  assert.doesNotMatch(dashboard, /className="overview-kpi-open"/);
  assert.doesNotMatch(dashboard, /overview-kpi-breakdown/);
  assert.match(dashboard, /overview-kpi-inline-metrics/);
  assert.match(dashboard, /<i>-<\/i>/);
  assert.match(dashboard, /metric-pending/);
  assert.match(dashboard, /metric-wip/);
  assert.match(dashboard, /metric-open/);
  assert.match(styles, /\.report-dialog-filterbar select, \.report-dialog-filterbar input \{[^}]*font-size: 10px/);
  assert.match(styles, /\.overview-kpi-inline-metrics/);
  assert.match(styles, /\.overview-task-toolbar-filters/);
  assert.match(styles, /\.overview-issue-toolbar-filters/);
  assert.doesNotMatch(styles, /\.overview-kpi-breakdown/);
});
