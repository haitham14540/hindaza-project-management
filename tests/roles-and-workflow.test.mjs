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
  assert.match(dashboard, /setInterval\(refresh, 30_000\)/);
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
  assert.match(bootstrapApi, /const \[allTaskRows, userRows, allProjectRows, membershipRows\] = await Promise\.all/);
  assert.match(bootstrapApi, /const \[allCommentRows, allTimeRows, allSubtaskRows, allTaskAttachmentRows, notificationRows\] = await Promise\.all/);
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
  assert.match(issuesModule, /setFiles\(\[\]\); setClientFiles\(\[\]\);/);
  assert.match(issuesModule, /if \(!selectedId\) setDrawerOpen\(false\)/);
  assert.match(dashboard, /Task Details & Update/);
  assert.match(backupApi, /const SCHEMA_VERSION = 7/);
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
  assert.match(dashboard, /<th>Task \/ Project<\/th>/);
  assert.match(dashboard, /<th>Created By<\/th>/);
  assert.match(dashboard, /<th>Created Date<\/th><th>Due Date<\/th>/);
  assert.match(dashboard, /className="creator-cell"/);
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
  assert.match(issuesModule, /<select required value=\{convertEmployee\}/);
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
  assert.match(timerApi, /Work sessions can be audited after the task is submitted for review/);
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
  assert.match(dashboard, /fetchWorkspaceData\(timeoutMs = 25_000\)/);
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
  assert.match(styles, /--font-ui: Arial, "Segoe UI", Tahoma, sans-serif/);
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
  assert.match(dashboard, /onClick=\{openProjectDirectory\} aria-label="Open Project Management"/);
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
  assert.match(dashboard, /className="project-table-identity"><strong>\{project\.name\}<\/strong><small className="project-code">\{project\.code\}<\/small>/);
  assert.doesNotMatch(dashboard, /<small>Tasks in this project<\/small>/);
  assert.doesNotMatch(dashboard, /project-workspace-header panel/);
  assert.match(dashboard, /lockedProjectCode=\{selectedProject\.code\}/);
  assert.match(dashboard, /!props\.lockedProjectCode && <select[\s\S]*?Filter by project/);
  assert.match(issuesModule, /lockedProjectCode\?: string/);
  assert.match(issuesModule, /!lockedProjectCode && <select value=\{projectFilter\}/);
  assert.match(dashboard, /tab === "reports" && <div className="reports-workspace"/);
  assert.match(styles, /\.project-workspace-tabs/);
  assert.match(styles, /\.project-switcher/);
  assert.match(styles, /\.project-switcher-menu \{ position: absolute;[^}]*right: 0;/);
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

test("project managers see employee assignments but other creators' tasks stay read-only", async () => {
  const [dashboard, tasksApi, taskAccess, timerApi, styles] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("app/api/tasks/route.ts"),
    source("lib/task-access.ts"),
    source("app/api/task-timer/route.ts"),
    source("app/globals.css"),
  ]);
  assert.match(dashboard, /currentUserIsProjectManager/);
  assert.match(dashboard, /showEmployeeFilter=\{currentUser\?\.role !== "member" \|\| currentUserIsProjectManager\}/);
  assert.match(dashboard, /projectManagerReadOnly/);
  assert.match(dashboard, /task\.createdBy !== currentUser\.email/);
  assert.match(dashboard, /readOnly=\{!canCollaborate\}/);
  assert.match(tasksApi, /isReadOnlyProjectManager/);
  assert.match(tasksApi, /Project managers can edit or delete only tasks they created/);
  assert.match(taskAccess, /!membership\.isProjectManager/);
  assert.match(timerApi, /!membership\.isProjectManager \|\| task\.createdBy === currentUser\.email/);
  assert.match(dashboard, /className="project-settings-topbar"/);
  assert.match(dashboard, /aria-label="Project settings" title="Project settings"/);
  assert.match(styles, /\.project-directory-back \{ height: 43px; min-height: 43px;/);
  assert.match(styles, /\.project-settings-topbar \{ width: 43px; height: 43px;/);
});

test("projects archive cleanly and tasks support guarded subtasks with optional attachments", async () => {
  const [dashboard, schema, projectsApi, subtasksApi, attachmentsApi, tasksApi, timerApi, bootstrapApi, styles, migration] = await Promise.all([
    source("app/task-dashboard.tsx"),
    source("db/schema.ts"),
    source("app/api/projects/route.ts"),
    source("app/api/task-subtasks/route.ts"),
    source("app/api/task-attachments/route.ts"),
    source("app/api/tasks/route.ts"),
    source("app/api/task-timer/route.ts"),
    source("app/api/bootstrap/route.ts"),
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
  assert.match(bootstrapApi, /subtasks: subtaskRows/);
  assert.match(bootstrapApi, /taskAttachments: taskAttachmentRows/);
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
  assert.match(dashboard, /\{management && <label className="assignment-employee"/);
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
  assert.match(dashboard, /label: "Overdue · متجاوزة الوقت"/);
  assert.doesNotMatch(dashboard, /label: "Overtime/);
  assert.match(dashboard, /canEditComment\(comment, currentUser, clock\)/);
  assert.match(dashboard, /className="comment-edit-button"/);
  assert.match(dashboard, /fetch\("\/api\/task-comments"[\s\S]*?method: "PATCH"/);
  assert.match(commentsApi, /COMMENT_EDIT_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(commentsApi, /comment\.authorEmail\.toLowerCase\(\) !== currentUser\.email\.toLowerCase\(\)/);
  assert.match(commentsApi, /elapsed > COMMENT_EDIT_WINDOW_MS/);
  assert.match(commentsApi, /Only the note author can edit it/);
});
