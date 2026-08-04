/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type Notification = {
  id: number;
  recipientEmail: string;
  type: "task_assigned" | "review_updated" | "private_task_submitted" | "task_ready_for_review";
  taskId: number | null;
  title: string;
  message: string;
  read: boolean;
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
type Tab = "overview" | "tasks" | "rfi" | "issues" | "projects" | "team" | "reports";

type WorkspaceData = {
  currentUser: User;
  tasks: Task[];
  users: User[];
  projects: Project[];
  comments: TaskComment[];
  timeEntries: TaskTimeEntry[];
  notifications: Notification[];
};

const tabValues: Tab[] = ["overview", "tasks", "rfi", "issues", "projects", "team", "reports"];
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
  not_started: "لم تبدأ · Not started",
  in_progress: "قيد التنفيذ · In progress",
  paused: "متوقفة مؤقتًا · Paused",
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
  new: "جديدة/قيد العمل · New/WIP",
  pending: "بانتظار التدقيق · Pending",
  approved: "معتمدة · Approved",
  returned: "مُعادة · Returned",
};

const projectStatusLabel: Record<Project["status"], string> = {
  active: "نشط · Active",
  on_hold: "معلّق · On hold",
  completed: "مكتمل · Completed",
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
  if (task.managerCheck === "returned" || task.status === "needs_revision") return { key: "revision", label: "تعديل · Revision" };
  if (task.status === "blocked") return { key: "blocked", label: "متوقفة · Blocked" };
  if (task.taskDate < localToday() && task.status !== "done") return { key: "late", label: "متأخرة · Late" };
  if (task.plannedHours > 0 && task.actualHours > task.plannedHours * 1.2) return { key: "overtime", label: "تجاوز وقت · Overtime" };
  return { key: "ok", label: "سليمة · OK" };
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
  const syncInFlightRef = useRef(false);
  const [clock, setClock] = useState(0);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [reportGroup, setReportGroup] = useState<"project" | "employee">("project");
  const [reportAnchor, setReportAnchor] = useState(localToday());
  const [reportScope, setReportScope] = useState("all");

  const applyWorkspaceData = useCallback((data: WorkspaceData, initialize = false) => {
    setTasks(data.tasks || []);
    setComments(data.comments || []);
    setTimeEntries(data.timeEntries || []);
    setUsers(data.users || []);
    setProjects(data.projects || []);
    setNotifications(data.notifications || []);
    setCurrentUser(data.currentUser);
    if (data.currentUser.role === "member") {
      setTab((current) => current === "team" ? "overview" : current);
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

  const employees = useMemo(() => Array.from(new Set([...users.map((u) => u.displayName), ...tasks.map((t) => t.employeeName)])).sort(), [users, tasks]);
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

  function openNewProject() {
    if (currentUser?.role !== "owner") return;
    setSelectedProjectId(null);
    setProjectForm(blankProject());
    setProjectDrawerOpen(true);
  }

  function openProject(project: Project) {
    if (currentUser?.role !== "owner") return;
    setSelectedProjectId(project.id);
    setProjectForm({ code: project.code, name: project.name, client: project.client, status: project.status, startDate: project.startDate, targetDate: project.targetDate, memberEmails: project.memberEmails || [] });
    setProjectDrawerOpen(true);
  }

  function openNewUser() {
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

  async function markNotification(notification?: Notification) {
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notification ? { id: notification.id } : { all: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update notification.");
      if (notification?.taskId) {
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
    popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>HINDAZA Project Management Report</title><style>body{font-family:Arial,Tahoma,sans-serif;color:#1d1d1d;padding:30px}.logo{display:block;width:250px;height:auto;margin:0 0 20px auto;background:#171717;border-radius:10px;padding:12px}h1{color:#171717;margin:0;border-right:5px solid #ffd200;padding-right:12px}.meta{color:#737373;margin:8px 0 24px}.summary{display:flex;gap:10px;margin:20px 0}.summary div{border:1px solid #e2e2dc;border-radius:10px;padding:12px 18px}.summary strong{font-size:22px;color:#8b6c00;display:block}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{border:1px solid #e2e2dc;padding:8px;text-align:right;font-size:11px}th{background:#171717;color:white}.chart{margin:24px 0}.bar-row{display:grid;grid-template-columns:160px 1fr 35px;gap:10px;align-items:center;margin:9px 0;font-size:11px}.bar{height:16px;background:#f1f1ed;border-radius:8px;overflow:hidden}.bar i{display:block;height:100%;background:#ffd200}.footer{margin-top:30px;color:#858585;font-size:9px}@media print{body{padding:0}}</style></head><body><img class="logo" src="/hindaza-logo.png" alt="HINDAZA"><h1>HINDAZA Project Management</h1><div class="meta">${reportPeriod === "week" ? "التقرير الأسبوعي" : "التقرير الشهري"} · ${formatDate(range.start)} — ${formatDate(range.end)}</div><div class="summary"><div>إجمالي المهام<strong>${reportSummary.total}</strong></div><div>مكتملة<strong>${reportSummary.done}</strong></div><div>تحتاج متابعة<strong>${reportSummary.attention}</strong></div><div>الساعات الفعلية<strong>${reportSummary.actual.toFixed(1)}</strong></div></div><div class="chart">${bars}</div><table><thead><tr><th>المجموعة</th><th>الإجمالي</th><th>مكتملة</th><th>مفتوحة</th><th>متابعة</th><th>مخطط</th><th>فعلي</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>{window.print();}</script></body></html>`);
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
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="التنقل الرئيسي">
        <div className="brand-block"><img src="/hindaza-logo.png" alt="HINDAZA Engineering BIM" /><span>PROJECT MANAGEMENT</span></div>
        <nav className="nav-list">
          {navItems.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><span className="nav-icon">{item.icon}</span><span>{item.ar}<small>{item.en}</small></span></button>)}
        </nav>
        <div className="sidebar-account" ref={accountMenuRef}>
          {accountMenuOpen && <div className="account-menu">
            <div className="account-menu-title"><strong>{currentUser?.displayName}</strong><span>{currentUser ? roleLabel(currentUser.role) : ""}</span></div>
            <label className={profileImageBusy ? "disabled" : ""}>Change image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={changeProfileImage} disabled={profileImageBusy} /></label>
            {currentUser?.profileImageKey && <button onClick={removeProfileImage} disabled={profileImageBusy}>Remove image</button>}
            <button onClick={() => { setPasswordDrawerOpen(true); setAccountMenuOpen(false); }}>Change password</button>
            {currentUser?.role === "owner" && <>
              <button onClick={downloadBackup} disabled={Boolean(backupBusy)}>{backupBusy === "download" ? "Preparing backup…" : "Download Backup"}</button>
              <label className={backupBusy ? "disabled" : ""}>{backupBusy === "restore" ? "Restoring…" : "Restore Backup"}<input type="file" accept="application/json,.json" onChange={restoreBackup} disabled={Boolean(backupBusy)} /></label>
              <small>Owner only · Profile photos are not included</small>
            </>}
            <button className="account-logout" onClick={logout}>Logout</button>
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
                <div className="notification-popover-head"><div><strong>الإشعارات</strong><span>Notifications</span></div>{unreadNotifications > 0 && <button onClick={() => markNotification()}>تحديد الكل كمقروء</button>}</div>
                {notifications.length === 0 ? <div className="notification-popover-empty">لا توجد إشعارات جديدة</div> : <div className="notification-popover-list">{notifications.map((notification) => <button key={notification.id} className={notification.read ? "" : "unread"} onClick={() => markNotification(notification)}><i>{notification.type === "task_assigned" ? "+" : "✓"}</i><span><strong>{notification.title}</strong><small>{notification.message}</small><time dir="ltr">{formatDateTime(notification.createdAt)}</time></span></button>)}</div>}
              </div>}
            </div>
            {(tab === "overview" || tab === "tasks") && isManagement(currentUser) && <button className="primary-button" onClick={openNewTask}><span>＋</span> مهمة جديدة <small>New Task</small></button>}
            {(tab === "overview" || tab === "tasks") && currentUser?.role === "member" && <button className="primary-button private-task-button" onClick={openNewPrivateTask}><span>＋</span> مهمة خاصة <small>Private Task</small></button>}
            {tab === "projects" && currentUser?.role === "owner" && <button className="primary-button" onClick={openNewProject}><span>＋</span> مشروع جديد <small>New Project</small></button>}
            {tab === "team" && isManagement(currentUser) && <button className="primary-button" onClick={openNewUser}><span>＋</span> إضافة موظف <small>Add Employee</small></button>}
          </div>
        </header>

        {error && <div className="error-banner"><span>{error}</span><div className="error-actions"><button className="retry-load-button" onClick={() => void loadWorkspace(!currentUser, true)}>إعادة المحاولة · Retry</button><button className="dismiss-error-button" onClick={() => setError("")} aria-label="إغلاق">×</button></div></div>}

        {(tab === "overview" || tab === "tasks") && <>
          <section className="stats-grid" aria-label="ملخص المهام">
            <article className="stat-card navy"><span>إجمالي المهام · Total</span><strong>{stats.total}</strong><small>جميع المهام الظاهرة لك</small></article>
            <article className="stat-card violet"><span>جديدة/قيد العمل · New/WIP</span><strong>{stats.new}</strong><small>جديدة أو قيد التنفيذ</small></article>
            <article className="stat-card blue"><span>بانتظار المراجعة · Pending</span><strong>{stats.pending}</strong><small>قيد مراجعة المسؤول</small></article>
            <article className="stat-card green"><span>معتمدة · Approved</span><strong>{stats.approved}</strong><small>تم اعتمادها من المسؤول</small></article>
            <article className="stat-card amber"><span>مُعادة · Returned</span><strong>{stats.returned}</strong><small>تحتاج إجراء من الموظف</small></article>
          </section>
          <TaskTable loading={loading} tasks={visibleRows} filteredCount={filteredTasks.length} tab={tab} employees={employees} projects={projectCodes} search={search} employeeFilter={employeeFilter} projectFilter={projectFilter} statusFilter={statusFilter} reviewFilter={reviewFilter} showEmployeeFilter={currentUser?.role !== "member"} setSearch={setSearch} setEmployeeFilter={setEmployeeFilter} setProjectFilter={setProjectFilter} setStatusFilter={setStatusFilter} setReviewFilter={setReviewFilter} openTask={openTask} showAll={() => setTab("tasks")} timeEntries={timeEntries} clock={clock} />
        </>}

        {(tab === "rfi" || tab === "issues") && <section className="panel module-placeholder">
          <div className="module-icon">{tab === "rfi" ? "RFI" : "!"}</div>
          <p>{tab === "rfi" ? "REQUEST FOR INFORMATION" : "PROJECT ISSUES"}</p>
          <h2>{tab === "rfi" ? "بوابة طلبات المعلومات" : "سجل مشاكل المشاريع"}</h2>
          <span>تمت إضافة الوحدة إلى النظام، وسيتم استكمال الحقول ومسار العمل في المرحلة التالية.</span>
          <div className="module-status">جاهزة لإضافة التفاصيل · Ready for configuration</div>
        </section>}

        {tab === "projects" && <section className="panel projects-panel">
          <div className="panel-heading"><div><h2>سجل المشاريع</h2><p>المشاريع النشطة والمواعيد ونسبة إنجاز المهام</p></div><span className="count-badge">{projectRows.length} مشروع</span></div>
          {projectRows.length === 0 ? <div className="empty-state"><strong>لا توجد مشاريع بعد</strong><p>أضف أول مشروع لبدء تنظيم مهام الفريق.</p></div> : <div className="project-grid">{projectRows.map((project) => <button className="project-card" key={project.id} onClick={() => openProject(project)} disabled={currentUser?.role !== "owner"}>
            <div className="project-card-top"><span className="project-code large">{project.code}</span><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status]}</span></div>
            <h3>{project.name}</h3><p>{project.client || "بدون اسم عميل"}</p>
            <div className="project-progress-head"><span>إنجاز المهام</span><strong>{project.progress}%</strong></div><div className="progress project-progress"><i style={{ width: `${project.progress}%` }} /></div>
            <div className="project-metrics"><div><span>المهام</span><strong>{project.total}</strong></div><div><span>مكتملة</span><strong>{project.done}</strong></div><div><span>مخطط</span><strong>{project.planned.toFixed(1)}h</strong></div><div><span>فعلي</span><strong>{project.actual.toFixed(1)}h</strong></div></div>
            <div className="project-dates"><span>البداية: {formatDate(project.startDate)}</span><span>المستهدف: {formatDate(project.targetDate)}</span></div>
            <div className="project-team-count">{project.memberEmails.length} أعضاء في المشروع · Project members</div>
          </button>)}</div>}
        </section>}

        {tab === "team" && <section className="panel team-panel">
          <div className="panel-heading"><div><h2>ملخص الفريق</h2><p>إدارة حسابات الموظفين وتخصصاتهم وصلاحياتهم داخل النظام</p></div><span className="count-badge">{teamRows.length} موظف</span></div>
          <div className="team-grid">{teamRows.map((row) => <button className="team-card" key={row.email} onClick={() => openUser(row)}>
            <div className="team-card-head"><div className="avatar soft">{initials(row.displayName)}</div><div><strong>{row.displayName}</strong><span>{roleLabel(row.role)}</span></div>{row.temporary && <em className="temporary-badge">مؤقت</em>}</div>
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

      {taskDrawerOpen && <TaskDrawer selectedId={selectedTaskId} form={taskForm} setOpen={setTaskDrawerOpen} saveTask={saveTask} deleteTask={deleteTask} saving={saving} currentUser={currentUser} users={users} projects={projects} updateForm={updateTaskForm} comments={comments.filter((comment) => comment.taskId === selectedTaskId)} commentDraft={commentDraft} setCommentDraft={setCommentDraft} addComment={addComment} savingComment={savingComment} task={tasks.find((task) => task.id === selectedTaskId) || null} timeEntries={timeEntries.filter((entry) => entry.taskId === selectedTaskId)} clock={clock} updateTimer={updateTimer} savingTimer={savingTimer} submitPrivateTask={submitPrivateTask} />}
      {projectDrawerOpen && <ProjectDrawer selectedId={selectedProjectId} form={projectForm} setForm={setProjectForm} setOpen={setProjectDrawerOpen} saveProject={saveProject} saving={saving} users={users.filter((user) => user.role === "member")} />}
      {userDrawerOpen && <UserDrawer selectedEmail={selectedUserEmail} form={userForm} setForm={setUserForm} setOpen={setUserDrawerOpen} saveUser={saveUser} deleteUser={deleteUser} saving={saving} currentUser={currentUser} />}
      {passwordDrawerOpen && <PasswordDrawer form={passwordForm} setForm={setPasswordForm} setOpen={setPasswordDrawerOpen} changePassword={changePassword} saving={saving} />}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

type TaskTableProps = {
  loading: boolean; tasks: Task[]; filteredCount: number; tab: Tab; employees: string[]; projects: string[];
  search: string; employeeFilter: string; projectFilter: string; statusFilter: string; reviewFilter: string; showEmployeeFilter: boolean;
  setSearch: (value: string) => void; setEmployeeFilter: (value: string) => void; setProjectFilter: (value: string) => void; setStatusFilter: (value: string) => void; setReviewFilter: (value: string) => void;
  openTask: (task: Task) => void; showAll: () => void;
  timeEntries: TaskTimeEntry[]; clock: number;
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
  return <section className="panel"><div className="panel-heading"><div><h2>{props.tab === "overview" ? "مهام اليوم والمتابعة" : "جميع المهام"}</h2><p>اضغط على أي مهمة لعرض التفاصيل أو تحديثها</p></div><span className="count-badge" dir="ltr">{props.filteredCount} {props.filteredCount === 1 ? "Task" : "Tasks"}</span></div>
    <div className="filters"><label className="search-box"><span>⌕</span><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="ابحث عن مهمة أو مشروع..." /></label>{props.showEmployeeFilter && <select value={props.employeeFilter} onChange={(event) => props.setEmployeeFilter(event.target.value)} aria-label="فلترة حسب الموظف"><option value="all">كل الموظفين</option>{props.employees.map((employee) => <option key={employee}>{employee}</option>)}</select>}<select value={props.projectFilter} onChange={(event) => props.setProjectFilter(event.target.value)} aria-label="فلترة حسب المشروع"><option value="all">كل المشاريع</option>{props.projects.map((project) => <option key={project}>{project}</option>)}</select><select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value)} aria-label="فلترة حسب الحالة"><option value="all">كل حالات الموظف</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={props.reviewFilter} onChange={(event) => props.setReviewFilter(event.target.value)} aria-label="فلترة حسب مراجعة المسؤول"><option value="all">كل مراجعات المسؤول</option>{Object.entries(checkLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="clear-filters-button" onClick={clearFilters} disabled={!filtersActive} aria-label="Clear all task filters"><span>×</span> Clear filters</button></div>
    {props.loading ? <div className="loading-state"><div className="spinner" /><p>جاري تحميل المهام...</p></div> : props.tasks.length === 0 ? <div className="empty-state"><strong>لا توجد مهام مطابقة</strong><p>غيّر خيارات البحث أو أضف مهمة جديدة.</p></div> : <><div className="task-table-wrap"><table className={`task-table task-data-table${props.showEmployeeFilter ? "" : " member-task-table"}`}><thead><tr><th>المهمة والمشروع</th>{props.showEmployeeFilter && <th>الموظف</th>}<th>تاريخ الإنشاء<br /><small>Created Date</small></th><th>تاريخ الإنجاز المتوقع<br /><small>Due Date</small></th><th>الأولوية</th><th>الساعات</th><th>الحالة</th><th>تدقيق المسؤول</th><th>المؤشر</th></tr></thead><tbody>{props.tasks.map((task) => { const flag = taskFlag(task); const entries = props.timeEntries.filter((entry) => entry.taskId === task.id); const logged = taskLoggedHours(task, entries, props.clock); const active = entries.some((entry) => !entry.endedAt); return <tr key={task.id} onClick={() => props.openTask(task)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && props.openTask(task)}><td><div className="task-cell"><strong>{task.title}</strong><div className="task-tags"><span className="project-code">{task.project}</span>{task.visibility === "private" && <span className="private-badge">خاص · Private</span>}</div><small>{task.expectedOutput}</small></div></td>{props.showEmployeeFilter && <td><div className="employee-cell"><span className="avatar small">{initials(task.employeeName)}</span><strong>{task.employeeName}</strong></div></td>}<td><span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span></td><td><span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></td><td><span className={`pill priority-${task.priority}`}>{priorityLabel[task.priority]}</span></td><td><strong className={active ? "live-hours" : ""}>{logged ? logged.toFixed(2) : "—"}{active && <i />}</strong><small className="hours-note"> / {task.plannedHours || "—"}h</small></td><td><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span></td><td><span className={`pill check-${task.managerCheck}`}>{checkLabel[task.managerCheck]}</span></td><td><span className={`flag flag-${flag.key}`}>{flag.label}</span></td></tr>; })}</tbody></table></div>
      <div className="mobile-task-list">{props.tasks.map((task) => { const flag = taskFlag(task); const entries = props.timeEntries.filter((entry) => entry.taskId === task.id); const logged = taskLoggedHours(task, entries, props.clock); return <button className="mobile-task" key={task.id} onClick={() => props.openTask(task)}><div className="mobile-task-top"><div className="task-tags"><span className="project-code">{task.project}</span>{task.visibility === "private" && <span className="private-badge">خاص · Private</span>}</div><span className={`flag flag-${flag.key}`}>{flag.label}</span></div><strong>{task.title}</strong><small>{props.showEmployeeFilter ? `${task.employeeName} · ` : ""}<span className="mobile-date-label">Created</span> <span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span> · <span className="mobile-date-label">Due</span> <span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></small><div className="mobile-task-bottom"><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span><span>{logged.toFixed(2)}/{task.plannedHours}h</span></div></button>; })}</div>
      {props.tab === "overview" && props.filteredCount > 7 && <button className="text-button" onClick={props.showAll}>عرض جميع المهام ←</button>}</>}
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
    : users.filter((user) => user.role === "member" && selectedProject?.memberEmails.includes(user.email));
  const assignmentOptions = form.employeeEmail && !projectUsers.some((user) => user.email === form.employeeEmail)
    ? [...projectUsers, ...users.filter((user) => user.email === form.employeeEmail)]
    : projectUsers;
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="تفاصيل المهمة">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" />
    <aside className="task-drawer">
      <div className="drawer-head"><div><p>{selectedId ? `TASK #${selectedId}` : form.visibility === "private" ? "NEW PRIVATE TASK" : "NEW TASK"}</p><h2>{selectedId ? "تفاصيل وتحديث المهمة" : form.visibility === "private" ? "إضافة مهمة خاصة" : "إضافة مهمة جديدة"}</h2>{form.visibility === "private" && <span className="drawer-private-label">خاص · Private</span>}</div><button className="close-button" onClick={() => setOpen(false)} aria-label="إغلاق">×</button></div>
      <form onSubmit={saveTask} className="task-form">
        <div className="form-section"><h3>معلومات المهمة <span>Task Information</span></h3><label className="wide"><span>اسم المهمة · Task</span><input required disabled={!canEditDetails} value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="مثال: تدقيق موديل المنطقة 02" /></label><label className="wide"><span>المخرج المتوقع · Expected Output</span><textarea disabled={!canEditDetails} value={form.expectedOutput} onChange={(event) => updateForm("expectedOutput", event.target.value)} rows={3} placeholder="ما المطلوب تسليمه عند اكتمال المهمة؟" /></label><div className="form-grid"><label><span>المشروع · Project</span><select required disabled={!canEditDetails} value={form.project} onChange={(event) => { const code = event.target.value; updateForm("project", code); const project = projects.find((item) => item.code === code); if (management && !project?.memberEmails.includes(form.employeeEmail)) { updateForm("employeeEmail", ""); updateForm("employeeName", ""); } }}><option value="">اختر المشروع</option>{projectOptions.map((project) => <option key={project}>{project}</option>)}</select></label><label><span>تاريخ الإنشاء · Created Date</span><input className="due-date" dir="ltr" disabled value={selectedId ? formatCreatedDate(task?.createdAt || "") : "Automatic on save"} /></label><label><span>تاريخ الإنجاز المتوقع · Due Date</span><input type="date" lang="en-GB" disabled={!canEditDetails} value={form.taskDate} onChange={(event) => updateForm("taskDate", event.target.value)} /></label><label><span>الأولوية · Priority</span><select disabled={!canEditDetails} value={form.priority} onChange={(event) => updateForm("priority", event.target.value as Task["priority"])}>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>الحالة · Status</span><select disabled value={form.status}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div></div>
        <div className="form-section"><h3>الموظف والوقت <span>Assignment & Time</span></h3><div className="form-grid"><label><span>الموظف · Employee</span><select disabled={!management} required value={form.employeeEmail} onChange={(event) => { const user = users.find((item) => item.email === event.target.value); updateForm("employeeEmail", event.target.value); if (user) updateForm("employeeName", user.displayName); }}><option value="">{form.project ? "اختر موظفًا من فريق المشروع" : "اختر المشروع أولاً"}</option>{assignmentOptions.map((user) => <option key={user.email} value={user.email}>{user.displayName}{user.discipline ? ` · ${user.discipline}` : ""}</option>)}</select></label><label><span>البريد · Email</span><input disabled value={form.employeeEmail} placeholder="يُعبأ تلقائيًا" /></label><label><span>ساعات مخططة · Planned</span><input type="number" disabled={!canEditDetails} min="0" step="0.25" value={form.plannedHours} onChange={(event) => updateForm("plannedHours", Number(event.target.value))} /></label><label><span>الساعات المسجلة · Logged</span><input disabled value={formatDuration(loggedSeconds)} /></label></div></div>
        {selectedId && currentUser?.role === "member" && task?.employeeEmail === currentUser.email && <div className="form-section timer-section"><div className="timer-head"><div><h3>تسجيل وقت العمل <span>Work Timer</span></h3><p>يمكنك إيقاف المهمة للبريك أو عند الانتقال لمهمة أخرى، ثم استئنافها في أي يوم لاحق.</p></div><strong className={activeEntry ? "running" : ""} dir="ltr">{formatDuration(loggedSeconds)}</strong></div><div className="timer-actions">{activeEntry ? <button type="button" className="pause-task-button" onClick={() => updateTimer("pause")} disabled={savingTimer}>Ⅱ إيقاف مؤقت · Pause</button> : <button type="button" className="start-task-button" onClick={() => updateTimer("start")} disabled={savingTimer || task.managerCheck === "approved"}>▶ ابدأ/استأنف · Start</button>}{task.status !== "done" && <button type="button" className="finish-task-button" onClick={() => updateTimer("finish")} disabled={savingTimer}>✓ إنهاء وإرسال للمراجعة</button>}</div>{task.managerCheck === "approved" && <div className="timer-lock-note">المهمة معتمدة. يجب على المسؤول إعادة فتح المراجعة قبل استئناف العمل.</div>}</div>}
        {selectedId && timeEntries.length > 0 && <div className="form-section time-history"><div className="comments-heading"><h3>سجل جلسات العمل <span>Work Sessions</span></h3><span>{timeEntries.length}</span></div><div className="time-entry-list">{[...timeEntries].reverse().map((entry) => <article key={entry.id} className={entry.endedAt ? "" : "active"}><div><strong>{formatDateTime(entry.startedAt)}</strong><span>Start</span></div><b>→</b><div><strong>{entry.endedAt ? formatDateTime(entry.endedAt) : "Running now"}</strong><span>{formatDuration(entrySeconds(entry, clock))}</span></div></article>)}</div></div>}
        {selectedId && currentUser?.role === "member" && task?.visibility === "private" && task.createdBy === currentUser.email && <div className="form-section private-share-section"><h3>مشاركة المهمة <span>Private Task Sharing</span></h3>{task.submittedToManager ? <div className="private-shared-note">تم إرسال المهمة إلى المسؤول، ويمكنه الآن مراجعتها أو تفويضها لموظف آخر.</div> : <><p>تبقى هذه المهمة ظاهرة لك فقط حتى تختار إرسالها للمسؤول.</p><button type="button" className="share-task-button" onClick={submitPrivateTask} disabled={saving}>إرسال وإشعار المسؤول · Send to Manager</button></>}</div>}
        {management && <div className="form-section manager-section"><h3>مراجعة المسؤول <span>Manager Review</span></h3><div className="review-choice">{(["new", "pending", "approved", "returned"] as const).map((value) => <button type="button" key={value} className={form.managerCheck === value ? `selected ${value}` : value} onClick={() => updateForm("managerCheck", value)}>{checkLabel[value]}</button>)}</div></div>}
        {selectedId && <div className="form-section comments-section">
          <div className="comments-heading"><h3>سجل الملاحظات <span>Activity Notes</span></h3><span>{comments.length}</span></div>
          {comments.length === 0 ? <div className="comments-empty">لا توجد ملاحظات حتى الآن · No notes yet</div> : <div className="comment-list">{comments.map((comment) => {
            const author = users.find((user) => user.email === comment.authorEmail);
            return <article className="comment-entry" key={comment.id}>
              <div className="avatar comment-avatar">{initials(comment.authorName)}</div>
              <div className="comment-content"><div className="comment-meta"><strong>{comment.authorName}</strong><span className="comment-role">{author?.role === "owner" ? "Owner" : author?.role === "manager" ? "Manager" : author?.discipline || "Team member"}</span><time dir="ltr">{formatDateTime(comment.createdAt)}</time></div><p>{comment.body}</p></div>
            </article>;
          })}</div>}
          <div className="comment-composer"><label className="wide"><span>أضف ملاحظة · Add a note</span><textarea maxLength={2000} rows={3} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="اكتب تحديثًا أو ملاحظة مرتبطة بهذه المهمة..." /></label><div><small>{commentDraft.length}/2000</small><button type="button" className="comment-button" onClick={addComment} disabled={savingComment || !commentDraft.trim()}>{savingComment ? "جاري الإضافة..." : "إضافة الملاحظة · Post note"}</button></div></div>
        </div>}
        <div className="drawer-actions">{selectedId && management && <button type="button" className="delete-button" onClick={deleteTask} disabled={saving}>حذف</button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}>إغلاق</button>{canEditDetails && <button type="submit" className="primary-button" disabled={saving}>{saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إضافة المهمة"}</button>}</div>
      </form>
    </aside>
  </div>;
}

function ProjectDrawer({ selectedId, form, setForm, setOpen, saveProject, saving, users }: { selectedId: number | null; form: ProjectForm; setForm: (value: ProjectForm) => void; setOpen: (value: boolean) => void; saveProject: (event: FormEvent) => void; saving: boolean; users: User[]; }) {
  const toggleMember = (email: string) => setForm({ ...form, memberEmails: form.memberEmails.includes(email) ? form.memberEmails.filter((item) => item !== email) : [...form.memberEmails, email] });
  const teamMembers = users.filter((user) => user.role === "member");
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات المشروع"><button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" /><aside className="task-drawer compact-drawer"><div className="drawer-head"><div><p>PROJECT</p><h2>{selectedId ? "تحديث بيانات المشروع" : "إضافة مشروع جديد"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div><form onSubmit={saveProject} className="task-form"><div className="form-section"><h3>معلومات المشروع <span>Project Information</span></h3><div className="form-grid"><label><span>كود المشروع · Code</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="مثال: DH2" /></label><label><span>الحالة · Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Project["status"] })}>{Object.entries(projectStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="wide"><span>اسم المشروع · Project Name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="اسم المشروع الكامل" /></label><label className="wide"><span>العميل · Client</span><input value={form.client} onChange={(event) => setForm({ ...form, client: event.target.value })} placeholder="اسم العميل" /></label><div className="form-grid"><label><span>تاريخ البداية · Start</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label><span>التسليم المستهدف · Target</span><input type="date" value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label></div></div><div className="form-section"><div className="comments-heading"><h3>فريق المشروع <span>Project Team</span></h3><span>{form.memberEmails.length}</span></div>{teamMembers.length === 0 ? <div className="comments-empty">أضف الموظفين أولاً من بوابة الفريق.</div> : <div className="member-picker">{teamMembers.map((user) => <label key={user.email} className={form.memberEmails.includes(user.email) ? "selected" : ""}><input type="checkbox" checked={form.memberEmails.includes(user.email)} onChange={() => toggleMember(user.email)} /><span className="avatar small">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>{user.discipline || "Team member"}</small></span></label>)}</div>}</div><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إضافة المشروع"}</button></div></form></aside></div>;
}

function UserDrawer({ selectedEmail, form, setForm, setOpen, saveUser, deleteUser, saving, currentUser }: { selectedEmail: string | null; form: UserForm; setForm: (value: UserForm) => void; setOpen: (value: boolean) => void; saveUser: (event: FormEvent) => void; deleteUser: () => void; saving: boolean; currentUser: User | null; }) {
  const managerLimited = currentUser?.role === "manager";
  const disciplineOptions = managerLimited && currentUser?.discipline ? [currentUser.discipline] : disciplines;
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات الموظف"><button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" /><aside className="task-drawer compact-drawer"><div className="drawer-head"><div><p>TEAM MEMBER</p><h2>{selectedEmail ? "تحديث بيانات الموظف" : "إضافة حساب موظف"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div><form onSubmit={saveUser} className="task-form"><div className="form-section"><h3>بيانات الموظف <span>Employee Information</span></h3><label className="wide"><span>الاسم · Name</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="اسم الموظف" /></label><label className="wide"><span>التخصص · Discipline</span><select required disabled={managerLimited} value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value as Discipline })}><option value="" disabled>اختر التخصص</option>{disciplineOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="wide"><span>البريد · Email</span><input required type="email" disabled={Boolean(selectedEmail)} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@eng-bim.com" /></label><label className="wide"><span>{selectedEmail ? "كلمة مرور جديدة · New Password" : "كلمة مرور مؤقتة · Temporary Password"}</span><input required={!selectedEmail} minLength={10} type="password" value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} placeholder={selectedEmail ? "اتركها فارغة دون تغيير" : "10 أحرف على الأقل"} autoComplete="new-password" /></label><label className="wide"><span>الصلاحية داخل النظام · Role</span><select disabled={managerLimited} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as User["role"] })}><option value="member">Member · موظف</option>{!managerLimited && <option value="manager">Manager · مسؤول</option>}{currentUser?.role === "owner" && <option value="owner">Owner · المالك</option>}</select></label>{managerLimited && <div className="temporary-note">يمكنك إضافة وإدارة موظفين من تخصصك فقط: {currentUser?.discipline || "غير محدد"}.</div>}{form.role === "owner" && <div className="owner-warning">المالك لديه أعلى صلاحيات النظام، بما فيها إضافة ملاك آخرين واستعادة النسخ الاحتياطية.</div>}<div className="temporary-note">أرسل للمستخدم كلمة المرور المؤقتة بطريقة آمنة. يستطيع تغييرها من حسابه بعد تسجيل الدخول.</div></div><div className="drawer-actions">{selectedEmail && selectedEmail !== currentUser?.email && <button type="button" className="delete-button" onClick={deleteUser} disabled={saving}>حذف</button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "جاري الحفظ..." : selectedEmail ? "حفظ التعديلات" : "إضافة المستخدم"}</button></div></form></aside></div>;
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
        <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Updating…" : "Update password"}</button></div>
      </form>
    </aside>
  </div>;
}
