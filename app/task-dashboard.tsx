/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IssueReportPanel, IssuesModule, type IssuesModuleHandle } from "./issues-module";

type Discipline = "Manager" | "Architecture" | "ID" | "Structure" | "Mechanical" | "Electrical" | "Infrastructure";

type User = {
  email: string;
  displayName: string;
  role: "owner" | "manager" | "member";
  discipline: Discipline | "";
  profileImageKey: string;
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
  memberEmails: string[];
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
  status: "not_started" | "in_progress" | "paused" | "blocked" | "needs_revision" | "done";
  managerCheck: "new" | "pending" | "approved" | "returned";
  managerNote: string;
  visibility: "team" | "private";
  submittedToManager: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type TaskTimeEntry = {
  id: number;
  taskId: number;
  employeeEmail: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  createdAt: string;
};

type TaskComment = {
  id: number;
  taskId: number;
  authorEmail: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type UserRemovalWarning = {
  employeeName: string;
  taskCount: number;
  projects: Array<{ project: string; taskCount: number }>;
};

type ProjectRemovalWarning = {
  projectCode: string;
  projectName: string;
  dependencies: { tasks: number; issues: number; team: number; rfi: number };
};

type Notification = {
  id: number;
  recipientEmail: string;
  type: "task_assigned" | "review_updated" | "private_task_submitted" | "task_ready_for_review" | "issue_created" | "issue_updated";
  taskId: number | null;
  issueId: number | null;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
};

type ActivityLog = {
  id: number;
  actorEmail: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: number | null;
  entityLabel: string;
  projectCode: string;
  details: string;
  createdAt: string;
};

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type TaskForm = Omit<Task, "id" | "createdBy" | "createdAt" | "updatedAt" | "managerNote" | "submittedToManager">;
type ProjectForm = Omit<Project, "id" | "createdAt">;
type UserForm = Pick<User, "email" | "displayName" | "role" | "discipline"> & { temporaryPassword: string };
type Tab = "overview" | "tasks" | "rfi" | "issues" | "projects" | "team" | "reports" | "activity";

type WorkspaceData = {
  currentUser: User;
  tasks: Task[];
  users: User[];
  projects: Project[];
  comments: TaskComment[];
  timeEntries: TaskTimeEntry[];
  notifications: Notification[];
};

const tabValues: Tab[] = ["overview", "tasks", "rfi", "issues", "projects", "team", "reports", "activity"];
const activeTabStorageKey = "hindaza-project-management-active-tab";

function savedTab(): Tab {
  if (typeof window === "undefined") return "overview";
  const value = window.localStorage.getItem(activeTabStorageKey);
  return tabValues.includes(value as Tab) ? value as Tab : "overview";
}

async function fetchWorkspaceData(timeoutMs = 12_000): Promise<WorkspaceData | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/bootstrap", {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    if (response.status === 401) {
      window.location.replace("/login");
      return null;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "تعذر تحميل البيانات");
    return data as WorkspaceData;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("استغرق تحميل البيانات وقتًا أطول من المتوقع. يرجى إعادة المحاولة.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

const statusLabel: Record<Task["status"], string> = {
  not_started: "Not started · لم تبدأ",
  in_progress: "In progress · قيد التنفيذ",
  paused: "Paused · متوقفة مؤقتًا",
  blocked: "Blocked · متوقفة",
  needs_revision: "Revision · تحتاج تعديل",
  done: "Done · مكتملة",
};

const priorityLabel: Record<Task["priority"], string> = {
  high: "High · عالية",
  medium: "Medium · متوسطة",
  low: "Low · منخفضة",
};

const checkLabel: Record<Task["managerCheck"], string> = {
  new: "New/WIP · جديدة/قيد العمل",
  pending: "Pending · بانتظار التدقيق",
  approved: "Approved · معتمدة",
  returned: "Returned · مُعادة",
};

const projectStatusLabel: Record<Project["status"], string> = {
  active: "Active · نشط",
  on_hold: "On hold · معلّق",
  completed: "Completed · مكتمل",
};

const disciplines: Discipline[] = ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"];
function localToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function blankTask(user?: User, visibility: Task["visibility"] = "team"): TaskForm {
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
    managerCheck: "new",
    visibility,
  };
}

const blankProject = (): ProjectForm => ({
  code: "",
  name: "",
  client: "",
  status: "active",
  startDate: "",
  targetDate: "",
  memberEmails: [],
});

const blankUser = (): UserForm => ({ email: "", displayName: "", role: "member", discipline: "", temporaryPassword: "" });

function taskFlag(task: Task) {
  if (task.managerCheck === "returned" || task.status === "needs_revision") return { key: "revision", label: "Revision · تعديل" };
  if (task.status === "blocked") return { key: "blocked", label: "Blocked · متوقفة" };
  if (task.taskDate < localToday() && task.status !== "done") return { key: "late", label: "Late · متأخرة" };
  if (task.plannedHours > 0 && task.actualHours > task.plannedHours * 1.2) return { key: "overtime", label: "Overtime · تجاوز وقت" };
  return { key: "ok", label: "OK · سليمة" };
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function isManagement(user: User | null) {
  return user?.role === "owner" || user?.role === "manager";
}

function roleLabel(role: User["role"]) {
  if (role === "owner") return "Owner · المالك";
  if (role === "manager") return "Manager · مسؤول";
  return "Team member · موظف";
}

function ButtonLabel({ en, ar }: { en: string; ar: string }) {
  return <span className="button-label"><strong>{en}</strong><small dir="rtl">{ar}</small></span>;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatDueDate(value: string) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  const monthName = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(month) - 1];
  return year && monthName && day ? `${day} ${monthName} ${year}` : value;
}

function formatCreatedDate(value: string) {
  if (!value) return "—";
  const datePart = value.slice(0, 10);
  return formatDueDate(datePart);
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalized));
}

function entrySeconds(entry: TaskTimeEntry, now = Date.now()) {
  if (entry.endedAt) return entry.durationSeconds;
  const started = new Date(entry.startedAt).getTime();
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function taskLoggedHours(task: Task, entries: TaskTimeEntry[], now: number) {
  if (!entries.length) return task.actualHours;
  return entries.reduce((sum, entry) => sum + entrySeconds(entry, now), 0) / 3600;
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
  const [tabReady, setTabReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [timeEntries, setTimeEntries] = useState<TaskTimeEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [passwordDrawerOpen, setPasswordDrawerOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [userRemovalWarning, setUserRemovalWarning] = useState<UserRemovalWarning | null>(null);
  const [projectRemovalWarning, setProjectRemovalWarning] = useState<ProjectRemovalWarning | null>(null);
  const [taskForm, setTaskForm] = useState<TaskForm>(blankTask());
  const [projectForm, setProjectForm] = useState<ProjectForm>(blankProject());
  const [userForm, setUserForm] = useState<UserForm>(blankUser());
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [savingTimer, setSavingTimer] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"download" | "restore" | null>(null);
  const [profileImageBusy, setProfileImageBusy] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const issuesModuleRef = useRef<IssuesModuleHandle>(null);
  const syncInFlightRef = useRef(false);
  const [clock, setClock] = useState(0);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [teamDisciplineFilter, setTeamDisciplineFilter] = useState("all");
  const [teamRoleFilter, setTeamRoleFilter] = useState("all");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [reportType, setReportType] = useState<"tasks" | "issues" | "rfi">("tasks");
  const [reportGroup, setReportGroup] = useState<"project" | "employee">("project");
  const [reportAnchor, setReportAnchor] = useState(localToday());
  const [reportScope, setReportScope] = useState("all");

  const taskCommentCounts = useMemo(() => {
    const counts = new Map<number, number>();
    comments.forEach((comment) => counts.set(comment.taskId, (counts.get(comment.taskId) || 0) + 1));
    return counts;
  }, [comments]);

  const applyWorkspaceData = useCallback((data: WorkspaceData, initialize = false) => {
    setTasks(data.tasks || []);
    setComments(data.comments || []);
    setTimeEntries(data.timeEntries || []);
    setUsers(data.users || []);
    setProjects(data.projects || []);
    setNotifications(data.notifications || []);
    setCurrentUser(data.currentUser);
    if (data.currentUser.role === "member") {
      setTab((current) => current === "team" || current === "activity" ? "overview" : current);
    } else if (data.currentUser.role !== "owner") {
      setTab((current) => current === "activity" ? "overview" : current);
    }
    if (initialize) setTaskForm(blankTask(data.currentUser));
  }, []);

  const loadWorkspace = useCallback(async (initialize = false, showLoading = false) => {
    if (syncInFlightRef.current) return false;
    syncInFlightRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const data = await fetchWorkspaceData();
      if (!data) return false;
      applyWorkspaceData(data, initialize);
      setError("");
      setLoading(false);
      return true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل البيانات");
      setLoading(false);
      return false;
    } finally {
      syncInFlightRef.current = false;
    }
  }, [applyWorkspaceData]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadWorkspace(true, true), 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspace]);

  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      await loadWorkspace();
    };
    const interval = window.setInterval(refresh, 3_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const onFocus = () => void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadWorkspace]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setTab(savedTab());
      setTabReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (tabReady) window.localStorage.setItem(activeTabStorageKey, tab);
  }, [tab, tabReady]);

  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
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
        setPasswordDrawerOpen(false);
        setUserRemovalWarning(null);
        setProjectRemovalWarning(null);
        setAccountMenuOpen(false);
        setNotificationMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (accountMenuOpen && !accountMenuRef.current?.contains(target)) setAccountMenuOpen(false);
      if (notificationMenuOpen && !notificationMenuRef.current?.contains(target)) setNotificationMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [accountMenuOpen, notificationMenuOpen]);

  const employeeOptions = useMemo(() => {
    const disciplineByName = new Map(users.map((user) => [user.displayName, user.discipline || "Unspecified"]));
    return Array.from(new Set([...users.map((user) => user.displayName), ...tasks.map((task) => task.employeeName)]))
      .map((name) => ({ name, discipline: disciplineByName.get(name) || "Unspecified" }))
      .sort((a, b) => a.discipline.localeCompare(b.discipline) || a.name.localeCompare(b.name));
  }, [users, tasks]);
  const employees = useMemo(() => employeeOptions.map((employee) => employee.name), [employeeOptions]);
  const projectCodes = useMemo(() => Array.from(new Set([...projects.map((p) => p.code), ...tasks.map((t) => t.project)])).sort(), [projects, tasks]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const searchable = `${task.title} ${task.expectedOutput} ${task.project} ${task.employeeName}`.toLowerCase();
      return (!term || searchable.includes(term)) &&
        (employeeFilter === "all" || task.employeeName === employeeFilter) &&
        (projectFilter === "all" || task.project === projectFilter) &&
        (statusFilter === "all" || task.status === statusFilter) &&
        (reviewFilter === "all" || task.managerCheck === reviewFilter);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }, [tasks, search, employeeFilter, projectFilter, statusFilter, reviewFilter]);

  const stats = useMemo(() => {
    const count = (value: Task["managerCheck"]) => tasks.filter((task) => task.managerCheck === value).length;
    return { total: tasks.length, new: count("new"), pending: count("pending"), approved: count("approved"), returned: count("returned") };
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

  const filteredTeamRows = useMemo(() => teamRows.filter((user) =>
    (teamDisciplineFilter === "all" || user.discipline === teamDisciplineFilter) &&
    (teamRoleFilter === "all" || user.role === teamRoleFilter)
  ), [teamRows, teamDisciplineFilter, teamRoleFilter]);

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

  const filteredProjectRows = useMemo(() => projectRows.filter((project) =>
    projectStatusFilter === "all" || project.status === projectStatusFilter
  ), [projectRows, projectStatusFilter]);

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
    setCommentDraft("");
    setTaskDrawerOpen(true);
  }

  function openNewPrivateTask() {
    if (!currentUser || currentUser.role !== "member") return;
    setSelectedTaskId(null);
    const form = blankTask(currentUser, "private");
    form.project = projects[0]?.code || "PERSONAL";
    setTaskForm(form);
    setCommentDraft("");
    setTaskDrawerOpen(true);
  }

  function openTask(task: Task) {
    setSelectedTaskId(task.id);
    setTaskForm({
      taskDate: task.taskDate, employeeName: task.employeeName, employeeEmail: task.employeeEmail,
      project: task.project, title: task.title, expectedOutput: task.expectedOutput, priority: task.priority,
      plannedHours: task.plannedHours, startTime: task.startTime, endTime: task.endTime,
      actualHours: task.actualHours, status: task.status, managerCheck: task.managerCheck,
      visibility: task.visibility,
    });
    setCommentDraft("");
    setTaskDrawerOpen(true);
  }

  async function openLinkedTask(id: number) {
    setTab("tasks");
    const current = tasks.find((task) => task.id === id);
    if (current) {
      openTask(current);
      return;
    }
    const data = await fetchWorkspaceData();
    if (!data) return;
    applyWorkspaceData(data);
    const linked = data.tasks.find((task) => task.id === id);
    if (linked) openTask(linked);
  }

  function openNewProject() {
    if (currentUser?.role !== "owner") return;
    setSelectedProjectId(null);
    setProjectForm(blankProject());
    setProjectDrawerOpen(true);
  }

  function openProject(project: Project) {
    setSelectedProjectId(project.id);
    setProjectForm({ code: project.code, name: project.name, client: project.client, status: project.status, startDate: project.startDate, targetDate: project.targetDate, memberEmails: project.memberEmails || [] });
    setProjectDrawerOpen(true);
  }

  function reviewMemberProjectTasks(user: User, projectCode: string) {
    setProjectDrawerOpen(false);
    setTab("tasks");
    setSearch("");
    setEmployeeFilter(user.displayName);
    setProjectFilter(projectCode);
    setStatusFilter("all");
    setReviewFilter("all");
    setToast(`تم عرض مهام ${user.displayName} على مشروع ${projectCode} لتغيير الموظف المسؤول`);
  }

  function reviewEmployeeTasks(employeeName: string, projectCode: string) {
    setUserRemovalWarning(null);
    setUserDrawerOpen(false);
    setTab("tasks");
    setSearch("");
    setEmployeeFilter(employeeName);
    setProjectFilter(projectCode);
    setStatusFilter("all");
    setReviewFilter("all");
    setToast(`Showing ${employeeName} tasks for ${projectCode} · تم عرض المهام المفلترة`);
  }

  function openNewUser() {
    setUserRemovalWarning(null);
    setSelectedUserEmail(null);
    setUserForm(currentUser?.role === "manager"
      ? { ...blankUser(), role: "member", discipline: currentUser.discipline }
      : blankUser());
    setUserDrawerOpen(true);
  }

  function openUser(user: User) {
    if (!isManagement(currentUser)) return;
    if (currentUser?.role === "manager" && (user.role !== "member" || user.discipline !== currentUser.discipline)) return;
    if (user.role === "owner" && currentUser?.role !== "owner") return;
    setUserRemovalWarning(null);
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

  async function addComment() {
    if (!selectedTaskId || !commentDraft.trim()) return;
    setSavingComment(true); setError("");
    try {
      const response = await fetch("/api/task-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: selectedTaskId, body: commentDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to post comment");
      setComments((current) => [...current, data.comment]);
      setCommentDraft("");
      setToast("تمت إضافة الملاحظة إلى سجل المهمة");
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "تعذر إضافة الملاحظة");
    } finally {
      setSavingComment(false);
    }
  }

  function mergeTimerResponse(data: { tasks?: Task[]; timeEntries?: TaskTimeEntry[] }) {
    const changedTasks = data.tasks || [];
    const changedIds = new Set(changedTasks.map((task) => task.id));
    setTasks((current) => current.map((task) => changedTasks.find((item) => item.id === task.id) || task));
    if (data.timeEntries) {
      setTimeEntries((current) => [...current.filter((entry) => !changedIds.has(entry.taskId)), ...data.timeEntries!]);
    }
    const selected = changedTasks.find((task) => task.id === selectedTaskId);
    if (selected) openTask(selected);
    setClock(Date.now());
  }

  async function updateTimer(action: "start" | "pause" | "finish") {
    if (!selectedTaskId) return;
    setSavingTimer(true); setError("");
    try {
      const response = await fetch("/api/task-timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: selectedTaskId, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update timer.");
      mergeTimerResponse(data);
      setToast(action === "start" ? "بدأ تسجيل وقت المهمة" : action === "pause" ? "تم إيقاف الوقت مؤقتًا" : "اكتملت المهمة وأُرسلت للمراجعة");
    } catch (timerError) {
      setError(timerError instanceof Error ? timerError.message : "تعذر تحديث وقت المهمة");
    } finally {
      setSavingTimer(false);
    }
  }

  async function submitPrivateTask() {
    if (!selectedTaskId) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedTaskId, action: "submit_to_manager" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send task to manager.");
      setTasks((current) => current.map((task) => task.id === data.task.id ? data.task : task));
      openTask(data.task);
      setToast("تم إرسال المهمة الخاصة إلى المسؤول");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر إرسال المهمة للمسؤول");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!selectedTaskId || !window.confirm("هل تريد حذف هذه المهمة؟")) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks?id=${selectedTaskId}`, { method: "DELETE" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر حذف المهمة");
      setTasks((current) => current.filter((task) => task.id !== selectedTaskId));
      setComments((current) => current.filter((comment) => comment.taskId !== selectedTaskId));
      setTimeEntries((current) => current.filter((entry) => entry.taskId !== selectedTaskId));
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
      setProjectDrawerOpen(false);
      setToast(selectedProjectId
        ? data.removedInvalidMembers > 0
          ? `تم تحديث المشروع وإزالة ${data.removedInvalidMembers} عضو قديم أو غير صالح`
          : "تم تحديث المشروع"
        : "تمت إضافة المشروع");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المشروع"); }
    finally { setSaving(false); }
  }

  async function deleteProject() {
    if (!selectedProjectId || !window.confirm("Delete this empty project? · هل تريد حذف هذا المشروع الفارغ؟")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/projects?id=${selectedProjectId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.code === "PROJECT_NOT_EMPTY" && data.dependencies) {
          const selectedProject = projects.find((project) => project.id === selectedProjectId);
          setProjectRemovalWarning({
            projectCode: selectedProject?.code || projectForm.code,
            projectName: selectedProject?.name || projectForm.name,
            dependencies: {
              tasks: Number(data.dependencies.tasks) || 0,
              issues: Number(data.dependencies.issues) || 0,
              team: Number(data.dependencies.team) || 0,
              rfi: Number(data.dependencies.rfi) || 0,
            },
          });
          setProjectDrawerOpen(false);
          setError("");
          return;
        }
        throw new Error(data.error || "Unable to delete project");
      }
      setProjects((current) => current.filter((project) => project.id !== selectedProjectId));
      setProjectDrawerOpen(false); setToast("Project deleted · تم حذف المشروع");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete project"); }
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
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.code === "EMPLOYEE_HAS_ASSIGNED_TASKS" && Array.isArray(data.projects)) {
          const employeeName = users.find((user) => user.email === selectedUserEmail)?.displayName || userForm.displayName;
          setUserRemovalWarning({ employeeName, taskCount: Number(data.taskCount) || 0, projects: data.projects });
          setUserDrawerOpen(false);
          setError("");
          return;
        }
        throw new Error(data.error || "تعذر حذف الموظف");
      }
      setUsers((current) => current.filter((user) => user.email !== selectedUserEmail));
      setUserDrawerOpen(false); setToast("تم حذف الموظف");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف الموظف"); }
    finally { setSaving(false); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  }

  async function openActivityLog() {
    setAccountMenuOpen(false);
    setTab("activity");
    setActivityLoading(true);
    setError("");
    try {
      const response = await fetch("/api/activity-log", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load the activity log.");
      setActivity(data.activity || []);
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : "Unable to load the activity log.");
    } finally {
      setActivityLoading(false);
    }
  }

  async function markNotification(notification?: Notification) {
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notification ? { id: notification.id } : { all: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update notification.");
      if (notification?.issueId) {
        setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
        setNotificationMenuOpen(false);
        setTab("issues");
        window.setTimeout(() => issuesModuleRef.current?.openIssue(notification.issueId!), 150);
      } else if (notification?.taskId) {
        const freshData = await fetchWorkspaceData();
        if (freshData) applyWorkspaceData(freshData);
        const task = freshData?.tasks.find((item) => item.id === notification.taskId);
        if (task) openTask(task);
      } else {
        setNotifications((current) => current.map((item) =>
          !notification || item.id === notification.id ? { ...item, read: true } : item,
        ));
      }
      if (notification) setNotificationMenuOpen(false);
    } catch (notificationError) {
      setError(notificationError instanceof Error ? notificationError.message : "Unable to update notification.");
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New passwords do not match.");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to change password.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordDrawerOpen(false);
      setToast("تم تغيير كلمة المرور بنجاح");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "تعذر تغيير كلمة المرور");
    } finally {
      setSaving(false);
    }
  }

  async function changeProfileImage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const image = input.files?.[0];
    if (!image) return;
    setProfileImageBusy(true); setError("");
    try {
      const formData = new FormData();
      formData.append("image", image);
      const response = await fetch("/api/profile-image", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update profile image.");
      setCurrentUser((current) => current ? { ...current, profileImageKey: data.profileImageKey } : current);
      setUsers((current) => current.map((user) => user.email === currentUser?.email ? { ...user, profileImageKey: data.profileImageKey } : user));
      setAccountMenuOpen(false);
      setToast("تم تحديث صورة الحساب");
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "تعذر تحديث صورة الحساب");
    } finally {
      input.value = "";
      setProfileImageBusy(false);
    }
  }

  async function removeProfileImage() {
    if (!currentUser?.profileImageKey) return;
    setProfileImageBusy(true); setError("");
    try {
      const response = await fetch("/api/profile-image", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to remove profile image.");
      setCurrentUser((current) => current ? { ...current, profileImageKey: "" } : current);
      setUsers((current) => current.map((user) => user.email === currentUser.email ? { ...user, profileImageKey: "" } : user));
      setAccountMenuOpen(false);
      setToast("تم حذف صورة الحساب");
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "تعذر حذف صورة الحساب");
    } finally {
      setProfileImageBusy(false);
    }
  }

  async function downloadBackup() {
    setBackupBusy("download"); setError("");
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to create backup.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `hindaza-project-management-backup-${localToday()}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setToast("تم تنزيل النسخة الاحتياطية لجميع بيانات النظام");
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : "تعذر تنزيل النسخة الاحتياطية");
    } finally {
      setBackupBusy(null);
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setError("");
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("حجم ملف النسخة الاحتياطية أكبر من 20 MB.");
      const source = await file.text();
      const metadata = JSON.parse(source) as { app?: string; recordCounts?: Record<string, unknown> };
      if (metadata.app !== "HINDAZA Project Management") throw new Error("الملف المحدد ليس نسخة احتياطية صالحة للتطبيق.");
      const totalRecords = Object.values(metadata.recordCounts || {}).reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
      const confirmed = window.confirm(`سيتم استبدال جميع بيانات التطبيق الحالي بمحتويات هذا الملف (${totalRecords} سجل). احتفظ بنسخة احتياطية قبل المتابعة. هل تريد الاستعادة؟`);
      if (!confirmed) return;
      setBackupBusy("restore");
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: source,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to restore backup.");
      window.alert("تمت استعادة البيانات بنجاح مع الحفاظ على حساب المالك الحالي وكلمة مروره.");
      window.location.reload();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "تعذر استعادة النسخة الاحتياطية");
    } finally {
      input.value = "";
      setBackupBusy(null);
    }
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
    popup.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>HINDAZA Project Management Report</title><style>body{font-family:Arial,Tahoma,sans-serif;color:#1d1d1d;padding:30px;text-align:left}.logo{display:block;width:250px;height:auto;margin:0 auto 20px 0;background:#171717;border-radius:10px;padding:12px}h1{color:#171717;margin:0;border-left:5px solid #ffd200;padding-left:12px}.meta{color:#737373;margin:8px 0 24px}.summary{display:flex;gap:10px;margin:20px 0}.summary div{border:1px solid #e2e2dc;border-radius:10px;padding:12px 18px}.summary strong{font-size:22px;color:#8b6c00;display:block}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{border:1px solid #e2e2dc;padding:8px;text-align:left;font-size:11px}th{background:#171717;color:white}.chart{margin:24px 0}.bar-row{display:grid;grid-template-columns:160px 1fr 35px;gap:10px;align-items:center;margin:9px 0;font-size:11px}.bar{height:16px;background:#f1f1ed;border-radius:8px;overflow:hidden}.bar i{display:block;height:100%;background:#ffd200}.footer{margin-top:30px;color:#858585;font-size:9px}@media print{body{padding:0}}</style></head><body><img class="logo" src="/hindaza-logo.png" alt="HINDAZA"><h1>HINDAZA Project Management</h1><div class="meta">${reportPeriod === "week" ? "التقرير الأسبوعي" : "التقرير الشهري"} · ${formatDate(range.start)} — ${formatDate(range.end)}</div><div class="summary"><div>إجمالي المهام<strong>${reportSummary.total}</strong></div><div>مكتملة<strong>${reportSummary.done}</strong></div><div>تحتاج متابعة<strong>${reportSummary.attention}</strong></div><div>الساعات الفعلية<strong>${reportSummary.actual.toFixed(1)}</strong></div></div><div class="chart">${bars}</div><table><thead><tr><th>المجموعة</th><th>الإجمالي</th><th>مكتملة</th><th>مفتوحة</th><th>متابعة</th><th>مخطط</th><th>فعلي</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  }

  const visibleRows = tab === "overview" ? filteredTasks.slice(0, 7) : filteredTasks;
  const unreadNotifications = notifications.filter((notification) => !notification.read).length;
  const navItems: { key: Tab; icon: string; ar: string; en: string }[] = [
    { key: "overview", icon: "◫", ar: "نظرة عامة", en: "Overview" },
    { key: "tasks", icon: "✓", ar: "المهام", en: "Tasks" },
    { key: "rfi", icon: "?", ar: "طلبات المعلومات", en: "RFI" },
    { key: "issues", icon: "!", ar: "مشاكل المشاريع", en: "Project Issues" },
    { key: "projects", icon: "▣", ar: "المشاريع", en: "Projects" },
    { key: "team", icon: "◎", ar: "الفريق", en: "Team" },
    { key: "reports", icon: "▥", ar: "التقارير", en: "Reports" },
  ].filter((item) => isManagement(currentUser) || item.key !== "team");
  const pageTitle: Record<Tab, { en: string; ar: string }> = {
    overview: { en: "Team Daily Overview", ar: "المتابعة اليومية للفريق" },
    tasks: { en: "Task Management", ar: "إدارة مهام الفريق" },
    rfi: { en: "Request for Information", ar: "طلبات المعلومات" },
    issues: { en: "Project Issues", ar: "مشاكل المشاريع" },
    projects: { en: "Project Management", ar: "إدارة المشاريع" },
    team: { en: "Team Performance", ar: "متابعة أداء الفريق" },
    reports: { en: "Reports & Analytics", ar: "التقارير والتحليلات" },
    activity: { en: "Activity Log", ar: "سجل التعديلات والعمليات" },
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="التنقل الرئيسي">
        <div className="brand-block"><img src="/hindaza-logo.png" alt="HINDAZA Engineering BIM" /><span>PROJECT MANAGEMENT</span></div>
        <nav className="nav-list">
          {navItems.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><span className="nav-icon">{item.icon}</span><span><strong>{item.en}</strong><small dir="rtl">{item.ar}</small></span></button>)}
        </nav>
        <div className="sidebar-account" ref={accountMenuRef}>
          {accountMenuOpen && <div className="account-menu">
            <div className="account-menu-title"><strong>{currentUser?.displayName}</strong><span>{currentUser ? roleLabel(currentUser.role) : ""}</span></div>
            <label className={profileImageBusy ? "disabled" : ""}><ButtonLabel en="Change image" ar="تغيير الصورة" /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={changeProfileImage} disabled={profileImageBusy} /></label>
            {currentUser?.profileImageKey && <button onClick={removeProfileImage} disabled={profileImageBusy}><ButtonLabel en="Remove image" ar="حذف الصورة" /></button>}
            <button onClick={() => { setPasswordDrawerOpen(true); setAccountMenuOpen(false); }}><ButtonLabel en="Change password" ar="تغيير كلمة المرور" /></button>
            {currentUser?.role === "owner" && <>
              <button onClick={() => void openActivityLog()}><ButtonLabel en="Activity log" ar="سجل التعديلات" /></button>
              <button onClick={downloadBackup} disabled={Boolean(backupBusy)}><ButtonLabel en={backupBusy === "download" ? "Preparing backup…" : "Download Backup"} ar={backupBusy === "download" ? "جاري تجهيز النسخة…" : "تنزيل نسخة احتياطية"} /></button>
              <label className={backupBusy ? "disabled" : ""}><ButtonLabel en={backupBusy === "restore" ? "Restoring…" : "Restore Backup"} ar={backupBusy === "restore" ? "جاري الاستعادة…" : "استعادة نسخة احتياطية"} /><input type="file" accept="application/json,.json" onChange={restoreBackup} disabled={Boolean(backupBusy)} /></label>
              <small>Owner only · Profile photos are not included</small>
            </>}
            <button className="account-logout" onClick={logout}><ButtonLabel en="Logout" ar="تسجيل الخروج" /></button>
          </div>}
          <div className="sidebar-user">
            <div className={`avatar${currentUser?.profileImageKey ? " has-image" : ""}`}>{currentUser?.profileImageKey ? <img src={`/api/profile-image?v=${encodeURIComponent(currentUser.profileImageKey)}`} alt={currentUser.displayName} /> : initials(currentUser?.displayName || "H")}</div>
            <div className="sidebar-user-copy"><strong>{currentUser?.displayName || "جاري التحميل"}</strong><span>{currentUser ? roleLabel(currentUser.role) : ""}</span></div>
            <button className={`account-toggle${accountMenuOpen ? " open" : ""}`} onClick={() => { setNotificationMenuOpen(false); setAccountMenuOpen((open) => !open); }} aria-label="Account menu">⌃</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="page-heading"><h1 dir="ltr">{pageTitle[tab].en}</h1><p className="page-title-ar">{pageTitle[tab].ar}</p><p className="subhead" dir="ltr">{new Intl.DateTimeFormat("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}</p></div>
          <div className="topbar-actions">
            <div className="notification-center" ref={notificationMenuRef}>
              <button className={`notification-bell${unreadNotifications ? " unread" : ""}`} onClick={() => { setAccountMenuOpen(false); setNotificationMenuOpen((open) => !open); }} aria-label="Notifications"><span className="bell-icon" aria-hidden="true" />{unreadNotifications > 0 && <em>{unreadNotifications > 99 ? "99+" : unreadNotifications}</em>}</button>
              {notificationMenuOpen && <div className="notification-popover">
                <div className="notification-popover-head"><div><strong>Notifications</strong><span>الإشعارات</span></div>{notifications.length > 0 && <button onClick={() => markNotification()}><ButtonLabel en="Read all" ar="قراءة الكل" /></button>}</div>
                {notifications.length === 0 ? <div className="notification-popover-empty">لا توجد إشعارات جديدة</div> : <div className="notification-popover-list">{notifications.map((notification) => <button key={notification.id} className={notification.read ? "" : "unread"} onClick={() => markNotification(notification)}><i>{notification.issueId ? "!" : notification.type === "task_assigned" ? "+" : "✓"}</i><span><strong>{notification.title}</strong><small>{notification.message}</small><time dir="ltr">{formatDateTime(notification.createdAt)}</time></span></button>)}</div>}
              </div>}
            </div>
            {(tab === "overview" || tab === "tasks") && isManagement(currentUser) && <button className="primary-button" onClick={openNewTask}><span className="button-icon">＋</span><ButtonLabel en="New Task" ar="مهمة جديدة" /></button>}
            {(tab === "overview" || tab === "tasks") && currentUser?.role === "member" && <button className="primary-button private-task-button" onClick={openNewPrivateTask}><span className="button-icon">＋</span><ButtonLabel en="Private Task" ar="مهمة خاصة" /></button>}
            {tab === "issues" && <button className="primary-button" onClick={() => issuesModuleRef.current?.openNew()}><span className="button-icon">＋</span><ButtonLabel en="New Issue" ar="مشكلة جديدة" /></button>}
            {tab === "projects" && currentUser?.role === "owner" && <button className="primary-button" onClick={openNewProject}><span className="button-icon">＋</span><ButtonLabel en="New Project" ar="مشروع جديد" /></button>}
            {tab === "team" && isManagement(currentUser) && <button className="primary-button" onClick={openNewUser}><span className="button-icon">＋</span><ButtonLabel en="Add Employee" ar="إضافة موظف" /></button>}
          </div>
        </header>

        {error && <div className="error-banner"><span>{error}</span><div className="error-actions"><button className="retry-load-button" onClick={() => void loadWorkspace(!currentUser, true)}><ButtonLabel en="Retry" ar="إعادة المحاولة" /></button><button className="dismiss-error-button" onClick={() => setError("")} aria-label="Close">×</button></div></div>}

        {(tab === "overview" || tab === "tasks") && <>
          <section className="stats-grid" aria-label="ملخص المهام">
            <article className="stat-card navy"><span>إجمالي المهام · Total</span><strong>{stats.total}</strong><small>جميع المهام الظاهرة لك</small></article>
            <article className="stat-card violet"><span>جديدة/قيد العمل · New/WIP</span><strong>{stats.new}</strong><small>جديدة أو قيد التنفيذ</small></article>
            <article className="stat-card blue"><span>بانتظار المراجعة · Pending</span><strong>{stats.pending}</strong><small>قيد مراجعة المسؤول</small></article>
            <article className="stat-card green"><span>معتمدة · Approved</span><strong>{stats.approved}</strong><small>تم اعتمادها من المسؤول</small></article>
            <article className="stat-card amber"><span>مُعادة · Returned</span><strong>{stats.returned}</strong><small>تحتاج إجراء من الموظف</small></article>
          </section>
          <TaskTable loading={loading} tasks={visibleRows} filteredCount={filteredTasks.length} tab={tab} employees={employeeOptions} projects={projectCodes} search={search} employeeFilter={employeeFilter} projectFilter={projectFilter} statusFilter={statusFilter} reviewFilter={reviewFilter} showEmployeeFilter={currentUser?.role !== "member"} setSearch={setSearch} setEmployeeFilter={setEmployeeFilter} setProjectFilter={setProjectFilter} setStatusFilter={setStatusFilter} setReviewFilter={setReviewFilter} openTask={openTask} showAll={() => setTab("tasks")} timeEntries={timeEntries} clock={clock} commentCounts={taskCommentCounts} />
        </>}

        {tab === "rfi" && <section className="panel module-placeholder">
          <div className="module-icon">{tab === "rfi" ? "RFI" : "!"}</div>
          <p>{tab === "rfi" ? "REQUEST FOR INFORMATION" : "PROJECT ISSUES"}</p>
          <h2>{tab === "rfi" ? "بوابة طلبات المعلومات" : "سجل مشاكل المشاريع"}</h2>
          <span>تمت إضافة الوحدة إلى النظام، وسيتم استكمال الحقول ومسار العمل في المرحلة التالية.</span>
          <div className="module-status">جاهزة لإضافة التفاصيل · Ready for configuration</div>
        </section>}

        {tab === "issues" && currentUser && <IssuesModule ref={issuesModuleRef} currentUser={currentUser} users={users} projects={projects} onTaskCreated={(task) => setTasks((current) => [task as Task, ...current])} onOpenTask={(id) => void openLinkedTask(id)} onToast={setToast} />}

        {tab === "projects" && <section className="panel projects-panel">
          <div className="directory-filters project-filter-row"><select value={projectStatusFilter} onChange={(event) => setProjectStatusFilter(event.target.value)} aria-label="فلترة المشاريع حسب الحالة"><option value="all">كل حالات المشاريع · All statuses</option>{Object.entries(projectStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="count-badge filter-count" dir="ltr">{filteredProjectRows.length} {filteredProjectRows.length === 1 ? "Project" : "Projects"}</span></div>
          {filteredProjectRows.length === 0 ? <div className="empty-state"><strong>{projectRows.length ? "لا توجد مشاريع مطابقة" : "لا توجد مشاريع بعد"}</strong><p>{projectRows.length ? "غيّر حالة المشروع المختارة لعرض نتائج أخرى." : "أضف أول مشروع لبدء تنظيم مهام الفريق."}</p></div> : <div className="project-grid">{filteredProjectRows.map((project) => <button className="project-card" key={project.id} onClick={() => openProject(project)}>
            <div className="project-card-top"><span className="project-code large">{project.code}</span><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status]}</span></div>
            <h3>{project.name}</h3><p>{project.client || "بدون اسم عميل"}</p>
            <div className="project-progress-head"><span>إنجاز المهام</span><strong>{project.progress}%</strong></div><div className="progress project-progress"><i style={{ width: `${project.progress}%` }} /></div>
            <div className="project-metrics"><div><span>المهام</span><strong>{project.total}</strong></div><div><span>مكتملة</span><strong>{project.done}</strong></div><div><span>مخطط</span><strong>{project.planned.toFixed(1)}h</strong></div><div><span>فعلي</span><strong>{project.actual.toFixed(1)}h</strong></div></div>
            <div className="project-dates"><span>البداية: {formatDate(project.startDate)}</span><span>المستهدف: {formatDate(project.targetDate)}</span></div>
            <div className="project-team-count">{project.memberEmails.length} أعضاء في Project · المشروع members</div>
          </button>)}</div>}
        </section>}

        {tab === "team" && <section className="panel team-panel">
          <div className="directory-filters team-filter-row"><select value={teamDisciplineFilter} onChange={(event) => setTeamDisciplineFilter(event.target.value)} aria-label="فلترة الفريق حسب التخصص"><option value="all">كل التخصصات · All disciplines</option>{disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select><select value={teamRoleFilter} onChange={(event) => setTeamRoleFilter(event.target.value)} aria-label="فلترة الفريق حسب المسؤولية"><option value="all">كل المسؤوليات · All roles</option><option value="member">Member · موظف</option><option value="manager">Manager · مسؤول</option><option value="owner">Owner · مالك</option></select><button type="button" className="clear-filters-button" disabled={teamDisciplineFilter === "all" && teamRoleFilter === "all"} onClick={() => { setTeamDisciplineFilter("all"); setTeamRoleFilter("all"); }} aria-label="Clear all team filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{filteredTeamRows.length} {filteredTeamRows.length === 1 ? "Employee" : "Employees"}</span></div>
          {filteredTeamRows.length === 0 ? <div className="empty-state"><strong>لا يوجد موظفون مطابقون</strong><p>غيّر التخصص أو المسؤولية لعرض نتائج أخرى.</p></div> : <div className="team-grid">{filteredTeamRows.map((row) => <button className="team-card" key={row.email} onClick={() => openUser(row)}>
            <div className="team-card-head"><div className="avatar soft">{initials(row.displayName)}</div><div><strong>{row.displayName}</strong><span>{roleLabel(row.role)}</span></div>{row.temporary && <em className="temporary-badge">مؤقت</em>}</div>
            <div className={`discipline-badge${row.discipline ? "" : " unset"}`}>{row.discipline || "غير محدد · Not specified"}</div>
            <div className="team-metrics"><div><span>المهام</span><strong>{row.total}</strong></div><div><span>مكتمل</span><strong>{row.done}</strong></div><div><span>متابعة</span><strong className={row.attention ? "warn-text" : ""}>{row.attention}</strong></div><div><span>فعلي</span><strong>{row.actual.toFixed(1)}h</strong></div></div>
            <div className="employee-email">{row.temporary ? "سيتم ربط البريد عند النقل" : row.email}</div>
          </button>)}</div>}
        </section>}

        {tab === "activity" && currentUser?.role === "owner" && <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>Activity Log</h2><p>سجل شامل للإنشاء والتعديل والحذف وجميع العمليات في التطبيق</p></div><button className="secondary-button activity-refresh" onClick={() => void openActivityLog()} disabled={activityLoading}><ButtonLabel en={activityLoading ? "Loading..." : "Refresh"} ar={activityLoading ? "جاري التحميل" : "تحديث"} /></button></div>
          {activityLoading ? <div className="loading-state"><div className="spinner" /><p>Loading activity...</p></div> : activity.length === 0 ? <div className="empty-state"><strong>No recorded activity</strong><p>لا توجد عمليات مسجلة حتى الآن.</p></div> : <div className="task-table-wrap"><table className="task-table activity-table"><thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Type</th><th>Item</th><th>Project</th><th>Details</th></tr></thead><tbody>{activity.map((entry) => <tr key={entry.id}><td dir="ltr">{formatDateTime(entry.createdAt)}</td><td><strong>{entry.actorName}</strong><small>{entry.actorEmail}</small></td><td><span className={`activity-action action-${entry.action}`}>{entry.action.replaceAll("_", " ")}</span></td><td>{({ task: "Task · مهمة", issue: "Issue · مشكلة", project: "Project · مشروع", user: "User · مستخدم", account: "Account · حساب", backup: "Backup · نسخة احتياطية", notification: "Notification · إشعار" } as Record<string, string>)[entry.entityType] || entry.entityType}</td><td>{entry.entityId && entry.action !== "deleted" && (entry.entityType === "task" || entry.entityType === "issue") ? <button className="activity-link" onClick={() => { if (entry.entityType === "task") void openLinkedTask(entry.entityId!); else { setTab("issues"); window.setTimeout(() => issuesModuleRef.current?.openIssue(entry.entityId!), 150); } }}>{entry.entityLabel}</button> : <strong>{entry.entityLabel}</strong>}</td><td><span className="project-code">{entry.projectCode || "—"}</span></td><td>{entry.details || "—"}</td></tr>)}</tbody></table></div>}
        </section>}

        {tab === "reports" && <div className="reports-workspace"><div className="report-type-selector" role="tablist" aria-label="Report type"><button className={reportType === "tasks" ? "active" : ""} onClick={() => setReportType("tasks")}>Task Report <small>تقرير المهام</small></button><button className={reportType === "issues" ? "active" : ""} onClick={() => setReportType("issues")}>Project Issues <small>مشاكل المشاريع</small></button><button className={reportType === "rfi" ? "active" : ""} onClick={() => setReportType("rfi")}>RFI <small>طلبات المعلومات</small></button></div>
        {reportType === "tasks" && <section className="report-layout">
          <div className="panel report-controls"><div className="panel-heading"><div><h2>إعداد التقرير</h2><p>أسبوعي أو شهري، حسب المشروع أو الموظف</p></div></div>
            <div className="report-filter-grid">
              <label><span>الفترة</span><select value={reportPeriod} onChange={(event) => { setReportPeriod(event.target.value as "week" | "month"); setReportScope("all"); }}><option value="week">أسبوعي · Weekly</option><option value="month">شهري · Monthly</option></select></label>
              <label><span>التجميع</span><select value={reportGroup} onChange={(event) => { setReportGroup(event.target.value as "project" | "employee"); setReportScope("all"); }}><option value="project">حسب المشروع</option><option value="employee">حسب الموظف</option></select></label>
              <label><span>{reportGroup === "project" ? "المشروع" : "الموظف"}</span><select value={reportScope} onChange={(event) => setReportScope(event.target.value)}><option value="all">الكل</option>{(reportGroup === "project" ? projectCodes : employees).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
            <div className="period-nav"><button onClick={() => moveReport(-1)}><ButtonLabel en="← Previous" ar="السابق" /></button><div><strong>{formatDate(range.start)} — {formatDate(range.end)}</strong><small>{reportPeriod === "week" ? "تقرير أسبوعي" : "تقرير شهري"}</small></div><button onClick={() => moveReport(1)}><ButtonLabel en="Next →" ar="التالي" /></button></div>
            <div className="export-actions"><button className="excel-button" onClick={exportExcel} disabled={!reportRows.length}><ButtonLabel en="↓ Download Excel" ar="تنزيل إكسل" /></button><button className="pdf-button" onClick={exportPdf} disabled={!reportRows.length}><ButtonLabel en="↓ Download PDF" ar="تنزيل PDF" /></button></div>
          </div>
          <div className="report-content">
            <section className="report-stats"><article><span>إجمالي المهام</span><strong>{reportSummary.total}</strong></article><article><span>مكتملة</span><strong>{reportSummary.done}</strong></article><article><span>تحتاج متابعة</span><strong>{reportSummary.attention}</strong></article><article><span>الساعات الفعلية</span><strong>{reportSummary.actual.toFixed(1)}</strong></article></section>
            <section className="panel chart-panel"><div className="panel-heading"><div><h2>عدد المهام</h2><p>{reportGroup === "project" ? "مقارنة بين المشاريع" : "مقارنة بين أعضاء الفريق"}</p></div><span className="count-badge">{reportRows.length} عناصر</span></div>
              {reportRows.length === 0 ? <div className="empty-state"><strong>لا توجد بيانات لهذه الفترة</strong><p>انتقل لفترة أخرى أو أضف مهام بالتواريخ المطلوبة.</p></div> : <div className="bar-chart">{reportRows.map((row) => <div className="bar-chart-row" key={row.key}><strong title={row.key}>{row.key}</strong><div className="bar-track"><i className="bar-total" style={{ width: `${(row.total / maxReportTotal) * 100}%` }} /><i className="bar-done" style={{ width: `${(row.done / maxReportTotal) * 100}%` }} /></div><span>{row.done}/{row.total}</span></div>)}<div className="chart-legend"><span><i className="legend-total" />إجمالي</span><span><i className="legend-done" />مكتمل</span></div></div>}
            </section>
            {reportRows.length > 0 && <section className="panel report-table-panel"><div className="task-table-wrap"><table className="task-table report-table"><thead><tr><th>{reportGroup === "project" ? "المشروع" : "الموظف"}</th><th>الإجمالي</th><th>مكتملة</th><th>مفتوحة</th><th>متوقفة/تعديل</th><th>ساعات مخططة</th><th>ساعات فعلية</th><th>الكفاءة</th></tr></thead><tbody>{reportRows.map((row) => <tr key={row.key}><td><strong>{row.key}</strong></td><td>{row.total}</td><td>{row.done}</td><td>{row.open}</td><td>{row.blocked}</td><td>{row.planned.toFixed(1)}</td><td>{row.actual.toFixed(1)}</td><td>{row.planned ? `${Math.round((row.actual / row.planned) * 100)}%` : "—"}</td></tr>)}</tbody></table></div></section>}
          </div>
        </section>}
        {reportType === "issues" && <IssueReportPanel projects={projects} />}
        {reportType === "rfi" && <section className="panel module-placeholder report-rfi-placeholder"><div className="module-icon">RFI</div><p>REQUEST FOR INFORMATION</p><h2>RFI Report</h2><span>سيتم تفعيل تقرير طلبات المعلومات عند تطوير وحدة RFI لاحقًا.</span></section>}
        </div>}
      </main>

      {projectRemovalWarning && <div className="drawer-layer dependency-warning-layer" role="dialog" aria-modal="true" aria-label="Project deletion blocked"><button className="drawer-backdrop" onClick={() => setProjectRemovalWarning(null)} aria-label="Close warning" /><section className="dependency-warning-dialog project-dependency-warning"><div className="dependency-warning-icon">!</div><h2>Project cannot be deleted</h2><h3>لا يمكن حذف المشروع حاليًا</h3><p><strong>{projectRemovalWarning.projectCode} · {projectRemovalWarning.projectName}</strong> still contains linked records. Remove all items below, then try deleting the project again.</p><p dir="rtl">يحتوي المشروع على بيانات مرتبطة. يجب إزالة جميع العناصر التالية أولًا ثم إعادة محاولة الحذف.</p><div className="project-dependency-counts"><div><strong>{projectRemovalWarning.dependencies.tasks}</strong><span>Tasks</span><small>مهام</small></div><div><strong>{projectRemovalWarning.dependencies.issues}</strong><span>Issues</span><small>مشاكل</small></div><div><strong>{projectRemovalWarning.dependencies.team}</strong><span>Team</span><small>أعضاء الفريق</small></div><div><strong>{projectRemovalWarning.dependencies.rfi}</strong><span>RFI</span><small>طلبات معلومات</small></div></div><div className="project-dependency-note">Only an empty project can be deleted · يمكن حذف المشروع فقط عندما يكون فارغًا بالكامل</div><button className="secondary-button dependency-close" onClick={() => setProjectRemovalWarning(null)}><ButtonLabel en="Close" ar="إغلاق" /></button></section></div>}

      {userRemovalWarning && <div className="drawer-layer dependency-warning-layer" role="dialog" aria-modal="true" aria-label="Employee assigned tasks warning"><button className="drawer-backdrop" onClick={() => setUserRemovalWarning(null)} aria-label="Close warning" /><section className="dependency-warning-dialog"><div className="dependency-warning-icon">!</div><h2>Employee has assigned tasks</h2><h3>لدى الموظف مهام موكلة إليه</h3><p><strong>{userRemovalWarning.employeeName}</strong> has {userRemovalWarning.taskCount} assigned task(s). Reassign these tasks before deleting the employee.</p><p dir="rtl">يجب تغيير الموظف المسؤول عن هذه المهام قبل حذف الموظف من النظام.</p><div className="dependency-project-links">{userRemovalWarning.projects.map((item) => <button key={item.project} onClick={() => reviewEmployeeTasks(userRemovalWarning.employeeName, item.project)}><span>↗</span><strong>Open {item.project} tasks</strong><small>{item.taskCount} tasks · فتح المهام المفلترة</small></button>)}</div><button className="secondary-button dependency-close" onClick={() => setUserRemovalWarning(null)}><ButtonLabel en="Cancel" ar="إلغاء" /></button></section></div>}
      {taskDrawerOpen && <TaskDrawer selectedId={selectedTaskId} form={taskForm} setOpen={setTaskDrawerOpen} saveTask={saveTask} deleteTask={deleteTask} saving={saving} currentUser={currentUser} users={users} projects={projects} updateForm={updateTaskForm} comments={comments.filter((comment) => comment.taskId === selectedTaskId)} commentDraft={commentDraft} setCommentDraft={setCommentDraft} addComment={addComment} savingComment={savingComment} task={tasks.find((task) => task.id === selectedTaskId) || null} timeEntries={timeEntries.filter((entry) => entry.taskId === selectedTaskId)} clock={clock} updateTimer={updateTimer} savingTimer={savingTimer} submitPrivateTask={submitPrivateTask} />}
      {projectDrawerOpen && <ProjectDrawer selectedId={selectedProjectId} form={projectForm} setForm={setProjectForm} setOpen={setProjectDrawerOpen} saveProject={saveProject} deleteProject={deleteProject} saving={saving} users={users} tasks={tasks} currentUser={currentUser} projectCode={projects.find((project) => project.id === selectedProjectId)?.code || projectForm.code} onResolveMemberTasks={reviewMemberProjectTasks} />}
      {userDrawerOpen && <UserDrawer selectedEmail={selectedUserEmail} form={userForm} setForm={setUserForm} setOpen={setUserDrawerOpen} saveUser={saveUser} deleteUser={deleteUser} saving={saving} currentUser={currentUser} projects={projects} />}
      {passwordDrawerOpen && <PasswordDrawer form={passwordForm} setForm={setPasswordForm} setOpen={setPasswordDrawerOpen} changePassword={changePassword} saving={saving} />}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

type TaskTableProps = {
  loading: boolean; tasks: Task[]; filteredCount: number; tab: Tab; employees: { name: string; discipline: string }[]; projects: string[];
  search: string; employeeFilter: string; projectFilter: string; statusFilter: string; reviewFilter: string; showEmployeeFilter: boolean;
  setSearch: (value: string) => void; setEmployeeFilter: (value: string) => void; setProjectFilter: (value: string) => void; setStatusFilter: (value: string) => void; setReviewFilter: (value: string) => void;
  openTask: (task: Task) => void; showAll: () => void;
  timeEntries: TaskTimeEntry[]; clock: number;
  commentCounts: Map<number, number>;
};

function TaskTable(props: TaskTableProps) {
  const filtersActive = Boolean(props.search.trim()) || props.employeeFilter !== "all" || props.projectFilter !== "all" || props.statusFilter !== "all" || props.reviewFilter !== "all";
  const clearFilters = () => {
    props.setSearch("");
    props.setEmployeeFilter("all");
    props.setProjectFilter("all");
    props.setStatusFilter("all");
    props.setReviewFilter("all");
  };
  return <section className="panel">
    <div className="filters"><label className="search-box"><span>⌕</span><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Search for a task or project..." /></label>{props.showEmployeeFilter && <select value={props.employeeFilter} onChange={(event) => props.setEmployeeFilter(event.target.value)} aria-label="Filter by employee"><option value="all">All employees · كل الموظفين</option>{props.employees.map((employee) => <option key={employee.name} value={employee.name}>{employee.name} ({employee.discipline})</option>)}</select>}<select value={props.projectFilter} onChange={(event) => props.setProjectFilter(event.target.value)} aria-label="Filter by project"><option value="all">All projects · كل المشاريع</option>{props.projects.map((project) => <option key={project}>{project}</option>)}</select><select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="all">All employee statuses · كل حالات الموظف</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={props.reviewFilter} onChange={(event) => props.setReviewFilter(event.target.value)} aria-label="Filter by manager review"><option value="all">All manager reviews · كل مراجعات المسؤول</option>{Object.entries(checkLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="clear-filters-button" onClick={clearFilters} disabled={!filtersActive} aria-label="Clear all task filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{props.filteredCount} {props.filteredCount === 1 ? "Task" : "Tasks"}</span></div>
    {props.loading ? <div className="loading-state"><div className="spinner" /><p>جاري تحميل المهام...</p></div> : props.tasks.length === 0 ? <div className="empty-state"><strong>لا توجد مهام مطابقة</strong><p>غيّر خيارات البحث أو أضف مهمة جديدة.</p></div> : <><div className="task-table-wrap"><table className={`task-table task-data-table task-table-ltr${props.showEmployeeFilter ? "" : " member-task-table"}`}><thead><tr><th>Task / Project</th>{props.showEmployeeFilter && <th>Employee</th>}<th>Created Date</th><th>Due Date</th><th>Priority</th><th>Hours</th><th>Status</th><th>Manager Review</th><th>Indicator</th></tr></thead><tbody>{props.tasks.map((task) => { const flag = taskFlag(task); const entries = props.timeEntries.filter((entry) => entry.taskId === task.id); const logged = taskLoggedHours(task, entries, props.clock); const active = entries.some((entry) => !entry.endedAt); const noteCount = props.commentCounts.get(task.id) || 0; return <tr key={task.id} onClick={() => props.openTask(task)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && props.openTask(task)}><td><div className="task-cell"><strong>{task.title}</strong><div className="task-tags"><span className="project-code">{task.project}</span>{task.visibility === "private" && <span className="private-badge">Private</span>}{noteCount > 0 && <span className="note-indicator" title={`${noteCount} notes · ${noteCount} ملاحظات`} aria-label={`${noteCount} notes`}>▰ <small>{noteCount}</small></span>}</div><small>{task.expectedOutput}</small></div></td>{props.showEmployeeFilter && <td><div className="employee-cell"><span className="avatar small">{initials(task.employeeName)}</span><strong>{task.employeeName}</strong></div></td>}<td><span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span></td><td><span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></td><td><span className={`pill priority-${task.priority}`}>{priorityLabel[task.priority]}</span></td><td><strong className={active ? "live-hours" : ""}>{logged ? logged.toFixed(2) : "—"}{active && <i />}</strong><small className="hours-note"> / {task.plannedHours || "—"}h</small></td><td><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span></td><td><span className={`pill check-${task.managerCheck}`}>{checkLabel[task.managerCheck]}</span></td><td><span className={`flag flag-${flag.key}`}>{flag.label}</span></td></tr>; })}</tbody></table></div>
      <div className="mobile-task-list">{props.tasks.map((task) => { const flag = taskFlag(task); const entries = props.timeEntries.filter((entry) => entry.taskId === task.id); const logged = taskLoggedHours(task, entries, props.clock); return <button className="mobile-task" key={task.id} onClick={() => props.openTask(task)}><div className="mobile-task-top"><div className="task-tags"><span className="project-code">{task.project}</span>{task.visibility === "private" && <span className="private-badge">خاص · Private</span>}</div><span className={`flag flag-${flag.key}`}>{flag.label}</span></div><strong>{task.title}</strong><small>{props.showEmployeeFilter ? `${task.employeeName} · ` : ""}<span className="mobile-date-label">Created</span> <span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span> · <span className="mobile-date-label">Due</span> <span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></small><div className="mobile-task-bottom"><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span><span>{logged.toFixed(2)}/{task.plannedHours}h</span></div></button>; })}</div>
      {props.tab === "overview" && props.filteredCount > 7 && <button className="text-button" onClick={props.showAll}><ButtonLabel en="View all tasks →" ar="عرض جميع المهام" /></button>}</>}
  </section>;
}

type TaskDrawerProps = {
  selectedId: number | null;
  form: TaskForm;
  setOpen: (value: boolean) => void;
  saveTask: (event: FormEvent) => void;
  deleteTask: () => void;
  saving: boolean;
  currentUser: User | null;
  users: User[];
  projects: Project[];
  updateForm: <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => void;
  comments: TaskComment[];
  commentDraft: string;
  setCommentDraft: (value: string) => void;
  addComment: () => void;
  savingComment: boolean;
  task: Task | null;
  timeEntries: TaskTimeEntry[];
  clock: number;
  updateTimer: (action: "start" | "pause" | "finish") => void;
  savingTimer: boolean;
  submitPrivateTask: () => void;
};

function TaskDrawer({ selectedId, form, setOpen, saveTask, deleteTask, saving, currentUser, users, projects, updateForm, comments, commentDraft, setCommentDraft, addComment, savingComment, task, timeEntries, clock, updateTimer, savingTimer, submitPrivateTask }: TaskDrawerProps) {
  const privateOwner = currentUser?.role === "member" && form.visibility === "private" && (!task || (task.createdBy === currentUser.email && !task.submittedToManager));
  const management = isManagement(currentUser);
  const canEditDetails = management || privateOwner;
  const activeEntry = timeEntries.find((entry) => !entry.endedAt);
  const loggedSeconds = timeEntries.length
    ? timeEntries.reduce((sum, entry) => sum + entrySeconds(entry, clock), 0)
    : Math.round((task?.actualHours || form.actualHours || 0) * 3600);
  const projectOptions = Array.from(new Set([...projects.map((project) => project.code), ...(form.visibility === "private" ? ["PERSONAL"] : [])]));
  const selectedProject = projects.find((project) => project.code === form.project);
  const projectUsers = form.project === "PERSONAL"
    ? users.filter((user) => user.email === form.employeeEmail)
    : users.filter((user) => (user.role === "member" || user.role === "manager") && selectedProject?.memberEmails.includes(user.email));
  const assignmentOptions = form.employeeEmail && !projectUsers.some((user) => user.email === form.employeeEmail)
    ? [...projectUsers, ...users.filter((user) => user.email === form.employeeEmail)]
    : projectUsers;
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="تفاصيل المهمة">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" />
    <aside className="task-drawer">
      <div className="drawer-head"><div><p>{selectedId ? `TASK #${selectedId}` : form.visibility === "private" ? "NEW PRIVATE TASK" : "NEW TASK"}</p><h2>{selectedId ? "Task Details & Update" : form.visibility === "private" ? "New Private Task" : "New Task"}</h2>{form.visibility === "private" && <span className="drawer-private-label">Private · خاص</span>}</div><button className="close-button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
      <form onSubmit={saveTask} className="task-form" dir="ltr">
        <div className="form-section"><h3>Task Information <span>معلومات المهمة</span></h3><label className="wide"><span>Task · اسم المهمة</span><input required disabled={!canEditDetails} value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="مثال: تدقيق موديل المنطقة 02" /></label><label className="wide"><span>Expected Output · المخرج المتوقع</span><textarea disabled={!canEditDetails} value={form.expectedOutput} onChange={(event) => updateForm("expectedOutput", event.target.value)} rows={3} placeholder="ما المطلوب تسليمه عند اكتمال المهمة؟" /></label><div className="form-grid"><label><span>Project · المشروع</span><select required disabled={!canEditDetails} value={form.project} onChange={(event) => { const code = event.target.value; updateForm("project", code); const project = projects.find((item) => item.code === code); if (management && !project?.memberEmails.includes(form.employeeEmail)) { updateForm("employeeEmail", ""); updateForm("employeeName", ""); } }}><option value="">اختر المشروع</option>{projectOptions.map((project) => <option key={project}>{project}</option>)}</select></label><label><span>Created Date · تاريخ الإنشاء</span><input className="due-date" dir="ltr" disabled value={selectedId ? formatCreatedDate(task?.createdAt || "") : "Automatic on save"} /></label><label><span>Due Date · تاريخ الإنجاز المتوقع</span><input type="date" lang="en-GB" disabled={!canEditDetails} value={form.taskDate} onChange={(event) => updateForm("taskDate", event.target.value)} /></label><label><span>Priority · الأولوية</span><select disabled={!canEditDetails} value={form.priority} onChange={(event) => updateForm("priority", event.target.value as Task["priority"])}>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Status · الحالة</span><select disabled value={form.status}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div></div>
        <div className="form-section"><h3>Assignment & Time <span>الموظف والوقت</span></h3><div className="form-grid"><label><span>Employee · الموظف</span><select disabled={!management} required value={form.employeeEmail} onChange={(event) => { const user = users.find((item) => item.email === event.target.value); updateForm("employeeEmail", event.target.value); if (user) updateForm("employeeName", user.displayName); }}><option value="">{form.project ? "اختر موظفًا من فريق المشروع" : "اختر المشروع أولاً"}</option>{assignmentOptions.map((user) => <option key={user.email} value={user.email}>{user.displayName}{user.discipline ? ` · ${user.discipline}` : ""}</option>)}</select></label><label><span>Email · البريد</span><input disabled value={form.employeeEmail} placeholder="يُعبأ تلقائيًا" /></label><label><span>Planned Hours · الساعات المخططة</span><input type="number" disabled={!canEditDetails} min="0" step="0.25" value={form.plannedHours} onChange={(event) => updateForm("plannedHours", Number(event.target.value))} /></label><label><span>Logged Hours · الساعات المسجلة</span><input disabled value={formatDuration(loggedSeconds)} /></label></div></div>
        {selectedId && currentUser?.role !== "owner" && task?.employeeEmail === currentUser.email && <div className="form-section timer-section"><div className="timer-head"><div><h3>Work Timer <span>تسجيل وقت العمل</span></h3><p>يمكنك إيقاف المهمة للبريك أو عند الانتقال لمهمة أخرى، ثم استئنافها في أي يوم لاحق.</p></div><strong className={activeEntry ? "running" : ""} dir="ltr">{formatDuration(loggedSeconds)}</strong></div><div className="timer-actions">{activeEntry ? <button type="button" className="pause-task-button" onClick={() => updateTimer("pause")} disabled={savingTimer}><ButtonLabel en="Ⅱ Pause" ar="إيقاف مؤقت" /></button> : <button type="button" className="start-task-button" onClick={() => updateTimer("start")} disabled={savingTimer || task.managerCheck === "approved"}><ButtonLabel en="▶ Start / Resume" ar="ابدأ / استأنف" /></button>}{task.status !== "done" && <button type="button" className="finish-task-button" onClick={() => updateTimer("finish")} disabled={savingTimer}><ButtonLabel en="✓ Finish & Submit" ar="إنهاء وإرسال للمراجعة" /></button>}</div>{task.managerCheck === "approved" && <div className="timer-lock-note">المهمة معتمدة. يجب على المسؤول إعادة فتح المراجعة قبل استئناف العمل.</div>}</div>}
        {selectedId && timeEntries.length > 0 && <div className="form-section time-history"><div className="comments-heading"><h3>Work Sessions <span>سجل جلسات العمل</span></h3><span>{timeEntries.length}</span></div><div className="time-entry-list">{[...timeEntries].reverse().map((entry) => <article key={entry.id} className={entry.endedAt ? "" : "active"}><div><strong>{formatDateTime(entry.startedAt)}</strong><span>Start</span></div><b>→</b><div><strong>{entry.endedAt ? formatDateTime(entry.endedAt) : "Running now"}</strong><span>{formatDuration(entrySeconds(entry, clock))}</span></div></article>)}</div></div>}
        {selectedId && currentUser?.role === "member" && task?.visibility === "private" && task.createdBy === currentUser.email && <div className="form-section private-share-section"><h3>Private Task Sharing <span>مشاركة المهمة</span></h3>{task.submittedToManager ? <div className="private-shared-note">تم إرسال المهمة إلى المسؤول، ويمكنه الآن مراجعتها أو تفويضها لموظف آخر.</div> : <><p>تبقى هذه المهمة ظاهرة لك فقط حتى تختار إرسالها للمسؤول.</p><button type="button" className="share-task-button" onClick={submitPrivateTask} disabled={saving}><ButtonLabel en="Send to Manager" ar="إرسال وإشعار المسؤول" /></button></>}</div>}
        {management && <div className="form-section manager-section"><h3>Manager Review <span>مراجعة المسؤول</span></h3><div className="review-choice">{(["new", "pending", "approved", "returned"] as const).map((value) => <button type="button" key={value} className={form.managerCheck === value ? `selected ${value}` : value} onClick={() => updateForm("managerCheck", value)}>{checkLabel[value]}</button>)}</div></div>}
        {selectedId && <div className="form-section comments-section">
          <div className="comments-heading"><h3>Activity Notes <span>سجل الملاحظات</span></h3><span>{comments.length}</span></div>
          {comments.length === 0 ? <div className="comments-empty">لا توجد ملاحظات حتى الآن · No notes yet</div> : <div className="comment-list">{comments.map((comment) => {
            const author = users.find((user) => user.email === comment.authorEmail);
            return <article className="comment-entry" key={comment.id}>
              <div className="avatar comment-avatar">{initials(comment.authorName)}</div>
              <div className="comment-content"><div className="comment-meta"><strong>{comment.authorName}</strong><span className="comment-role">{author?.role === "owner" ? "Owner" : author?.role === "manager" ? "Manager" : author?.discipline || "Team member"}</span><time dir="ltr">{formatDateTime(comment.createdAt)}</time></div><p>{comment.body}</p></div>
            </article>;
          })}</div>}
          <div className="comment-composer"><label className="wide"><span>Add a note · أضف ملاحظة</span><textarea maxLength={2000} rows={3} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="اكتب تحديثًا أو ملاحظة مرتبطة بهذه المهمة..." /></label><div><small>{commentDraft.length}/2000</small><button type="button" className="comment-button" onClick={addComment} disabled={savingComment || !commentDraft.trim()}><ButtonLabel en={savingComment ? "Posting..." : "Post note"} ar={savingComment ? "جاري الإضافة..." : "إضافة الملاحظة"} /></button></div></div>
        </div>}
        <div className="drawer-actions">{selectedId && management && <button type="button" className="delete-button" onClick={deleteTask} disabled={saving}><ButtonLabel en="Delete Task" ar="حذف المهمة" /></button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Close" ar="إغلاق" /></button>{canEditDetails && <button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selectedId ? "Save Changes" : "Create Task"} ar={saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إنشاء مهمة"} /></button>}</div>
      </form>
    </aside>
  </div>;
}

type ProjectDrawerProps = {
  selectedId: number | null;
  form: ProjectForm;
  setForm: (value: ProjectForm) => void;
  setOpen: (value: boolean) => void;
  saveProject: (event: FormEvent) => void;
  deleteProject: () => void;
  saving: boolean;
  users: User[];
  tasks: Task[];
  projectCode: string;
  onResolveMemberTasks: (user: User, projectCode: string) => void;
  currentUser: User | null;
};

function ProjectDrawer({ selectedId, form, setForm, setOpen, saveProject, deleteProject, saving, users, tasks, projectCode, onResolveMemberTasks, currentUser }: ProjectDrawerProps) {
  const [removalWarning, setRemovalWarning] = useState<{ user: User; taskCount: number } | null>(null);
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const owner = currentUser?.role === "owner";
  const manager = currentUser?.role === "manager";
  const canEditTeam = owner || manager;
  const teamMembers = users.filter((user) => (user.role === "member" || user.role === "manager") && (owner || (manager && user.discipline === currentUser?.discipline) || (!canEditTeam && form.memberEmails.includes(user.email))));
  const availableDisciplines = disciplines.filter((discipline) => teamMembers.some((user) => user.discipline === discipline));
  const filteredTeamMembers = disciplineFilter === "all"
    ? teamMembers
    : teamMembers.filter((user) => user.discipline === disciplineFilter);

  const toggleMember = (user: User) => {
    if (!canEditTeam) return;
    const isRemoving = form.memberEmails.includes(user.email);
    if (isRemoving && selectedId) {
      const taskCount = tasks.filter((task) => task.project === projectCode && task.employeeEmail === user.email).length;
      if (taskCount > 0) {
        setRemovalWarning({ user, taskCount });
        return;
      }
    }
    setRemovalWarning(null);
    setForm({
      ...form,
      memberEmails: isRemoving
        ? form.memberEmails.filter((item) => item !== user.email)
        : [...form.memberEmails, user.email],
    });
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات المشروع">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" />
    <aside className="task-drawer compact-drawer">
      <div className="drawer-head"><div><p>PROJECT</p><h2>{selectedId ? "تحديث بيانات المشروع" : "إضافة مشروع جديد"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={saveProject} className="task-form">
        <div className="form-section"><h3>Project Information <span>معلومات المشروع</span></h3><div className="form-grid"><label><span>Code · كود المشروع</span><input required disabled={!owner} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="مثال: DH2" /></label><label><span>Status · الحالة</span><select disabled={!owner} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Project["status"] })}>{Object.entries(projectStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="wide"><span>Project Name · اسم المشروع</span><input required disabled={!owner} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="اسم المشروع الكامل" /></label><label className="wide"><span>Client · العميل</span><input disabled={!owner} value={form.client} onChange={(event) => setForm({ ...form, client: event.target.value })} placeholder="اسم العميل" /></label><div className="form-grid"><label><span>Start Date · تاريخ البداية</span><input type="date" disabled={!owner} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label><span>Target Date · التسليم المستهدف</span><input type="date" disabled={!owner} value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label></div></div>
        <div className="form-section"><div className="comments-heading project-team-heading"><h3>Project Team <span>فريق المشروع</span></h3><div className="project-team-controls"><select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)} aria-label="Filter project team by discipline"><option value="all">All disciplines · كل التخصصات</option>{availableDisciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select><span aria-label={`${form.memberEmails.length} selected project members`}>{form.memberEmails.length}</span></div></div>{teamMembers.length === 0 ? <div className="comments-empty">أضف الموظفين أولاً من بوابة الفريق.</div> : filteredTeamMembers.length === 0 ? <div className="comments-empty">No employees in this discipline · لا يوجد موظفون في هذا التخصص</div> : <div className="member-picker">{filteredTeamMembers.map((user) => <label key={user.email} className={form.memberEmails.includes(user.email) ? "selected" : ""}><input type="checkbox" disabled={!canEditTeam} checked={form.memberEmails.includes(user.email)} onChange={() => toggleMember(user)} /><span className="avatar small">{initials(user.displayName)}</span><span><strong>{user.displayName} <em className="member-role">({roleLabel(user.role)})</em></strong><small>{user.discipline || "Team member"}</small></span></label>)}</div>}
          {removalWarning && <div className="member-removal-warning" role="alert"><strong>Employee cannot be removed yet · لا يمكن إزالة هذا الموظف الآن</strong><p>لدى {removalWarning.user.displayName} عدد {removalWarning.taskCount} من المهام على مشروع {projectCode}. يجب تغيير الموظف المسؤول إلى موظف آخر لديه صلاحية على المشروع قبل الإزالة.</p><small>{removalWarning.user.displayName} has {removalWarning.taskCount} assigned task(s) on this project. Reassign them to another authorized project member first.</small><button type="button" onClick={() => onResolveMemberTasks(removalWarning.user, projectCode)}><ButtonLabel en="Open filtered tasks" ar="الذهاب إلى المهام وتغيير الموظف" /></button><em>إذا لم يوجد بديل، أضف موظفًا آخر إلى المشروع واحفظه أولًا. · If no replacement is available, add another member and save the project first.</em></div>}
        </div>
        <div className="drawer-actions">{owner && selectedId && <button type="button" className="delete-button" onClick={deleteProject} disabled={saving}><ButtonLabel en="Delete Project" ar="حذف المشروع" /></button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Close" ar="إغلاق" /></button>{canEditTeam && <button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selectedId ? "Save Changes" : "Add Project"} ar={saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إضافة المشروع"} /></button>}</div>
      </form>
    </aside>
  </div>;
}

function UserDrawer({ selectedEmail, form, setForm, setOpen, saveUser, deleteUser, saving, currentUser, projects }: { selectedEmail: string | null; form: UserForm; setForm: (value: UserForm) => void; setOpen: (value: boolean) => void; saveUser: (event: FormEvent) => void; deleteUser: () => void; saving: boolean; currentUser: User | null; projects: Project[]; }) {
  const managerLimited = currentUser?.role === "manager";
  const disciplineOptions = managerLimited && currentUser?.discipline ? [currentUser.discipline] : disciplines;
  const assignedProjects = selectedEmail ? projects.filter((project) => project.memberEmails.includes(selectedEmail)) : [];
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات الموظف"><button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" /><aside className="task-drawer compact-drawer"><div className="drawer-head"><div><p>TEAM MEMBER</p><h2>{selectedEmail ? "تحديث بيانات الموظف" : "إضافة حساب موظف"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div><form onSubmit={saveUser} className="task-form"><div className="form-section"><h3>بيانات الموظف <span>Employee Information</span></h3><label className="wide"><span>الاسم · Name</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="اسم الموظف" /></label><label className="wide"><span>التخصص · Discipline</span><select required disabled={managerLimited} value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value as Discipline })}><option value="" disabled>اختر التخصص</option>{disciplineOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="wide"><span>Email · البريد</span><input required type="email" disabled={Boolean(selectedEmail)} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@eng-bim.com" /></label><label className="wide"><span>{selectedEmail ? "كلمة مرور جديدة · New Password" : "كلمة مرور مؤقتة · Temporary Password"}</span><input required={!selectedEmail} minLength={10} type="password" value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} placeholder={selectedEmail ? "اتركها فارغة دون تغيير" : "10 أحرف على الأقل"} autoComplete="new-password" /></label><label className="wide"><span>الصلاحية داخل النظام · Role</span><select disabled={managerLimited} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as User["role"] })}><option value="member">Member · موظف</option>{!managerLimited && <option value="manager">Manager · مسؤول</option>}{currentUser?.role === "owner" && <option value="owner">Owner · المالك</option>}</select></label>{managerLimited && <div className="temporary-note">يمكنك إضافة وإدارة موظفين من تخصصك فقط: {currentUser?.discipline || "غير محدد"}.</div>}{form.role === "owner" && <div className="owner-warning">المالك لديه أعلى صلاحيات النظام، بما فيها إضافة ملاك آخرين واستعادة النسخ الاحتياطية.</div>}<div className="temporary-note">أرسل للمستخدم كلمة المرور المؤقتة بطريقة آمنة. يستطيع تغييرها من حسابه بعد تسجيل الدخول.</div></div>{selectedEmail && <div className="form-section user-projects-section"><div className="comments-heading"><h3>Assigned Projects <span>المشاريع المدرج عليها الموظف</span></h3><span>{assignedProjects.length}</span></div>{assignedProjects.length ? <div className="assigned-project-list">{assignedProjects.map((project) => <div key={project.id}><strong>{project.code}</strong><span>{project.name}</span></div>)}</div> : <div className="comments-empty">No assigned projects · غير مدرج على أي مشروع</div>}</div>}<div className="drawer-actions">{selectedEmail && selectedEmail !== currentUser?.email && <button type="button" className="delete-button" onClick={deleteUser} disabled={saving}><ButtonLabel en="Delete Employee" ar="حذف الموظف" /></button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Cancel" ar="إلغاء" /></button><button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selectedEmail ? "Save Changes" : "Add Employee"} ar={saving ? "جاري الحفظ..." : selectedEmail ? "حفظ التعديلات" : "إضافة المستخدم"} /></button></div></form></aside></div>;
}

function PasswordDrawer({ form, setForm, setOpen, changePassword, saving }: { form: PasswordForm; setForm: (value: PasswordForm) => void; setOpen: (value: boolean) => void; changePassword: (event: FormEvent) => void; saving: boolean; }) {
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Change password">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="Close" />
    <aside className="task-drawer compact-drawer password-drawer" dir="ltr">
      <div className="drawer-head"><div><p>ACCOUNT SECURITY</p><h2>Change password</h2></div><button className="close-button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
      <form onSubmit={changePassword} className="task-form password-form">
        <div className="password-intro"><span>•••</span><div><strong>Keep your account secure</strong><p>Use at least 10 characters. Changing your password signs out your other sessions.</p></div></div>
        <div className="form-section">
          <label className="wide"><span>Current password</span><input required type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} autoComplete="current-password" /></label>
          <label className="wide"><span>New password</span><input required minLength={10} type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} autoComplete="new-password" /></label>
          <label className="wide"><span>Confirm new password</span><input required minLength={10} type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} autoComplete="new-password" /></label>
        </div>
        <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Cancel" ar="إلغاء" /></button><button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Updating…" : "Update password"} ar={saving ? "جاري التحديث…" : "تحديث كلمة المرور"} /></button></div>
      </form>
    </aside>
  </div>;
}
