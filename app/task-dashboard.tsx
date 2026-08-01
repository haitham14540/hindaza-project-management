/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Discipline = "Architecture" | "ID" | "Structure" | "Mechanical" | "Electrical" | "Infrastructure";

type User = {
  email: string;
  displayName: string;
  role: "manager" | "member";
  discipline: Discipline | "";
};

type Project = {
  id: number;
  code: string;
  name: string;
  client: string;
  status: "active" | "on_hold" | "completed";
  startDate: string;
  targetDate: string;
  createdAt: string;
};

type Task = {
  id: number;
  taskDate: string;
  employeeName: string;
  employeeEmail: string;
  project: string;
  title: string;
  expectedOutput: string;
  priority: "high" | "medium" | "low";
  plannedHours: number;
  startTime: string;
  endTime: string;
  actualHours: number;
  status: "not_started" | "in_progress" | "blocked" | "needs_revision" | "done";
  managerCheck: "pending" | "approved" | "returned";
  managerNote: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type TaskForm = Omit<Task, "id" | "createdBy" | "createdAt" | "updatedAt">;
type ProjectForm = Omit<Project, "id" | "createdAt">;
type UserForm = Pick<User, "email" | "displayName" | "role" | "discipline"> & { temporaryPassword: string };
type Tab = "overview" | "tasks" | "projects" | "team" | "reports";

const statusLabel: Record<Task["status"], string> = {
  not_started: "لم تبدأ · Not started",
  in_progress: "قيد التنفيذ · In progress",
  blocked: "متوقفة · Blocked",
  needs_revision: "تحتاج تعديل · Revision",
  done: "مكتملة · Done",
};

const priorityLabel: Record<Task["priority"], string> = {
  high: "عالية · High",
  medium: "متوسطة · Medium",
  low: "منخفضة · Low",
};

const checkLabel: Record<Task["managerCheck"], string> = {
  pending: "بانتظار التدقيق · Pending",
  approved: "معتمدة · Approved",
  returned: "مُعادة · Returned",
};

const projectStatusLabel: Record<Project["status"], string> = {
  active: "نشط · Active",
  on_hold: "معلّق · On hold",
  completed: "مكتمل · Completed",
};

const disciplines: Discipline[] = ["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"];

function localToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function blankTask(user?: User): TaskForm {
  return {
    taskDate: localToday(),
    employeeName: user?.displayName || "",
    employeeEmail: user?.email || "",
    project: "",
    title: "",
    expectedOutput: "",
    priority: "medium",
    plannedHours: 0,
    startTime: "08:00",
    endTime: "",
    actualHours: 0,
    status: "not_started",
    managerCheck: "pending",
    managerNote: "",
  };
}

const blankProject = (): ProjectForm => ({
  code: "",
  name: "",
  client: "",
  status: "active",
  startDate: "",
  targetDate: "",
});

const blankUser = (): UserForm => ({ email: "", displayName: "", role: "member", discipline: "", temporaryPassword: "" });

function taskFlag(task: Task) {
  if (task.managerCheck === "returned" || task.status === "needs_revision") return { key: "revision", label: "تعديل · Revision" };
  if (task.status === "blocked") return { key: "blocked", label: "متوقفة · Blocked" };
  if (task.taskDate < localToday() && task.status !== "done") return { key: "late", label: "متأخرة · Late" };
  if (task.plannedHours > 0 && task.actualHours > task.plannedHours * 1.2) return { key: "overtime", label: "تجاوز وقت · Overtime" };
  return { key: "ok", label: "سليمة · OK" };
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-JO", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function isoDate(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function reportRange(anchor: string, period: "week" | "month") {
  const date = new Date(`${anchor}T12:00:00`);
  if (period === "week") {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: isoDate(start), end: isoDate(end) };
  }
  return {
    start: isoDate(new Date(date.getFullYear(), date.getMonth(), 1, 12)),
    end: isoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)),
  };
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function TaskDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<TaskForm>(blankTask());
  const [projectForm, setProjectForm] = useState<ProjectForm>(blankProject());
  const [userForm, setUserForm] = useState<UserForm>(blankUser());
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [reportGroup, setReportGroup] = useState<"project" | "employee">("project");
  const [reportAnchor, setReportAnchor] = useState(localToday());
  const [reportScope, setReportScope] = useState("all");

  useEffect(() => {
    let active = true;
    fetch("/api/bootstrap", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace("/login");
          return null;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل البيانات");
        if (!data) return;
        if (!active) return;
        setTasks(data.tasks);
        setUsers(data.users);
        setProjects(data.projects || []);
        setCurrentUser(data.currentUser);
        setTaskForm(blankTask(data.currentUser));
      })
      .catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : "تعذر تحميل البيانات"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTaskDrawerOpen(false);
        setProjectDrawerOpen(false);
        setUserDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const employees = useMemo(() => Array.from(new Set([...users.map((u) => u.displayName), ...tasks.map((t) => t.employeeName)])).sort(), [users, tasks]);
  const projectCodes = useMemo(() => Array.from(new Set([...projects.map((p) => p.code), ...tasks.map((t) => t.project)])).sort(), [projects, tasks]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const searchable = `${task.title} ${task.expectedOutput} ${task.project} ${task.employeeName}`.toLowerCase();
      return (!term || searchable.includes(term)) &&
        (employeeFilter === "all" || task.employeeName === employeeFilter) &&
        (projectFilter === "all" || task.project === projectFilter) &&
        (statusFilter === "all" || task.status === statusFilter);
    });
  }, [tasks, search, employeeFilter, projectFilter, statusFilter]);

  const stats = useMemo(() => {
    const done = tasks.filter((task) => task.status === "done").length;
    const attention = tasks.filter((task) => ["blocked", "revision", "late", "overtime"].includes(taskFlag(task).key)).length;
    const pending = tasks.filter((task) => task.status === "done" && task.managerCheck === "pending").length;
    return { total: tasks.length, done, open: tasks.length - done, attention, pending };
  }, [tasks]);

  const teamRows = useMemo(() => users.map((user) => {
    const rows = tasks.filter((task) => task.employeeEmail === user.email || (!task.employeeEmail && task.employeeName === user.displayName));
    return {
      ...user,
      temporary: user.email.endsWith("@hindaza.local"),
      total: rows.length,
      done: rows.filter((task) => task.status === "done").length,
      attention: rows.filter((task) => taskFlag(task).key !== "ok").length,
      planned: rows.reduce((sum, task) => sum + task.plannedHours, 0),
      actual: rows.reduce((sum, task) => sum + task.actualHours, 0),
    };
  }).sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName)), [users, tasks]);

  const projectRows = useMemo(() => projects.map((project) => {
    const rows = tasks.filter((task) => task.project === project.code);
    const done = rows.filter((task) => task.status === "done").length;
    return {
      ...project,
      total: rows.length,
      done,
      progress: rows.length ? Math.round((done / rows.length) * 100) : 0,
      planned: rows.reduce((sum, task) => sum + task.plannedHours, 0),
      actual: rows.reduce((sum, task) => sum + task.actualHours, 0),
    };
  }), [projects, tasks]);

  const range = useMemo(() => reportRange(reportAnchor, reportPeriod), [reportAnchor, reportPeriod]);
  const reportTasks = useMemo(() => tasks.filter((task) => task.taskDate >= range.start && task.taskDate <= range.end && (
    reportScope === "all" || (reportGroup === "project" ? task.project === reportScope : task.employeeName === reportScope)
  )), [tasks, range, reportScope, reportGroup]);

  const reportRows = useMemo(() => {
    const keys = reportGroup === "project" ? projectCodes : employees;
    return keys.map((key) => {
      const rows = reportTasks.filter((task) => reportGroup === "project" ? task.project === key : task.employeeName === key);
      return {
        key,
        total: rows.length,
        done: rows.filter((task) => task.status === "done").length,
        open: rows.filter((task) => task.status !== "done").length,
        blocked: rows.filter((task) => task.status === "blocked" || task.status === "needs_revision").length,
        planned: rows.reduce((sum, task) => sum + task.plannedHours, 0),
        actual: rows.reduce((sum, task) => sum + task.actualHours, 0),
      };
    }).filter((row) => row.total > 0).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  }, [reportTasks, reportGroup, projectCodes, employees]);

  const reportSummary = useMemo(() => ({
    total: reportTasks.length,
    done: reportTasks.filter((task) => task.status === "done").length,
    attention: reportTasks.filter((task) => taskFlag(task).key !== "ok").length,
    planned: reportTasks.reduce((sum, task) => sum + task.plannedHours, 0),
    actual: reportTasks.reduce((sum, task) => sum + task.actualHours, 0),
  }), [reportTasks]);

  const maxReportTotal = Math.max(1, ...reportRows.map((row) => row.total));

  function openNewTask() {
    setSelectedTaskId(null);
    setTaskForm(blankTask(currentUser || undefined));
    setTaskDrawerOpen(true);
  }

  function openTask(task: Task) {
    setSelectedTaskId(task.id);
    setTaskForm({
      taskDate: task.taskDate, employeeName: task.employeeName, employeeEmail: task.employeeEmail,
      project: task.project, title: task.title, expectedOutput: task.expectedOutput, priority: task.priority,
      plannedHours: task.plannedHours, startTime: task.startTime, endTime: task.endTime,
      actualHours: task.actualHours, status: task.status, managerCheck: task.managerCheck, managerNote: task.managerNote,
    });
    setTaskDrawerOpen(true);
  }

  function openNewProject() {
    setSelectedProjectId(null);
    setProjectForm(blankProject());
    setProjectDrawerOpen(true);
  }

  function openProject(project: Project) {
    if (currentUser?.role !== "manager") return;
    setSelectedProjectId(project.id);
    setProjectForm({ code: project.code, name: project.name, client: project.client, status: project.status, startDate: project.startDate, targetDate: project.targetDate });
    setProjectDrawerOpen(true);
  }

  function openNewUser() {
    setSelectedUserEmail(null);
    setUserForm(blankUser());
    setUserDrawerOpen(true);
  }

  function openUser(user: User) {
    if (currentUser?.role !== "manager") return;
    setSelectedUserEmail(user.email);
    setUserForm({ email: user.email, displayName: user.displayName, role: user.role, discipline: user.discipline, temporaryPassword: "" });
    setUserDrawerOpen(true);
  }

  function updateTaskForm<K extends keyof TaskForm>(key: K, value: TaskForm[K]) {
    setTaskForm((current) => ({ ...current, [key]: value }));
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: selectedTaskId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedTaskId ? { ...taskForm, id: selectedTaskId } : taskForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر حفظ المهمة");
      setTasks((current) => selectedTaskId ? current.map((task) => task.id === selectedTaskId ? data.task : task) : [data.task, ...current]);
      setTaskDrawerOpen(false); setToast(selectedTaskId ? "تم تحديث المهمة بنجاح" : "تمت إضافة المهمة بنجاح");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المهمة"); }
    finally { setSaving(false); }
  }

  async function deleteTask() {
    if (!selectedTaskId || !window.confirm("هل تريد حذف هذه المهمة؟")) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks?id=${selectedTaskId}`, { method: "DELETE" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر حذف المهمة");
      setTasks((current) => current.filter((task) => task.id !== selectedTaskId));
      setTaskDrawerOpen(false); setToast("تم حذف المهمة");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف المهمة"); }
    finally { setSaving(false); }
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/projects", {
        method: selectedProjectId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedProjectId ? { ...projectForm, id: selectedProjectId } : projectForm),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر حفظ المشروع");
      const oldCode = projects.find((project) => project.id === selectedProjectId)?.code;
      setProjects((current) => selectedProjectId ? current.map((project) => project.id === selectedProjectId ? data.project : project) : [...current, data.project]);
      if (oldCode && oldCode !== data.project.code) setTasks((current) => current.map((task) => task.project === oldCode ? { ...task, project: data.project.code } : task));
      setProjectDrawerOpen(false); setToast(selectedProjectId ? "تم تحديث المشروع" : "تمت إضافة المشروع");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المشروع"); }
    finally { setSaving(false); }
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/users", {
        method: selectedUserEmail ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userForm),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر حفظ الموظف");
      const oldName = users.find((user) => user.email === selectedUserEmail)?.displayName;
      setUsers((current) => selectedUserEmail ? current.map((user) => user.email === selectedUserEmail ? data.user : user) : [...current, data.user]);
      if (oldName && oldName !== data.user.displayName) setTasks((current) => current.map((task) => task.employeeEmail === data.user.email ? { ...task, employeeName: data.user.displayName } : task));
      setUserDrawerOpen(false); setToast(selectedUserEmail ? "تم تحديث بيانات الموظف" : "تمت إضافة حساب الموظف");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الموظف"); }
    finally { setSaving(false); }
  }

  async function deleteUser() {
    if (!selectedUserEmail || !window.confirm("هل تريد حذف هذا الموظف؟")) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/users?email=${encodeURIComponent(selectedUserEmail)}`, { method: "DELETE" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر حذف الموظف");
      setUsers((current) => current.filter((user) => user.email !== selectedUserEmail));
      setUserDrawerOpen(false); setToast("تم حذف الموظف");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف الموظف"); }
    finally { setSaving(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  }

  function moveReport(direction: number) {
    const date = new Date(`${reportAnchor}T12:00:00`);
    if (reportPeriod === "week") date.setDate(date.getDate() + direction * 7);
    else date.setMonth(date.getMonth() + direction);
    setReportAnchor(isoDate(date));
  }

  function exportExcel() {
    const headers = ["المجموعة", "إجمالي المهام", "مكتملة", "مفتوحة", "متوقفة/تعديل", "ساعات مخططة", "ساعات فعلية"];
    const rows = reportRows.map((row) => [row.key, row.total, row.done, row.open, row.blocked, row.planned.toFixed(2), row.actual.toFixed(2)]);
    const cells = [headers, ...rows].map((row, rowIndex) => `<Row>${row.map((cell) => `<Cell ss:StyleID="${rowIndex === 0 ? "Header" : "Cell"}"><Data ss:Type="${typeof cell === "number" ? "Number" : "String"}">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`).join("");
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#DDEBF7" ss:Pattern="Solid"/></Style><Style ss:ID="Cell"/></Styles><Worksheet ss:Name="Report"><Table>${cells}</Table></Worksheet></Workbook>`;
    const blob = new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `HINDAZA_${reportPeriod}_report_${range.start}_${range.end}.xls`; link.click(); URL.revokeObjectURL(url);
    setToast("تم تنزيل تقرير Excel");
  }

  function exportPdf() {
    const popup = window.open("", "_blank", "width=1050,height=760");
    if (!popup) { setError("يرجى السماح بالنوافذ المنبثقة لتنزيل تقرير PDF."); return; }
    const rows = reportRows.map((row) => `<tr><td>${escapeXml(row.key)}</td><td>${row.total}</td><td>${row.done}</td><td>${row.open}</td><td>${row.blocked}</td><td>${row.planned.toFixed(1)}</td><td>${row.actual.toFixed(1)}</td></tr>`).join("");
    const bars = reportRows.map((row) => `<div class="bar-row"><strong>${escapeXml(row.key)}</strong><div class="bar"><i style="width:${(row.total / maxReportTotal) * 100}%"></i></div><span>${row.total}</span></div>`).join("");
    popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>HINDAZA Project Management Report</title><style>body{font-family:Arial,Tahoma,sans-serif;color:#1d1d1d;padding:30px}.logo{display:block;width:250px;height:auto;margin:0 0 20px auto;background:#171717;border-radius:10px;padding:12px}h1{color:#171717;margin:0;border-right:5px solid #ffd200;padding-right:12px}.meta{color:#737373;margin:8px 0 24px}.summary{display:flex;gap:10px;margin:20px 0}.summary div{border:1px solid #e2e2dc;border-radius:10px;padding:12px 18px}.summary strong{font-size:22px;color:#8b6c00;display:block}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{border:1px solid #e2e2dc;padding:8px;text-align:right;font-size:11px}th{background:#171717;color:white}.chart{margin:24px 0}.bar-row{display:grid;grid-template-columns:160px 1fr 35px;gap:10px;align-items:center;margin:9px 0;font-size:11px}.bar{height:16px;background:#f1f1ed;border-radius:8px;overflow:hidden}.bar i{display:block;height:100%;background:#ffd200}.footer{margin-top:30px;color:#858585;font-size:9px}@media print{body{padding:0}}</style></head><body><img class="logo" src="/hindaza-logo.png" alt="HINDAZA"><h1>HINDAZA Project Management</h1><div class="meta">${reportPeriod === "week" ? "التقرير الأسبوعي" : "التقرير الشهري"} · ${formatDate(range.start)} — ${formatDate(range.end)}</div><div class="summary"><div>إجمالي المهام<strong>${reportSummary.total}</strong></div><div>مكتملة<strong>${reportSummary.done}</strong></div><div>تحتاج متابعة<strong>${reportSummary.attention}</strong></div><div>الساعات الفعلية<strong>${reportSummary.actual.toFixed(1)}</strong></div></div><div class="chart">${bars}</div><table><thead><tr><th>المجموعة</th><th>الإجمالي</th><th>مكتملة</th><th>مفتوحة</th><th>متابعة</th><th>مخطط</th><th>فعلي</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  }

  const visibleRows = tab === "overview" ? filteredTasks.slice(0, 7) : filteredTasks;
  const navItems: { key: Tab; icon: string; ar: string; en: string }[] = [
    { key: "overview", icon: "◫", ar: "نظرة عامة", en: "Overview" },
    { key: "tasks", icon: "✓", ar: "المهام", en: "Tasks" },
    { key: "projects", icon: "▣", ar: "المشاريع", en: "Projects" },
    { key: "team", icon: "◎", ar: "الفريق", en: "Team" },
    { key: "reports", icon: "▥", ar: "التقارير", en: "Reports" },
  ];
  const pageTitle: Record<Tab, string> = { overview: "المتابعة اليومية للفريق", tasks: "إدارة مهام الفريق", projects: "إدارة المشاريع", team: "متابعة أداء الفريق", reports: "التقارير والتحليلات" };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="التنقل الرئيسي">
        <div className="brand-block"><img src="/hindaza-logo.png" alt="HINDAZA Engineering BIM" /><span>PROJECT MANAGEMENT</span></div>
        <nav className="nav-list">
          {navItems.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><span className="nav-icon">{item.icon}</span><span>{item.ar}<small>{item.en}</small></span></button>)}
        </nav>
        <div className="sidebar-user"><div className="avatar">{initials(currentUser?.displayName || "H")}</div><div><strong>{currentUser?.displayName || "جاري التحميل"}</strong><span>{currentUser?.role === "manager" ? "Manager · مسؤول" : "Team member · موظف"}</span></div><button className="logout-button" onClick={logout} aria-label="تسجيل الخروج">خروج</button></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">HINDAZA · PROJECT MANAGEMENT</p><h1>{pageTitle[tab]}</h1><p className="subhead">{new Intl.DateTimeFormat("ar-JO", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}</p></div>
          {(tab === "overview" || tab === "tasks") && <button className="primary-button" onClick={openNewTask}><span>＋</span> مهمة جديدة <small>New Task</small></button>}
          {tab === "projects" && currentUser?.role === "manager" && <button className="primary-button" onClick={openNewProject}><span>＋</span> مشروع جديد <small>New Project</small></button>}
          {tab === "team" && currentUser?.role === "manager" && <button className="primary-button" onClick={openNewUser}><span>＋</span> إضافة موظف <small>Add Employee</small></button>}
        </header>

        {error && <div className="error-banner">{error}<button onClick={() => setError("")}>×</button></div>}

        {(tab === "overview" || tab === "tasks") && <>
          <section className="stats-grid" aria-label="ملخص المهام">
            <article className="stat-card navy"><span>إجمالي المهام · Total</span><strong>{stats.total}</strong><small>في جميع المشاريع</small></article>
            <article className="stat-card green"><span>مكتملة · Done</span><strong>{stats.done}</strong><div className="progress"><i style={{ width: `${stats.total ? (stats.done / stats.total) * 100 : 0}%` }} /></div></article>
            <article className="stat-card blue"><span>مفتوحة · Open</span><strong>{stats.open}</strong><small>قيد المتابعة والتنفيذ</small></article>
            <article className="stat-card amber"><span>تحتاج متابعة · Attention</span><strong>{stats.attention}</strong><small>{stats.pending} بانتظار تدقيق المسؤول</small></article>
          </section>
          <TaskTable loading={loading} tasks={visibleRows} filteredCount={filteredTasks.length} tab={tab} employees={employees} projects={projectCodes} search={search} employeeFilter={employeeFilter} projectFilter={projectFilter} statusFilter={statusFilter} setSearch={setSearch} setEmployeeFilter={setEmployeeFilter} setProjectFilter={setProjectFilter} setStatusFilter={setStatusFilter} openTask={openTask} showAll={() => setTab("tasks")} />
        </>}

        {tab === "projects" && <section className="panel projects-panel">
          <div className="panel-heading"><div><h2>سجل المشاريع</h2><p>المشاريع النشطة والمواعيد ونسبة إنجاز المهام</p></div><span className="count-badge">{projectRows.length} مشروع</span></div>
          {projectRows.length === 0 ? <div className="empty-state"><strong>لا توجد مشاريع بعد</strong><p>أضف أول مشروع لبدء تنظيم مهام الفريق.</p></div> : <div className="project-grid">{projectRows.map((project) => <button className="project-card" key={project.id} onClick={() => openProject(project)}>
            <div className="project-card-top"><span className="project-code large">{project.code}</span><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status]}</span></div>
            <h3>{project.name}</h3><p>{project.client || "بدون اسم عميل"}</p>
            <div className="project-progress-head"><span>إنجاز المهام</span><strong>{project.progress}%</strong></div><div className="progress project-progress"><i style={{ width: `${project.progress}%` }} /></div>
            <div className="project-metrics"><div><span>المهام</span><strong>{project.total}</strong></div><div><span>مكتملة</span><strong>{project.done}</strong></div><div><span>مخطط</span><strong>{project.planned.toFixed(1)}h</strong></div><div><span>فعلي</span><strong>{project.actual.toFixed(1)}h</strong></div></div>
            <div className="project-dates"><span>البداية: {formatDate(project.startDate)}</span><span>المستهدف: {formatDate(project.targetDate)}</span></div>
          </button>)}</div>}
        </section>}

        {tab === "team" && <section className="panel team-panel">
          <div className="panel-heading"><div><h2>ملخص الفريق</h2><p>أضف موظفين مؤقتين الآن، ثم اربط حساباتهم عند نقل النظام</p></div><span className="count-badge">{teamRows.length} موظف</span></div>
          <div className="team-grid">{teamRows.map((row) => <button className="team-card" key={row.email} onClick={() => openUser(row)}>
            <div className="team-card-head"><div className="avatar soft">{initials(row.displayName)}</div><div><strong>{row.displayName}</strong><span>{row.role === "manager" ? "Manager · مسؤول" : "Member · موظف"}</span></div>{row.temporary && <em className="temporary-badge">مؤقت</em>}</div>
            <div className={`discipline-badge${row.discipline ? "" : " unset"}`}>{row.discipline || "غير محدد · Not specified"}</div>
            <div className="team-metrics"><div><span>المهام</span><strong>{row.total}</strong></div><div><span>مكتمل</span><strong>{row.done}</strong></div><div><span>متابعة</span><strong className={row.attention ? "warn-text" : ""}>{row.attention}</strong></div><div><span>فعلي</span><strong>{row.actual.toFixed(1)}h</strong></div></div>
            <div className="employee-email">{row.temporary ? "سيتم ربط البريد عند النقل" : row.email}</div>
          </button>)}</div>
        </section>}

        {tab === "reports" && <section className="report-layout">
          <div className="panel report-controls"><div className="panel-heading"><div><h2>إعداد التقرير</h2><p>أسبوعي أو شهري، حسب المشروع أو الموظف</p></div></div>
            <div className="report-filter-grid">
              <label><span>الفترة</span><select value={reportPeriod} onChange={(event) => { setReportPeriod(event.target.value as "week" | "month"); setReportScope("all"); }}><option value="week">أسبوعي · Weekly</option><option value="month">شهري · Monthly</option></select></label>
              <label><span>التجميع</span><select value={reportGroup} onChange={(event) => { setReportGroup(event.target.value as "project" | "employee"); setReportScope("all"); }}><option value="project">حسب المشروع</option><option value="employee">حسب الموظف</option></select></label>
              <label><span>{reportGroup === "project" ? "المشروع" : "الموظف"}</span><select value={reportScope} onChange={(event) => setReportScope(event.target.value)}><option value="all">الكل</option>{(reportGroup === "project" ? projectCodes : employees).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
            <div className="period-nav"><button onClick={() => moveReport(-1)}>→ السابق</button><div><strong>{formatDate(range.start)} — {formatDate(range.end)}</strong><small>{reportPeriod === "week" ? "تقرير أسبوعي" : "تقرير شهري"}</small></div><button onClick={() => moveReport(1)}>التالي ←</button></div>
            <div className="export-actions"><button className="excel-button" onClick={exportExcel} disabled={!reportRows.length}>↓ تنزيل Excel</button><button className="pdf-button" onClick={exportPdf} disabled={!reportRows.length}>↓ تنزيل PDF</button></div>
          </div>
          <div className="report-content">
            <section className="report-stats"><article><span>إجمالي المهام</span><strong>{reportSummary.total}</strong></article><article><span>مكتملة</span><strong>{reportSummary.done}</strong></article><article><span>تحتاج متابعة</span><strong>{reportSummary.attention}</strong></article><article><span>الساعات الفعلية</span><strong>{reportSummary.actual.toFixed(1)}</strong></article></section>
            <section className="panel chart-panel"><div className="panel-heading"><div><h2>عدد المهام</h2><p>{reportGroup === "project" ? "مقارنة بين المشاريع" : "مقارنة بين أعضاء الفريق"}</p></div><span className="count-badge">{reportRows.length} عناصر</span></div>
              {reportRows.length === 0 ? <div className="empty-state"><strong>لا توجد بيانات لهذه الفترة</strong><p>انتقل لفترة أخرى أو أضف مهام بالتواريخ المطلوبة.</p></div> : <div className="bar-chart">{reportRows.map((row) => <div className="bar-chart-row" key={row.key}><strong title={row.key}>{row.key}</strong><div className="bar-track"><i className="bar-total" style={{ width: `${(row.total / maxReportTotal) * 100}%` }} /><i className="bar-done" style={{ width: `${(row.done / maxReportTotal) * 100}%` }} /></div><span>{row.done}/{row.total}</span></div>)}<div className="chart-legend"><span><i className="legend-total" />إجمالي</span><span><i className="legend-done" />مكتمل</span></div></div>}
            </section>
            {reportRows.length > 0 && <section className="panel report-table-panel"><div className="task-table-wrap"><table className="task-table report-table"><thead><tr><th>{reportGroup === "project" ? "المشروع" : "الموظف"}</th><th>الإجمالي</th><th>مكتملة</th><th>مفتوحة</th><th>متوقفة/تعديل</th><th>ساعات مخططة</th><th>ساعات فعلية</th><th>الكفاءة</th></tr></thead><tbody>{reportRows.map((row) => <tr key={row.key}><td><strong>{row.key}</strong></td><td>{row.total}</td><td>{row.done}</td><td>{row.open}</td><td>{row.blocked}</td><td>{row.planned.toFixed(1)}</td><td>{row.actual.toFixed(1)}</td><td>{row.planned ? `${Math.round((row.actual / row.planned) * 100)}%` : "—"}</td></tr>)}</tbody></table></div></section>}
          </div>
        </section>}
      </main>

      {taskDrawerOpen && <TaskDrawer selectedId={selectedTaskId} form={taskForm} setOpen={setTaskDrawerOpen} saveTask={saveTask} deleteTask={deleteTask} saving={saving} currentUser={currentUser} users={users} projects={projectCodes} updateForm={updateTaskForm} />}
      {projectDrawerOpen && <ProjectDrawer selectedId={selectedProjectId} form={projectForm} setForm={setProjectForm} setOpen={setProjectDrawerOpen} saveProject={saveProject} saving={saving} />}
      {userDrawerOpen && <UserDrawer selectedEmail={selectedUserEmail} form={userForm} setForm={setUserForm} setOpen={setUserDrawerOpen} saveUser={saveUser} deleteUser={deleteUser} saving={saving} currentUser={currentUser} />}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

type TaskTableProps = {
  loading: boolean; tasks: Task[]; filteredCount: number; tab: Tab; employees: string[]; projects: string[];
  search: string; employeeFilter: string; projectFilter: string; statusFilter: string;
  setSearch: (value: string) => void; setEmployeeFilter: (value: string) => void; setProjectFilter: (value: string) => void; setStatusFilter: (value: string) => void;
  openTask: (task: Task) => void; showAll: () => void;
};

function TaskTable(props: TaskTableProps) {
  return <section className="panel"><div className="panel-heading"><div><h2>{props.tab === "overview" ? "مهام اليوم والمتابعة" : "جميع المهام"}</h2><p>اضغط على أي مهمة لعرض التفاصيل أو تحديثها</p></div><span className="count-badge">{props.filteredCount} مهمة</span></div>
    <div className="filters"><label className="search-box"><span>⌕</span><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="ابحث عن مهمة أو مشروع..." /></label><select value={props.employeeFilter} onChange={(event) => props.setEmployeeFilter(event.target.value)} aria-label="فلترة حسب الموظف"><option value="all">كل الموظفين</option>{props.employees.map((employee) => <option key={employee}>{employee}</option>)}</select><select value={props.projectFilter} onChange={(event) => props.setProjectFilter(event.target.value)} aria-label="فلترة حسب المشروع"><option value="all">كل المشاريع</option>{props.projects.map((project) => <option key={project}>{project}</option>)}</select><select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value)} aria-label="فلترة حسب الحالة"><option value="all">كل الحالات</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    {props.loading ? <div className="loading-state"><div className="spinner" /><p>جاري تحميل المهام...</p></div> : props.tasks.length === 0 ? <div className="empty-state"><strong>لا توجد مهام مطابقة</strong><p>غيّر خيارات البحث أو أضف مهمة جديدة.</p></div> : <><div className="task-table-wrap"><table className="task-table"><thead><tr><th>الموظف</th><th>المشروع والمهمة</th><th>التاريخ</th><th>الأولوية</th><th>الساعات</th><th>الحالة</th><th>تدقيق المسؤول</th><th>المؤشر</th></tr></thead><tbody>{props.tasks.map((task) => { const flag = taskFlag(task); return <tr key={task.id} onClick={() => props.openTask(task)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && props.openTask(task)}><td><div className="employee-cell"><span className="avatar small">{initials(task.employeeName)}</span><strong>{task.employeeName}</strong></div></td><td><div className="task-cell"><span className="project-code">{task.project}</span><strong>{task.title}</strong><small>{task.expectedOutput}</small></div></td><td>{formatDate(task.taskDate)}</td><td><span className={`pill priority-${task.priority}`}>{priorityLabel[task.priority]}</span></td><td><strong>{task.actualHours || "—"}</strong><small className="hours-note"> / {task.plannedHours || "—"}h</small></td><td><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span></td><td><span className={`pill check-${task.managerCheck}`}>{checkLabel[task.managerCheck]}</span></td><td><span className={`flag flag-${flag.key}`}>{flag.label}</span></td></tr>; })}</tbody></table></div>
      <div className="mobile-task-list">{props.tasks.map((task) => { const flag = taskFlag(task); return <button className="mobile-task" key={task.id} onClick={() => props.openTask(task)}><div className="mobile-task-top"><span className="project-code">{task.project}</span><span className={`flag flag-${flag.key}`}>{flag.label}</span></div><strong>{task.title}</strong><small>{task.employeeName} · {formatDate(task.taskDate)}</small><div className="mobile-task-bottom"><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span><span>{task.actualHours}/{task.plannedHours}h</span></div></button>; })}</div>
      {props.tab === "overview" && props.filteredCount > 7 && <button className="text-button" onClick={props.showAll}>عرض جميع المهام ←</button>}</>}
  </section>;
}

type TaskDrawerProps = { selectedId: number | null; form: TaskForm; setOpen: (value: boolean) => void; saveTask: (event: FormEvent) => void; deleteTask: () => void; saving: boolean; currentUser: User | null; users: User[]; projects: string[]; updateForm: <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => void; };

function TaskDrawer({ selectedId, form, setOpen, saveTask, deleteTask, saving, currentUser, users, projects, updateForm }: TaskDrawerProps) {
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="تفاصيل المهمة"><button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" /><aside className="task-drawer"><div className="drawer-head"><div><p>{selectedId ? `TASK #${selectedId}` : "NEW TASK"}</p><h2>{selectedId ? "تفاصيل وتحديث المهمة" : "إضافة مهمة جديدة"}</h2></div><button className="close-button" onClick={() => setOpen(false)} aria-label="إغلاق">×</button></div><form onSubmit={saveTask} className="task-form">
    <div className="form-section"><h3>معلومات المهمة <span>Task Information</span></h3><label className="wide"><span>اسم المهمة · Task</span><input required value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="مثال: تدقيق موديل المنطقة 02" /></label><label className="wide"><span>المخرج المتوقع · Expected Output</span><textarea value={form.expectedOutput} onChange={(event) => updateForm("expectedOutput", event.target.value)} rows={3} placeholder="ما المطلوب تسليمه عند اكتمال المهمة؟" /></label><div className="form-grid"><label><span>المشروع · Project</span><select required value={form.project} onChange={(event) => updateForm("project", event.target.value)}><option value="">اختر المشروع</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></label><label><span>التاريخ · Date</span><input type="date" value={form.taskDate} onChange={(event) => updateForm("taskDate", event.target.value)} /></label><label><span>الأولوية · Priority</span><select value={form.priority} onChange={(event) => updateForm("priority", event.target.value as Task["priority"])}>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>الحالة · Status</span><select value={form.status} onChange={(event) => updateForm("status", event.target.value as Task["status"])}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div></div>
    <div className="form-section"><h3>الموظف والوقت <span>Assignment & Time</span></h3><div className="form-grid"><label><span>الموظف · Employee</span><select disabled={currentUser?.role !== "manager"} value={form.employeeEmail} onChange={(event) => { const user = users.find((item) => item.email === event.target.value); updateForm("employeeEmail", event.target.value); if (user) updateForm("employeeName", user.displayName); }}><option value="">اختر الموظف</option>{users.map((user) => <option key={user.email} value={user.email}>{user.displayName}{user.discipline ? ` · ${user.discipline}` : ""}</option>)}</select></label><label><span>البريد · Email</span><input disabled value={form.employeeEmail} placeholder="يُعبأ تلقائيًا" /></label><label><span>ساعات مخططة · Planned</span><input type="number" min="0" step="0.25" value={form.plannedHours} onChange={(event) => updateForm("plannedHours", Number(event.target.value))} /></label><label><span>ساعات فعلية · Actual</span><input type="number" min="0" step="0.25" value={form.actualHours} onChange={(event) => updateForm("actualHours", Number(event.target.value))} /></label><label><span>وقت البدء · Start</span><input type="time" value={form.startTime} onChange={(event) => updateForm("startTime", event.target.value)} /></label><label><span>وقت النهاية · End</span><input type="time" value={form.endTime} onChange={(event) => updateForm("endTime", event.target.value)} /></label></div></div>
    {currentUser?.role === "manager" && <div className="form-section manager-section"><h3>مراجعة المسؤول <span>Manager Review</span></h3><div className="review-choice">{(["pending", "approved", "returned"] as const).map((value) => <button type="button" key={value} className={form.managerCheck === value ? `selected ${value}` : value} onClick={() => updateForm("managerCheck", value)}>{checkLabel[value]}</button>)}</div><label className="wide"><span>ملاحظة المسؤول · Manager Note</span><textarea rows={3} value={form.managerNote} onChange={(event) => updateForm("managerNote", event.target.value)} placeholder="ملاحظات التدقيق أو سبب الإرجاع..." /></label></div>}
    <div className="drawer-actions">{selectedId && currentUser?.role === "manager" && <button type="button" className="delete-button" onClick={deleteTask} disabled={saving}>حذف</button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إضافة المهمة"}</button></div>
  </form></aside></div>;
}

function ProjectDrawer({ selectedId, form, setForm, setOpen, saveProject, saving }: { selectedId: number | null; form: ProjectForm; setForm: (value: ProjectForm) => void; setOpen: (value: boolean) => void; saveProject: (event: FormEvent) => void; saving: boolean; }) {
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات المشروع"><button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" /><aside className="task-drawer compact-drawer"><div className="drawer-head"><div><p>PROJECT</p><h2>{selectedId ? "تحديث بيانات المشروع" : "إضافة مشروع جديد"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div><form onSubmit={saveProject} className="task-form"><div className="form-section"><h3>معلومات المشروع <span>Project Information</span></h3><div className="form-grid"><label><span>كود المشروع · Code</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="مثال: DH2" /></label><label><span>الحالة · Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Project["status"] })}>{Object.entries(projectStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="wide"><span>اسم المشروع · Project Name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="اسم المشروع الكامل" /></label><label className="wide"><span>العميل · Client</span><input value={form.client} onChange={(event) => setForm({ ...form, client: event.target.value })} placeholder="اسم العميل" /></label><div className="form-grid"><label><span>تاريخ البداية · Start</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label><span>التسليم المستهدف · Target</span><input type="date" value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label></div></div><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إضافة المشروع"}</button></div></form></aside></div>;
}

function UserDrawer({ selectedEmail, form, setForm, setOpen, saveUser, deleteUser, saving, currentUser }: { selectedEmail: string | null; form: UserForm; setForm: (value: UserForm) => void; setOpen: (value: boolean) => void; saveUser: (event: FormEvent) => void; deleteUser: () => void; saving: boolean; currentUser: User | null; }) {
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات الموظف"><button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" /><aside className="task-drawer compact-drawer"><div className="drawer-head"><div><p>TEAM MEMBER</p><h2>{selectedEmail ? "تحديث بيانات الموظف" : "إضافة حساب موظف"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div><form onSubmit={saveUser} className="task-form"><div className="form-section"><h3>بيانات الموظف <span>Employee Information</span></h3><label className="wide"><span>الاسم · Name</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="اسم الموظف" /></label><label className="wide"><span>التخصص · Discipline</span><select required value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value as Discipline })}><option value="" disabled>اختر التخصص</option>{disciplines.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="wide"><span>البريد · Email</span><input required type="email" disabled={Boolean(selectedEmail)} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@eng-bim.com" /></label><label className="wide"><span>{selectedEmail ? "كلمة مرور جديدة · New Password" : "كلمة مرور مؤقتة · Temporary Password"}</span><input required={!selectedEmail} minLength={10} type="password" value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} placeholder={selectedEmail ? "اتركها فارغة دون تغيير" : "10 أحرف على الأقل"} autoComplete="new-password" /></label><label className="wide"><span>الصلاحية داخل النظام · Role</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as User["role"] })}><option value="member">Member · موظف</option><option value="manager">Manager · مسؤول</option></select></label><div className="temporary-note">أرسل للموظف كلمة المرور المؤقتة بطريقة آمنة، ويمكن تغييرها لاحقًا من خلال المسؤول.</div></div><div className="drawer-actions">{selectedEmail && selectedEmail !== currentUser?.email && <button type="button" className="delete-button" onClick={deleteUser} disabled={saving}>حذف</button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جاري الحفظ..." : selectedEmail ? "حفظ التعديلات" : "إضافة الموظف"}</button></div></form></aside></div>;
}
