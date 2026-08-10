/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IssueReportPanel, IssuesModule, type IssuesModuleHandle } from "./issues-module";
import { useAppConfirm } from "./confirm-dialog";

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
  status: "active" | "on_hold" | "completed" | "archived";
  startDate: string;
  targetDate: string;
  createdAt: string;
  memberEmails: string[];
  projectManagerEmails: string[];
};

type Task = {
  id: number;
  taskDate: string;
  employeeName: string;
  employeeEmail: string;
  employeeDiscipline: Discipline | "";
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
  createdByName: string;
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

type TaskSubtask = {
  id: number;
  taskId: number;
  title: string;
  completed: boolean;
  completedAt: string | null;
  completedBy: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type TaskAttachment = {
  id: number;
  taskId: number;
  subtaskId: number | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

type DraftSubtask = { id: string; title: string };
type DraftTaskAttachment = { id: string; file: File };
type AttachmentUploadProgress = { fileName: string; subtaskId: number | null; percent: number };

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
  type: "task_assigned" | "review_updated" | "private_task_submitted" | "task_ready_for_review" | "subtask_completed" | "task_note_added" | "issue_created" | "issue_updated" | "issue_note_added";
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

type TaskForm = Omit<Task, "id" | "createdBy" | "createdByName" | "employeeDiscipline" | "createdAt" | "updatedAt" | "managerNote" | "submittedToManager">;
type ProjectForm = Omit<Project, "id" | "createdAt">;
type UserForm = Pick<User, "email" | "displayName" | "role" | "discipline"> & { temporaryPassword: string };
type Tab = "overview" | "tasks" | "rfi" | "issues" | "projects" | "team" | "reports" | "activity";
type DirectoryView = "cards" | "table";
type ProjectWorkspaceTab = "tasks" | "issues" | "rfi";

type OverviewIssue = {
  id: number;
  issueNumber: string;
  projectCode: string;
  status: "open" | "re_open" | "closed";
  discipline: string;
  description: string;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  raisedByName: string;
  issueDate: string;
  updatedAt: string;
};

type ProjectOverviewRow = Project & {
  total: number;
  done: number;
  progress: number;
  planned: number;
  actual: number;
  openIssues: number;
};

type WorkspaceData = {
  currentUser: User;
  tasks: Task[];
  users: User[];
  projects: Project[];
  comments: TaskComment[];
  timeEntries: TaskTimeEntry[];
  subtasks: TaskSubtask[];
  taskAttachments: TaskAttachment[];
  notifications: Notification[];
};

const tabValues: Tab[] = ["overview", "tasks", "rfi", "issues", "projects", "team", "reports", "activity"];
const activeTabStorageKey = "hindaza-project-management-active-tab";

function savedTab(): Tab {
  if (typeof window === "undefined") return "overview";
  const value = window.localStorage.getItem(activeTabStorageKey);
  return tabValues.includes(value as Tab) ? value as Tab : "overview";
}

function tabFromLocation(): Tab {
  if (typeof window === "undefined") return "overview";
  const value = new URL(window.location.href).searchParams.get("view");
  return tabValues.includes(value as Tab) ? value as Tab : savedTab();
}

async function fetchWorkspaceData(timeoutMs = 25_000): Promise<WorkspaceData | null> {
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
  archived: "Archived · مؤرشف",
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
  projectManagerEmails: [],
});

const blankUser = (): UserForm => ({ email: "", displayName: "", role: "member", discipline: "", temporaryPassword: "" });

function taskFlag(task: Task) {
  if (task.managerCheck === "returned" || task.status === "needs_revision") return { key: "revision", label: "Revision · تعديل" };
  if (task.status === "blocked") return { key: "blocked", label: "Blocked · متوقفة" };
  if (task.taskDate < localToday() && task.status !== "done") return { key: "late", label: "Late · متأخرة" };
  if (task.plannedHours > 0 && task.actualHours > task.plannedHours * 1.2) return { key: "overtime", label: "Overdue · متجاوزة الوقت" };
  return { key: "ok", label: "OK · سليمة" };
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function UserAvatar({ user, name, className = "small" }: { user?: User; name: string; className?: string }) {
  const hasImage = Boolean(user?.profileImageKey);
  return <span className={`avatar ${className}${hasImage ? " has-image" : ""}`}>{hasImage ? <img src={`/api/profile-image?email=${encodeURIComponent(user!.email)}&v=${encodeURIComponent(user!.profileImageKey)}`} alt={name} /> : initials(name)}</span>;
}

function isManagement(user: User | null) {
  return user?.role === "owner" || user?.role === "manager";
}

function roleLabel(role: User["role"]) {
  if (role === "owner") return "Owner · المالك";
  if (role === "manager") return "Manager · مسؤول";
  return "Team member · موظف";
}

function ButtonLabel({ en }: { en: string; ar: string }) {
  return <span className="button-label"><strong>{en}</strong></span>;
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

function canEditComment(comment: TaskComment, user: User | null, now = Date.now()) {
  if (!user || comment.authorEmail.toLowerCase() !== user.email.toLowerCase()) return false;
  const normalized = comment.createdAt.includes("T") ? comment.createdAt : `${comment.createdAt.replace(" ", "T")}Z`;
  const elapsed = now - new Date(normalized).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 15 * 60 * 1000;
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
  const { confirm, confirmDialog } = useAppConfirm();
  const [tab, setTab] = useState<Tab>("overview");
  const [tabReady, setTabReady] = useState(false);
  const [selectedProjectCode, setSelectedProjectCode] = useState("");
  const [projectWorkspaceTab, setProjectWorkspaceTab] = useState<ProjectWorkspaceTab>("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [timeEntries, setTimeEntries] = useState<TaskTimeEntry[]>([]);
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>([]);
  const [taskAttachments, setTaskAttachments] = useState<TaskAttachment[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [overviewIssues, setOverviewIssues] = useState<OverviewIssue[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [projectDrawerReturnToTask, setProjectDrawerReturnToTask] = useState(false);
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [userDrawerReturnToProject, setUserDrawerReturnToProject] = useState(false);
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
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([]);
  const [draftTaskAttachments, setDraftTaskAttachments] = useState<DraftTaskAttachment[]>([]);
  const [subtaskBusy, setSubtaskBusy] = useState(false);
  const [taskAttachmentBusy, setTaskAttachmentBusy] = useState(false);
  const [taskAttachmentProgress, setTaskAttachmentProgress] = useState<AttachmentUploadProgress | null>(null);
  const [savingTimer, setSavingTimer] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"download" | "restore" | null>(null);
  const [profileImageBusy, setProfileImageBusy] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const projectSwitcherRef = useRef<HTMLDivElement>(null);
  const issuesModuleRef = useRef<IssuesModuleHandle>(null);
  const syncInFlightRef = useRef(false);
  const issueSyncInFlightRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const [clock, setClock] = useState(0);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [dueDateFilter, setDueDateFilter] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamDisciplineFilter, setTeamDisciplineFilter] = useState("all");
  const [teamRoleFilter, setTeamRoleFilter] = useState("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("active");
  const [teamView, setTeamView] = useState<DirectoryView>("table");
  const [projectView, setProjectView] = useState<DirectoryView>("table");
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
    setSubtasks(data.subtasks || []);
    setTaskAttachments(data.taskAttachments || []);
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

  const loadOverviewIssues = useCallback(async () => {
    if (issueSyncInFlightRef.current) return;
    issueSyncInFlightRef.current = true;
    try {
      const response = await fetch("/api/issues", { cache: "no-store" });
      if (response.status === 401) return;
      const data = await response.json();
      if (response.ok) setOverviewIssues(data.issues || []);
    } catch {
      // The rest of the dashboard stays useful when issue metrics are briefly unavailable.
    } finally {
      issueSyncInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadWorkspace(true, true), 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspace]);

  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      await loadWorkspace();
    };
    const interval = window.setInterval(refresh, 30_000);
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
    if (!currentUser || tab === "issues") return;
    const timeout = window.setTimeout(() => void loadOverviewIssues(), 250);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOverviewIssues();
    }, 45_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [currentUser, tab, loadOverviewIssues]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const initialTab = tabFromLocation();
      setTab(initialTab);
      const url = new URL(window.location.href);
      const initialProject = url.searchParams.get("project") || "";
      const initialSection = url.searchParams.get("section");
      setSelectedProjectCode(initialProject);
      if (initialSection === "tasks" || initialSection === "issues" || initialSection === "rfi") setProjectWorkspaceTab(initialSection);
      url.searchParams.set("view", initialTab);
      window.history.replaceState({ ...window.history.state, hindazaTab: initialTab }, "", url);
      setTabReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!tabReady) return;
    window.localStorage.setItem(activeTabStorageKey, tab);
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      return;
    }
    const url = new URL(window.location.href);
    const nextProject = tab === "projects" ? selectedProjectCode : "";
    const nextSection = tab === "projects" && selectedProjectCode ? projectWorkspaceTab : "";
    if (url.searchParams.get("view") === tab && (url.searchParams.get("project") || "") === nextProject && (url.searchParams.get("section") || "") === nextSection) return;
    url.searchParams.set("view", tab);
    if (nextProject) url.searchParams.set("project", nextProject); else url.searchParams.delete("project");
    if (nextSection) url.searchParams.set("section", nextSection); else url.searchParams.delete("section");
    window.history.pushState({ ...window.history.state, hindazaTab: tab, hindazaProject: nextProject, hindazaSection: nextSection }, "", url);
  }, [tab, selectedProjectCode, projectWorkspaceTab, tabReady]);

  useEffect(() => {
    const onPopState = () => {
      const url = new URL(window.location.href);
      const value = url.searchParams.get("view");
      const previousTab = tabValues.includes(value as Tab) ? value as Tab : "overview";
      applyingHistoryRef.current = true;
      setTab(previousTab);
      setSelectedProjectCode(url.searchParams.get("project") || "");
      const section = url.searchParams.get("section");
      if (section === "tasks" || section === "issues" || section === "rfi") setProjectWorkspaceTab(section);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!tabReady || projects.length === 0 || (tab !== "tasks" && tab !== "issues" && tab !== "rfi")) return;
    const preferred = projects.find((project) => project.code === projectFilter) || projects.find((project) => project.status === "active") || projects[0];
    openProjectWorkspace(preferred.code, tab);
  }, [tabReady, projects, tab, projectFilter]);

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
        if (userDrawerOpen) {
          setUserDrawerOpen(false);
          setUserDrawerReturnToProject(false);
          return;
        }
        if (projectDrawerOpen) {
          setProjectDrawerOpen(false);
          setProjectDrawerReturnToTask(false);
          return;
        }
        setTaskDrawerOpen(false);
        setUserDrawerOpen(false);
        setPasswordDrawerOpen(false);
        setUserRemovalWarning(null);
        setProjectRemovalWarning(null);
        setAccountMenuOpen(false);
        setNotificationMenuOpen(false);
        setProjectSwitcherOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projectDrawerOpen, userDrawerOpen]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (accountMenuOpen && !accountMenuRef.current?.contains(target)) setAccountMenuOpen(false);
      if (notificationMenuOpen && !notificationMenuRef.current?.contains(target)) setNotificationMenuOpen(false);
      if (projectSwitcherOpen && !projectSwitcherRef.current?.contains(target)) setProjectSwitcherOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [accountMenuOpen, notificationMenuOpen, projectSwitcherOpen]);

  const employeeOptions = useMemo(() => {
    const disciplineByName = new Map(users.map((user) => [user.displayName, user.discipline || "Unspecified"]));
    tasks.forEach((task) => {
      if (task.employeeDiscipline) disciplineByName.set(task.employeeName, task.employeeDiscipline);
    });
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
        (tab === "projects" && selectedProjectCode ? task.project === selectedProjectCode : projectFilter === "all" || task.project === projectFilter) &&
        (statusFilter === "all" || task.status === statusFilter) &&
        (reviewFilter === "all" || task.managerCheck === reviewFilter) &&
        (!dueDateFilter || task.taskDate === dueDateFilter) &&
        (disciplineFilter === "all" || task.employeeDiscipline === disciplineFilter || users.find((user) => user.email === task.employeeEmail || user.displayName === task.employeeName)?.discipline === disciplineFilter);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }, [tasks, users, search, employeeFilter, projectFilter, statusFilter, reviewFilter, dueDateFilter, disciplineFilter, tab, selectedProjectCode]);

  const selectedProject = useMemo(() => projects.find((project) => project.code === selectedProjectCode) || null, [projects, selectedProjectCode]);
  const currentUserIsProjectManager = Boolean(currentUser && selectedProject?.projectManagerEmails.includes(currentUser.email));
  const projectTasks = useMemo(() => filteredTasks.filter((task) => task.project === selectedProjectCode), [filteredTasks, selectedProjectCode]);
  const projectStats = useMemo(() => {
    const count = (value: Task["managerCheck"]) => projectTasks.filter((task) => task.managerCheck === value).length;
    return { total: projectTasks.length, new: count("new"), pending: count("pending"), approved: count("approved"), returned: count("returned") };
  }, [projectTasks]);

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

  const filteredTeamRows = useMemo(() => {
    const term = teamSearch.trim().toLowerCase();
    return teamRows.filter((user) =>
      (!term || `${user.displayName} ${user.email} ${user.discipline} ${user.role}`.toLowerCase().includes(term)) &&
      (teamDisciplineFilter === "all" || user.discipline === teamDisciplineFilter) &&
      (teamRoleFilter === "all" || user.role === teamRoleFilter)
    );
  }, [teamRows, teamSearch, teamDisciplineFilter, teamRoleFilter]);

  const projectRows = useMemo(() => projects.map((project) => {
    const rows = tasks.filter((task) => task.project === project.code);
    const issueRows = overviewIssues.filter((issue) => issue.projectCode === project.code);
    const done = rows.filter((task) => task.status === "done").length;
    return {
      ...project,
      total: rows.length,
      done,
      progress: rows.length ? Math.round((done / rows.length) * 100) : 0,
      planned: rows.reduce((sum, task) => sum + task.plannedHours, 0),
      actual: rows.reduce((sum, task) => sum + task.actualHours, 0),
      openIssues: issueRows.filter((issue) => issue.status !== "closed").length,
      totalIssues: issueRows.length,
      closedIssues: issueRows.filter((issue) => issue.status === "closed").length,
      totalRfi: 0,
      closedRfi: 0,
    };
  }), [projects, tasks, overviewIssues]);

  const filteredProjectRows = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    return projectRows.filter((project) =>
      (!term || `${project.name} ${project.code} ${project.client}`.toLowerCase().includes(term)) &&
      (projectStatusFilter === "all" || project.status === projectStatusFilter)
    );
  }, [projectRows, projectSearch, projectStatusFilter]);

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

  function openProjectWorkspace(projectCode: string, section: ProjectWorkspaceTab = "tasks") {
    setSelectedProjectCode(projectCode);
    setProjectWorkspaceTab(section);
    setSearch("");
    setEmployeeFilter("all");
    setProjectFilter("all");
    setStatusFilter("all");
    setReviewFilter("all");
    setDueDateFilter("");
    setDisciplineFilter("all");
    setTab("projects");
  }

  function openProjectDirectory() {
    setSelectedProjectCode("");
    setTab("projects");
  }

  function openNewTask(projectCode = "") {
    setSelectedTaskId(null);
    const form = blankTask(currentUser || undefined);
    if (projectCode) form.project = projectCode;
    setTaskForm(form);
    setCommentDraft("");
    setSubtaskDraft("");
    setDraftSubtasks([]);
    setDraftTaskAttachments([]);
    setTaskAttachmentProgress(null);
    setTaskDrawerOpen(true);
  }

  function openNewPrivateTask(projectCode = "") {
    if (!currentUser || currentUser.role !== "member") return;
    setSelectedTaskId(null);
    const form = blankTask(currentUser, "private");
    form.project = projectCode || projects.find((project) => project.status === "active")?.code || "PERSONAL";
    setTaskForm(form);
    setCommentDraft("");
    setSubtaskDraft("");
    setDraftSubtasks([]);
    setDraftTaskAttachments([]);
    setTaskAttachmentProgress(null);
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
    setSubtaskDraft("");
    setDraftSubtasks([]);
    setDraftTaskAttachments([]);
    setTaskAttachmentProgress(null);
    setTaskDrawerOpen(true);
  }

  async function openLinkedTask(id: number) {
    const current = tasks.find((task) => task.id === id);
    if (current) {
      openProjectWorkspace(current.project, "tasks");
      openTask(current);
      return;
    }
    const data = await fetchWorkspaceData();
    if (!data) return;
    applyWorkspaceData(data);
    const linked = data.tasks.find((task) => task.id === id);
    if (linked) { openProjectWorkspace(linked.project, "tasks"); openTask(linked); }
  }

  function openNewProject() {
    if (currentUser?.role !== "owner") return;
    setSelectedProjectId(null);
    setProjectForm(blankProject());
    setProjectDrawerOpen(true);
  }

  function openProject(project: Project) {
    setProjectDrawerReturnToTask(false);
    setSelectedProjectId(project.id);
    setProjectForm({ code: project.code, name: project.name, client: project.client, status: project.status, startDate: project.startDate, targetDate: project.targetDate, memberEmails: project.memberEmails || [], projectManagerEmails: project.projectManagerEmails || [] });
    setProjectDrawerOpen(true);
  }

  function openProjectFromTask(project: Project) {
    setProjectDrawerReturnToTask(true);
    setSelectedProjectId(project.id);
    setProjectForm({ code: project.code, name: project.name, client: project.client, status: project.status, startDate: project.startDate, targetDate: project.targetDate, memberEmails: project.memberEmails || [], projectManagerEmails: project.projectManagerEmails || [] });
    setProjectDrawerOpen(true);
  }

  function openIssueFromOverview(id: number) {
    const issue = overviewIssues.find((item) => item.id === id);
    if (issue) openProjectWorkspace(issue.projectCode, "issues");
    else setTab("issues");
    window.setTimeout(() => issuesModuleRef.current?.openIssue(id), 180);
  }

  function openNewIssue() {
    if (tab === "projects" && selectedProjectCode && projectWorkspaceTab === "issues") {
      issuesModuleRef.current?.openNew();
      return;
    }
    const projectCode = selectedProjectCode || projects.find((project) => project.status === "active")?.code || projects[0]?.code;
    if (!projectCode) { setError("Create a project before adding an issue."); return; }
    openProjectWorkspace(projectCode, "issues");
    window.setTimeout(() => issuesModuleRef.current?.openNew(), 180);
  }

  function reviewMemberProjectTasks(user: User, projectCode: string) {
    setProjectDrawerOpen(false);
    openProjectWorkspace(projectCode, "tasks");
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
    openProjectWorkspace(projectCode, "tasks");
    setSearch("");
    setEmployeeFilter(employeeName);
    setProjectFilter(projectCode);
    setStatusFilter("all");
    setReviewFilter("all");
    setToast(`Showing ${employeeName} tasks for ${projectCode} · تم عرض المهام المفلترة`);
  }

  function openNewUser() {
    setUserDrawerReturnToProject(false);
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
    setUserDrawerReturnToProject(false);
    setUserRemovalWarning(null);
    setSelectedUserEmail(user.email);
    setUserForm({ email: user.email, displayName: user.displayName, role: user.role, discipline: user.discipline, temporaryPassword: "" });
    setUserDrawerOpen(true);
  }

  function openUserFromProject(user: User) {
    if (!isManagement(currentUser)) return;
    if (currentUser?.role === "manager" && (user.role !== "member" || user.discipline !== currentUser.discipline)) return;
    setUserDrawerReturnToProject(true);
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
        body: JSON.stringify(selectedTaskId ? { ...taskForm, id: selectedTaskId } : { ...taskForm, subtasks: draftSubtasks.map((subtask) => subtask.title), initialNote: commentDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر حفظ المهمة");
      setTasks((current) => selectedTaskId ? current.map((task) => task.id === selectedTaskId ? data.task : task) : [data.task, ...current]);
      if (!selectedTaskId && Array.isArray(data.subtasks)) setSubtasks((current) => [...current, ...data.subtasks]);
      if (!selectedTaskId && Array.isArray(data.comments)) setComments((current) => [...current, ...data.comments]);
      if (!selectedTaskId && draftTaskAttachments.length) {
        let allUploaded = true;
        for (const attachment of draftTaskAttachments) allUploaded = await uploadTaskAttachment(attachment.file, null, data.task.id, false) && allUploaded;
        if (!allUploaded) {
          setSelectedTaskId(data.task.id);
          setDraftTaskAttachments([]);
          setCommentDraft("");
          setToast("Task saved; review the attachment that could not be uploaded · تم حفظ المهمة");
          return;
        }
      }
      if (selectedTaskId) openTask(data.task);
      else setTaskDrawerOpen(false);
      setToast(selectedTaskId ? "تم تحديث المهمة بنجاح" : "تمت إضافة المهمة بنجاح");
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

  async function updateComment(commentId: number, body: string) {
    if (!body.trim()) return false;
    setSavingComment(true); setError("");
    try {
      const response = await fetch("/api/task-comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: commentId, body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to edit note");
      setComments((current) => current.map((comment) => comment.id === commentId ? data.comment : comment));
      setToast("تم تحديث الملاحظة بنجاح");
      return true;
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "تعذر تعديل الملاحظة");
      return false;
    } finally {
      setSavingComment(false);
    }
  }

  async function deleteComment(comment: TaskComment) {
    if (currentUser?.role !== "owner") return;
    const approved = await confirm({ title: "Delete task note?", titleAr: "حذف ملاحظة المهمة؟", message: comment.body, messageAr: "سيتم حذف الملاحظة نهائيًا.", confirmLabel: "Delete note", confirmLabelAr: "حذف الملاحظة" });
    if (!approved) return;
    setSavingComment(true); setError("");
    try {
      const response = await fetch(`/api/task-comments?id=${comment.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete note");
      setComments((current) => current.filter((item) => item.id !== comment.id));
      setToast("تم حذف الملاحظة بنجاح");
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "تعذر حذف الملاحظة");
    } finally {
      setSavingComment(false);
    }
  }

  async function addSubtask() {
    const title = subtaskDraft.trim();
    if (!title) return;
    if (!selectedTaskId) {
      setDraftSubtasks((current) => [...current, { id: crypto.randomUUID(), title }]);
      setSubtaskDraft("");
      return;
    }
    setSubtaskBusy(true); setError("");
    try {
      const response = await fetch("/api/task-subtasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: selectedTaskId, title }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to add subtask.");
      setSubtasks((current) => [...current, data.subtask]);
      setSubtaskDraft("");
      setToast("Subtask added · تمت إضافة المهمة الفرعية");
    } catch (subtaskError) { setError(subtaskError instanceof Error ? subtaskError.message : "Unable to add subtask."); }
    finally { setSubtaskBusy(false); }
  }

  function deleteDraftSubtask(id: string) {
    setDraftSubtasks((current) => current.filter((subtask) => subtask.id !== id));
  }

  function addDraftTaskAttachments(files: File[]) {
    const valid = files.filter((file) => file.size <= 25 * 1024 * 1024);
    if (valid.length !== files.length) setError("Each attachment must not exceed 25 MB.");
    setDraftTaskAttachments((current) => [...current, ...valid.map((file) => ({ id: crypto.randomUUID(), file }))].slice(0, 10));
  }

  function deleteDraftTaskAttachment(id: string) {
    setDraftTaskAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function toggleSubtask(subtask: TaskSubtask) {
    setSubtaskBusy(true); setError("");
    try {
      const response = await fetch("/api/task-subtasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: subtask.id, completed: !subtask.completed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update subtask.");
      setSubtasks((current) => current.map((item) => item.id === data.subtask.id ? data.subtask : item));
      setToast(data.subtask.completed
        ? data.managementNotified
          ? "Subtask closed and management notified · أُغلقت المهمة الفرعية وتم إشعار المسؤول"
          : "Subtask closed · أُغلقت المهمة الفرعية"
        : "Subtask reopened · أعيد فتح المهمة الفرعية");
    } catch (subtaskError) { setError(subtaskError instanceof Error ? subtaskError.message : "Unable to update subtask."); }
    finally { setSubtaskBusy(false); }
  }

  async function deleteSubtask(subtask: TaskSubtask) {
    const approved = await confirm({ title: "Delete subtask?", titleAr: "حذف المهمة الفرعية؟", message: "The subtask and its attachments will be permanently removed.", messageAr: "سيتم حذف المهمة الفرعية ومرفقاتها نهائيًا." });
    if (!approved) return;
    setSubtaskBusy(true); setError("");
    try {
      const response = await fetch(`/api/task-subtasks?id=${subtask.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete subtask.");
      setSubtasks((current) => current.filter((item) => item.id !== subtask.id));
      setTaskAttachments((current) => current.filter((attachment) => attachment.subtaskId !== subtask.id));
      setToast("Subtask deleted · تم حذف المهمة الفرعية");
    } catch (subtaskError) { setError(subtaskError instanceof Error ? subtaskError.message : "Unable to delete subtask."); }
    finally { setSubtaskBusy(false); }
  }

  async function uploadTaskAttachment(file: File, subtaskId: number | null, taskId = selectedTaskId, announce = true) {
    if (!taskId) return false;
    if (file.size > 25 * 1024 * 1024) { setError("Each attachment must not exceed 25 MB."); return false; }
    setTaskAttachmentBusy(true); setTaskAttachmentProgress({ fileName: file.name, subtaskId, percent: 0 }); setError("");
    let uploadId = "";
    try {
      const startResponse = await fetch("/api/task-attachments?action=start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, subtaskId, fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }) });
      const started = await startResponse.json();
      if (!startResponse.ok) throw new Error(started.error || "Unable to start attachment upload.");
      uploadId = started.uploadId;
      const chunkBytes = Number(started.chunkBytes);
      const chunkCount = Number(started.chunkCount);
      for (let index = 0; index < chunkCount; index += 1) {
        const chunk = file.slice(index * chunkBytes, Math.min(file.size, (index + 1) * chunkBytes));
        const response = await fetch(`/api/task-attachments?action=chunk&uploadId=${encodeURIComponent(uploadId)}&index=${index}`, { method: "POST", body: chunk });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Unable to upload attachment part."); }
        setTaskAttachmentProgress({ fileName: file.name, subtaskId, percent: Math.min(95, Math.round(((index + 1) / chunkCount) * 95)) });
      }
      const completeResponse = await fetch("/api/task-attachments?action=complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId }) });
      const completed = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(completed.error || "Unable to finish attachment upload.");
      setTaskAttachments((current) => [...current, completed.attachment]);
      setTaskAttachmentProgress({ fileName: file.name, subtaskId, percent: 100 });
      if (announce) setToast("Attachment uploaded · تم رفع المرفق");
      return true;
    } catch (attachmentError) {
      if (uploadId) void fetch("/api/task-attachments?action=abort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId }) });
      setError(attachmentError instanceof Error ? attachmentError.message : "Unable to upload attachment.");
      return false;
    } finally { window.setTimeout(() => setTaskAttachmentProgress(null), 500); setTaskAttachmentBusy(false); }
  }

  async function deleteTaskAttachment(attachment: TaskAttachment) {
    const approved = await confirm({ title: "Delete attachment?", titleAr: "حذف المرفق؟", message: "This file will be permanently removed.", messageAr: "سيتم حذف هذا الملف نهائيًا." });
    if (!approved) return;
    setTaskAttachmentBusy(true); setError("");
    try {
      const response = await fetch(`/api/task-attachments?id=${attachment.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete attachment.");
      setTaskAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setToast("Attachment deleted · تم حذف المرفق");
    } catch (attachmentError) { setError(attachmentError instanceof Error ? attachmentError.message : "Unable to delete attachment."); }
    finally { setTaskAttachmentBusy(false); }
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
      setToast(action === "start"
        ? "بدأ تسجيل وقت المهمة"
        : action === "pause"
          ? "تم إيقاف الوقت مؤقتًا"
          : data.submittedForReview
            ? "اكتملت المهمة وأُرسلت للمراجعة"
            : "اكتملت المهمة الخاصة");
    } catch (timerError) {
      setError(timerError instanceof Error ? timerError.message : "تعذر تحديث وقت المهمة");
    } finally {
      setSavingTimer(false);
    }
  }

  async function updateWorkSession(entryId: number, startedAt: string, endedAt: string) {
    setSavingTimer(true); setError("");
    try {
      const response = await fetch("/api/task-timer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, startedAt, endedAt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update work session.");
      mergeTimerResponse(data);
      setToast("Work session updated · تم تعديل جلسة العمل");
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "تعذر تعديل جلسة العمل");
    } finally { setSavingTimer(false); }
  }

  async function deleteWorkSession(entryId: number) {
    const approved = await confirm({ title: "Delete work session?", titleAr: "حذف جلسة العمل؟", message: "This recorded time entry will be permanently removed.", messageAr: "سيتم حذف سجل الوقت نهائيًا من المهمة.", confirmLabel: "Delete session", confirmLabelAr: "حذف الجلسة" });
    if (!approved) return;
    setSavingTimer(true); setError("");
    try {
      const response = await fetch(`/api/task-timer?entryId=${entryId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete work session.");
      mergeTimerResponse(data);
      setToast("Work session deleted · تم حذف جلسة العمل");
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "تعذر حذف جلسة العمل");
    } finally { setSavingTimer(false); }
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
      setToast("تمت مشاركة المهمة الخاصة مع المسؤول");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "تعذر إرسال المهمة للمسؤول");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!selectedTaskId) return;
    const approved = await confirm({ title: "Delete task?", titleAr: "حذف المهمة؟", message: "The task, its notes, and its work sessions will be permanently removed.", messageAr: "سيتم حذف المهمة وملاحظاتها وجلسات العمل المرتبطة بها نهائيًا." });
    if (!approved) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks?id=${selectedTaskId}`, { method: "DELETE" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر حذف المهمة");
      setTasks((current) => current.filter((task) => task.id !== selectedTaskId));
      setComments((current) => current.filter((comment) => comment.taskId !== selectedTaskId));
      setTimeEntries((current) => current.filter((entry) => entry.taskId !== selectedTaskId));
      setSubtasks((current) => current.filter((subtask) => subtask.taskId !== selectedTaskId));
      setTaskAttachments((current) => current.filter((attachment) => attachment.taskId !== selectedTaskId));
      setTaskDrawerOpen(false); setToast("تم حذف المهمة");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف المهمة"); }
    finally { setSaving(false); }
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (projectForm.startDate && projectForm.targetDate && projectForm.startDate >= projectForm.targetDate) {
        throw new Error("Project start date must be before the target date · يجب أن يكون تاريخ بداية المشروع قبل التاريخ المستهدف");
      }
      const response = await fetch("/api/projects", {
        method: selectedProjectId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedProjectId ? { ...projectForm, id: selectedProjectId } : projectForm),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "تعذر حفظ المشروع");
      const oldCode = projects.find((project) => project.id === selectedProjectId)?.code;
      setProjects((current) => selectedProjectId ? current.map((project) => project.id === selectedProjectId ? data.project : project) : [...current, data.project]);
      if (oldCode && oldCode !== data.project.code) {
        setTasks((current) => current.map((task) => task.project === oldCode ? { ...task, project: data.project.code } : task));
        setTaskForm((current) => current.project === oldCode ? { ...current, project: data.project.code } : current);
      }
      if (selectedProjectId) {
        setProjectForm({ code: data.project.code, name: data.project.name, client: data.project.client, status: data.project.status, startDate: data.project.startDate, targetDate: data.project.targetDate, memberEmails: data.project.memberEmails || [], projectManagerEmails: data.project.projectManagerEmails || [] });
        if (projectDrawerReturnToTask) {
          setProjectDrawerOpen(false);
          setProjectDrawerReturnToTask(false);
        }
      } else setProjectDrawerOpen(false);
      setToast(selectedProjectId
        ? data.removedInvalidMembers > 0
          ? `تم تحديث المشروع وإزالة ${data.removedInvalidMembers} عضو قديم أو غير صالح`
          : "تم تحديث المشروع"
        : "تمت إضافة المشروع");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المشروع"); }
    finally { setSaving(false); }
  }

  async function deleteProject() {
    if (!selectedProjectId) return;
    const approved = await confirm({ title: "Delete project?", titleAr: "حذف المشروع؟", message: "Only an empty project can be deleted. This action cannot be undone.", messageAr: "يمكن حذف المشروع الفارغ فقط، ولا يمكن التراجع عن هذه العملية.", confirmLabel: "Delete project", confirmLabelAr: "حذف المشروع" });
    if (!approved) return;
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
      if (oldName && oldName !== data.user.displayName) setTasks((current) => current.map((task) => ({
        ...task,
        employeeName: task.employeeEmail === data.user.email ? data.user.displayName : task.employeeName,
        createdByName: task.createdBy === data.user.email ? data.user.displayName : task.createdByName,
      })));
      if (selectedUserEmail) {
        setUserForm({ email: data.user.email, displayName: data.user.displayName, role: data.user.role, discipline: data.user.discipline, temporaryPassword: "" });
        if (userDrawerReturnToProject) {
          setUserDrawerOpen(false);
          setUserDrawerReturnToProject(false);
        }
      }
      else setUserDrawerOpen(false);
      setToast(selectedUserEmail ? "تم تحديث بيانات الموظف" : "تمت إضافة حساب الموظف");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ الموظف"); }
    finally { setSaving(false); }
  }

  async function deleteUser() {
    if (!selectedUserEmail) return;
    const approved = await confirm({ title: "Delete employee?", titleAr: "حذف الموظف؟", message: "The employee account will be permanently removed if it has no assigned tasks.", messageAr: "سيتم حذف حساب الموظف نهائيًا إذا لم تكن لديه مهام مسندة.", confirmLabel: "Delete employee", confirmLabelAr: "حذف الموظف" });
    if (!approved) return;
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
        const issue = overviewIssues.find((item) => item.id === notification.issueId);
        if (issue) openProjectWorkspace(issue.projectCode, "issues");
        else setTab("issues");
        window.setTimeout(() => issuesModuleRef.current?.openIssue(notification.issueId!), 150);
      } else if (notification?.taskId) {
        const freshData = await fetchWorkspaceData();
        if (freshData) applyWorkspaceData(freshData);
        const task = freshData?.tasks.find((item) => item.id === notification.taskId);
        if (task) { openProjectWorkspace(task.project, "tasks"); openTask(task); }
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
    const approved = await confirm({ title: "Delete profile image?", titleAr: "حذف صورة الحساب؟", message: "The current profile image will be removed from your account.", messageAr: "سيتم حذف صورة الحساب الحالية.", confirmLabel: "Delete image", confirmLabelAr: "حذف الصورة" });
    if (!approved) return;
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
      const confirmed = await confirm({ title: "Restore backup?", titleAr: "استعادة النسخة الاحتياطية؟", message: `This will replace the current application data with ${totalRecords} records from the selected backup.`, messageAr: `سيتم استبدال بيانات التطبيق الحالية بعدد ${totalRecords} سجل من النسخة المحددة. احتفظ بنسخة احتياطية قبل المتابعة.`, confirmLabel: "Restore data", confirmLabelAr: "استعادة البيانات" });
      if (!confirmed) return;
      setBackupBusy("restore");
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: source,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to restore backup.");
      setToast("تمت استعادة البيانات بنجاح مع الحفاظ على حساب المالك الحالي وكلمة مروره");
      window.setTimeout(() => window.location.reload(), 900);
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

  async function exportExcel() {
    const headers = ["المجموعة", "إجمالي المهام", "مكتملة", "مفتوحة", "متوقفة/تعديل", "ساعات مخططة", "ساعات فعلية"];
    const rows: (string | number)[][] = reportRows.map((row) => [row.key, row.total, row.done, row.open, row.blocked, row.planned, row.actual]);
    const columnName = (index: number) => String.fromCharCode(65 + index);
    const worksheetRows = [headers, ...rows].map((row, rowIndex) => {
      const excelRow = rowIndex + 8;
      const cells = row.map((cell, cellIndex) => {
        const ref = `${columnName(cellIndex)}${excelRow}`;
        return typeof cell === "number"
          ? `<c r="${ref}"${rowIndex === 0 ? ' s="1"' : ""}><v>${cell}</v></c>`
          : `<c r="${ref}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t>${escapeXml(cell)}</t></is></c>`;
      }).join("");
      return `<row r="${excelRow}">${cells}</row>`;
    }).join("");
    try {
      const [{ default: JSZip }, logoResponse] = await Promise.all([import("jszip"), fetch("/report-logo.png")]);
      if (!logoResponse.ok) throw new Error("Unable to load report logo.");
      const logo = await logoResponse.arrayBuffer();
      const zip = new JSZip();
      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
      zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
      zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`);
      zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
      zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF171717"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`);
      zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="7" width="16" customWidth="1"/></cols><sheetData><row r="1" ht="110" customHeight="1"/><row r="6"><c r="A6" t="inlineStr"><is><t>${escapeXml(`HINDAZA ${reportPeriod === "week" ? "Weekly" : "Monthly"} Report · ${formatDate(range.start)} — ${formatDate(range.end)}`)}</t></is></c></row>${worksheetRows}</sheetData><mergeCells count="1"><mergeCell ref="A6:G6"/></mergeCells><drawing r:id="rId1"/></worksheet>`);
      zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
      zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="3657600" cy="1334190"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="HINDAZA Report Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
      zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/report-logo.png"/></Relationships>`);
      zip.file("xl/media/report-logo.png", logo);
      const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `HINDAZA_${reportPeriod}_report_${range.start}_${range.end}.xlsx`; link.click(); URL.revokeObjectURL(url);
      setToast("تم تنزيل تقرير Excel مع الشعار");
    } catch (excelError) {
      setError(excelError instanceof Error ? excelError.message : "تعذر إنشاء ملف Excel");
    }
  }

  function exportPdf() {
    const popup = window.open("", "_blank", "width=1050,height=760");
    if (!popup) { setError("يرجى السماح بالنوافذ المنبثقة لتنزيل تقرير PDF."); return; }
    const rows = reportRows.map((row) => `<tr><td>${escapeXml(row.key)}</td><td>${row.total}</td><td>${row.done}</td><td>${row.open}</td><td>${row.blocked}</td><td>${row.planned.toFixed(1)}</td><td>${row.actual.toFixed(1)}</td></tr>`).join("");
    const bars = reportRows.map((row) => `<div class="bar-row"><strong>${escapeXml(row.key)}</strong><div class="bar"><i style="width:${(row.total / maxReportTotal) * 100}%"></i></div><span>${row.total}</span></div>`).join("");
    popup.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>HINDAZA Project Management Report</title><style>body{font-family:Arial,Tahoma,sans-serif;color:#1d1d1d;padding:30px;text-align:left}.logo{display:block;width:360px;max-width:55%;height:auto;margin:0 auto 22px 0}h1{color:#171717;margin:0;border-left:5px solid #ffd200;padding-left:12px}.meta{color:#737373;margin:8px 0 24px}.summary{display:flex;gap:10px;margin:20px 0}.summary div{border:1px solid #e2e2dc;border-radius:10px;padding:12px 18px}.summary strong{font-size:22px;color:#8b6c00;display:block}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{border:1px solid #e2e2dc;padding:8px;text-align:left;font-size:11px}th{background:#171717;color:white}.chart{margin:24px 0}.bar-row{display:grid;grid-template-columns:160px 1fr 35px;gap:10px;align-items:center;margin:9px 0;font-size:11px}.bar{height:16px;background:#f1f1ed;border-radius:8px;overflow:hidden}.bar i{display:block;height:100%;background:#ffd200}.footer{margin-top:30px;color:#858585;font-size:9px}@media print{body{padding:0}}</style></head><body><img class="logo" src="/report-logo.png" alt="HINDAZA"><h1>HINDAZA Project Management</h1><div class="meta">${reportPeriod === "week" ? "التقرير الأسبوعي" : "التقرير الشهري"} · ${formatDate(range.start)} — ${formatDate(range.end)}</div><div class="summary"><div>إجمالي المهام<strong>${reportSummary.total}</strong></div><div>مكتملة<strong>${reportSummary.done}</strong></div><div>تحتاج متابعة<strong>${reportSummary.attention}</strong></div><div>الساعات الفعلية<strong>${reportSummary.actual.toFixed(1)}</strong></div></div><div class="chart">${bars}</div><table><thead><tr><th>المجموعة</th><th>الإجمالي</th><th>مكتملة</th><th>مفتوحة</th><th>متابعة</th><th>مخطط</th><th>فعلي</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  }

  const unreadNotifications = notifications.filter((notification) => !notification.read).length;
  const navItems: { key: Tab; icon: string; ar: string; en: string }[] = [
    { key: "team", icon: "/icons/team-v2.png", ar: "الفريق", en: "Team" },
    { key: "reports", icon: "/icons/reports-v2.png", ar: "التقارير", en: "Reports" },
  ].filter((item) => isManagement(currentUser) || item.key !== "team");
  const pageTitle: Record<Tab, string> = {
    overview: "PROJECT OVERVIEW",
    tasks: "TASK MANAGEMENT",
    rfi: "REQUEST FOR INFORMATION",
    issues: "PROJECT ISSUES",
    projects: "PROJECT MANAGEMENT",
    team: "TEAM",
    reports: "REPORTS",
    activity: "ACTIVITY LOG",
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="التنقل الرئيسي">
        <div className="brand-block"><img src="/hindaza-logo.png" alt="HINDAZA Engineering BIM" /><span>PROJECT MANAGEMENT</span></div>
        <nav className="nav-list">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")} aria-label="Open Overview"><span className="nav-icon">◫</span><span><strong>Overview</strong><small dir="rtl">نظرة عامة</small></span></button>
          <button className={tab === "projects" ? "active" : ""} onClick={openProjectDirectory} aria-label="Open Project Management"><span className="nav-icon has-image"><img src="/icons/projects-v2.png" alt="" aria-hidden="true" /></span><span><strong>Project</strong><small dir="rtl">المشاريع</small></span></button>
          {navItems.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)} aria-label={`Open ${item.en}`}><span className={`nav-icon${item.icon.startsWith("/") ? " has-image" : ""}`}>{item.icon.startsWith("/") ? <img src={item.icon} alt="" aria-hidden="true" /> : item.icon}</span><span><strong>{item.en}</strong><small dir="rtl">{item.ar}</small></span></button>)}
        </nav>
        <div className="sidebar-account" ref={accountMenuRef}>
          {accountMenuOpen && <div className="account-menu">
            <div className="account-menu-title"><strong>{currentUser?.displayName}</strong><span dir="ltr">{currentUser?.email}</span><em>{currentUser ? roleLabel(currentUser.role) : ""}</em></div>
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
        <header className={`topbar${tab === "projects" && selectedProject ? " project-context-topbar" : ""}`}>
          <div className="page-heading"><div className="project-heading-line"><h1 dir="ltr">{tab === "projects" && selectedProject ? selectedProject.name : pageTitle[tab]}</h1>{tab === "projects" && selectedProject && projects.length > 1 && <div className="project-switcher" ref={projectSwitcherRef}><button type="button" className="project-switcher-button" onClick={() => setProjectSwitcherOpen((open) => !open)} aria-label="Switch project" aria-expanded={projectSwitcherOpen} title="Switch project"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5-5 5 5M17 15l-5 5-5-5" /></svg></button>{projectSwitcherOpen && <div className="project-switcher-menu" role="menu" aria-label="Available projects">{projects.map((project) => <button type="button" role="menuitem" key={project.code} className={project.code === selectedProject.code ? "active" : ""} onClick={() => { openProjectWorkspace(project.code, projectWorkspaceTab); setProjectSwitcherOpen(false); }}><strong>{project.name}</strong><small>{project.code}</small></button>)}</div>}</div>}</div>{tab === "projects" && selectedProject && <div className="project-heading-meta"><span className="project-heading-code">{selectedProject.code}</span><span className={`project-status ${selectedProject.status}`}>{projectStatusLabel[selectedProject.status]}</span>{selectedProject.client && <span className="project-heading-client">{selectedProject.client}</span>}</div>}<p className="subhead" dir="ltr">{new Intl.DateTimeFormat("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}</p></div>
          <div className="topbar-actions">
            {tab === "projects" && selectedProject && projectWorkspaceTab === "tasks" && isManagement(currentUser) && <button className="primary-button topbar-add-button" onClick={() => openNewTask(selectedProject.code)}><span className="button-icon" aria-hidden="true">✓</span><span>New Task</span></button>}
            {tab === "projects" && selectedProject && projectWorkspaceTab === "tasks" && currentUser?.role === "member" && <button className="primary-button topbar-add-button private-task-button" onClick={() => openNewPrivateTask(selectedProject.code)}><span className="button-icon" aria-hidden="true">✓</span><span>Private Task</span></button>}
            {tab === "projects" && selectedProject && projectWorkspaceTab === "issues" && <button className="primary-button topbar-add-button" onClick={openNewIssue}><span className="button-icon" aria-hidden="true">!</span><span>New Issue</span></button>}
            {tab === "projects" && !selectedProject && currentUser?.role === "owner" && <button className="primary-button topbar-add-button" onClick={openNewProject}><img className="button-icon icon-image" src="/icons/projects-v2.png" alt="" aria-hidden="true" /><span>New Project</span></button>}
            {tab === "team" && isManagement(currentUser) && <button className="primary-button topbar-add-button" onClick={openNewUser}><img className="button-icon icon-image" src="/icons/team-v2.png" alt="" aria-hidden="true" /><span>Add Employee</span></button>}
            {tab === "projects" && selectedProject && <button type="button" className="project-directory-back" onClick={openProjectDirectory} aria-label="Back to Projects" title="Back to Projects"><span aria-hidden="true">←</span><strong>Projects</strong></button>}
            {tab === "projects" && selectedProject && isManagement(currentUser) && <button type="button" className="project-settings-topbar" onClick={() => openProject(selectedProject)} aria-label="Project settings" title="Project settings"><span aria-hidden="true">⚙</span></button>}
            <div className="notification-center" ref={notificationMenuRef}>
              <button className={`notification-bell${unreadNotifications ? " unread" : ""}`} onClick={() => { setAccountMenuOpen(false); setNotificationMenuOpen((open) => !open); }} aria-label="Notifications"><span className="bell-icon" aria-hidden="true" />{unreadNotifications > 0 && <em>{unreadNotifications > 99 ? "99+" : unreadNotifications}</em>}</button>
              {notificationMenuOpen && <div className="notification-popover">
                <div className="notification-popover-head"><div><strong>Notifications</strong><span>الإشعارات</span></div>{notifications.length > 0 && <button onClick={() => markNotification()}><ButtonLabel en="Read all" ar="قراءة الكل" /></button>}</div>
                {notifications.length === 0 ? <div className="notification-popover-empty">لا توجد إشعارات جديدة</div> : <div className="notification-popover-list">{notifications.map((notification) => <button key={notification.id} className={notification.read ? "" : "unread"} onClick={() => markNotification(notification)}><i>{notification.issueId ? "!" : notification.type === "task_assigned" ? "+" : "✓"}</i><span><strong>{notification.title}</strong><small>{notification.message}</small><time dir="ltr">{formatDateTime(notification.createdAt)}</time></span></button>)}</div>}
              </div>}
            </div>
          </div>
        </header>

        {error && <div className="error-banner"><span>{error}</span><div className="error-actions"><button className="retry-load-button" onClick={() => void loadWorkspace(!currentUser, true)}><ButtonLabel en="Retry" ar="إعادة المحاولة" /></button><button className="dismiss-error-button" onClick={() => setError("")} aria-label="Close">×</button></div></div>}

        {tab === "overview" && <ProjectOverviewDashboard
          loading={loading}
          projects={projectRows}
          tasks={tasks}
          issues={overviewIssues}
          timeEntries={timeEntries}
          clock={clock}
          isEmployee={currentUser?.role === "member"}
          openProject={openProject}
          openTask={openTask}
          openIssue={openIssueFromOverview}
          showProjects={openProjectDirectory}
          showTasks={() => { const project = projects.find((item) => item.status === "active") || projects[0]; if (project) openProjectWorkspace(project.code, "tasks"); else openProjectDirectory(); }}
          showIssues={() => { const project = projects.find((item) => item.status === "active") || projects[0]; if (project) openProjectWorkspace(project.code, "issues"); else openProjectDirectory(); }}
        />}

        {tab === "projects" && selectedProject && <section className="project-workspace" aria-label={`${selectedProject.name} workspace`}>
          <div className="project-workspace-tabs" role="tablist" aria-label="Project sections">
            <button className={projectWorkspaceTab === "tasks" ? "active" : ""} onClick={() => setProjectWorkspaceTab("tasks")} role="tab" aria-selected={projectWorkspaceTab === "tasks"}><span className="report-type-icon" aria-hidden="true">✓</span> Tasks</button>
            <button className={projectWorkspaceTab === "issues" ? "active" : ""} onClick={() => setProjectWorkspaceTab("issues")} role="tab" aria-selected={projectWorkspaceTab === "issues"}><span className="report-type-icon" aria-hidden="true">!</span> Issues</button>
            <button className={projectWorkspaceTab === "rfi" ? "active" : ""} onClick={() => setProjectWorkspaceTab("rfi")} role="tab" aria-selected={projectWorkspaceTab === "rfi"}><span className="report-type-icon" aria-hidden="true">?</span> RFI</button>
          </div>
          {projectWorkspaceTab === "tasks" && <>
            <section className="stats-grid task-stats-ltr" aria-label={`${selectedProject.name} task summary`} dir="ltr">
              <article className="stat-card navy"><span>Total Tasks · إجمالي المهام</span><strong>{projectStats.total}</strong></article>
              <article className="stat-card violet"><span>New / WIP · جديدة / قيد العمل</span><strong>{projectStats.new}</strong></article>
              <article className="stat-card blue"><span>Pending Review · بانتظار المراجعة</span><strong>{projectStats.pending}</strong></article>
              <article className="stat-card green"><span>Approved · معتمدة</span><strong>{projectStats.approved}</strong></article>
              <article className="stat-card amber"><span>Returned · مُعادة</span><strong>{projectStats.returned}</strong></article>
            </section>
            <TaskTable loading={loading} tasks={projectTasks} filteredCount={projectTasks.length} tab={tab} employees={employeeOptions} users={users} projects={[selectedProject.code]} lockedProjectCode={selectedProject.code} search={search} employeeFilter={employeeFilter} projectFilter={projectFilter} statusFilter={statusFilter} reviewFilter={reviewFilter} dueDateFilter={dueDateFilter} disciplineFilter={disciplineFilter} showEmployeeFilter={currentUser?.role !== "member" || currentUserIsProjectManager} showDisciplineColumn={currentUser?.role === "owner" || currentUser?.role === "manager" || currentUserIsProjectManager} setSearch={setSearch} setEmployeeFilter={setEmployeeFilter} setProjectFilter={setProjectFilter} setStatusFilter={setStatusFilter} setReviewFilter={setReviewFilter} setDueDateFilter={setDueDateFilter} setDisciplineFilter={setDisciplineFilter} openTask={openTask} showAll={() => undefined} timeEntries={timeEntries} clock={clock} commentCounts={taskCommentCounts} subtasks={subtasks} />
          </>}
          {projectWorkspaceTab === "issues" && currentUser && <IssuesModule key={selectedProject.code} ref={issuesModuleRef} currentUser={currentUser} users={users} projects={[selectedProject]} lockedProjectCode={selectedProject.code} onTaskCreated={(task) => setTasks((current) => [task as Task, ...current])} onOpenTask={(id) => void openLinkedTask(id)} onOpenProjectSettings={(project) => openProjectFromTask(project as Project)} onToast={setToast} />}
          {projectWorkspaceTab === "rfi" && <section className="panel module-placeholder"><div className="module-icon">RFI</div><p>REQUEST FOR INFORMATION</p><h2>{selectedProject.name}</h2><span>This RFI workspace is limited to {selectedProject.code}.</span><div className="module-status">Ready for configuration</div></section>}
        </section>}

        {tab === "tasks" && <>
          <section className="stats-grid task-stats-ltr" aria-label="Task summary" dir="ltr">
            <article className="stat-card navy"><span>Total Tasks · إجمالي المهام</span><strong>{stats.total}</strong><small>جميع المهام الظاهرة لك</small></article>
            <article className="stat-card violet"><span>New / WIP · جديدة / قيد العمل</span><strong>{stats.new}</strong><small>جديدة أو قيد التنفيذ</small></article>
            <article className="stat-card blue"><span>Pending Review · بانتظار المراجعة</span><strong>{stats.pending}</strong><small>قيد مراجعة المسؤول</small></article>
            <article className="stat-card green"><span>Approved · معتمدة</span><strong>{stats.approved}</strong><small>تم اعتمادها من المسؤول</small></article>
            <article className="stat-card amber"><span>Returned · مُعادة</span><strong>{stats.returned}</strong><small>تحتاج إجراء من الموظف</small></article>
          </section>
          <TaskTable loading={loading} tasks={filteredTasks} filteredCount={filteredTasks.length} tab={tab} employees={employeeOptions} users={users} projects={projectCodes} search={search} employeeFilter={employeeFilter} projectFilter={projectFilter} statusFilter={statusFilter} reviewFilter={reviewFilter} dueDateFilter={dueDateFilter} disciplineFilter={disciplineFilter} showEmployeeFilter={currentUser?.role !== "member"} showDisciplineColumn={currentUser?.role === "owner" || currentUser?.role === "manager"} setSearch={setSearch} setEmployeeFilter={setEmployeeFilter} setProjectFilter={setProjectFilter} setStatusFilter={setStatusFilter} setReviewFilter={setReviewFilter} setDueDateFilter={setDueDateFilter} setDisciplineFilter={setDisciplineFilter} openTask={openTask} showAll={() => setTab("tasks")} timeEntries={timeEntries} clock={clock} commentCounts={taskCommentCounts} subtasks={subtasks} />
        </>}

        {tab === "rfi" && <section className="panel module-placeholder">
          <div className="module-icon">{tab === "rfi" ? "RFI" : "!"}</div>
          <p>{tab === "rfi" ? "REQUEST FOR INFORMATION" : "PROJECT ISSUES"}</p>
          <h2>{tab === "rfi" ? "بوابة طلبات المعلومات" : "سجل مشاكل المشاريع"}</h2>
          <span>تمت إضافة الوحدة إلى النظام، وسيتم استكمال الحقول ومسار العمل في المرحلة التالية.</span>
          <div className="module-status">جاهزة لإضافة التفاصيل · Ready for configuration</div>
        </section>}

        {tab === "issues" && currentUser && <IssuesModule ref={issuesModuleRef} currentUser={currentUser} users={users} projects={projects} onTaskCreated={(task) => setTasks((current) => [task as Task, ...current])} onOpenTask={(id) => void openLinkedTask(id)} onOpenProjectSettings={(project) => openProjectFromTask(project as Project)} onToast={setToast} />}

        {tab === "projects" && !selectedProject && <section className="panel projects-panel">
          <div className="directory-filters project-filter-row"><label className="search-box directory-search"><span>⌕</span><input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Search project..." aria-label="Search project" /></label><select value={projectStatusFilter} onChange={(event) => setProjectStatusFilter(event.target.value)} aria-label="فلترة المشاريع حسب الحالة"><option value="all">كل حالات المشاريع · All statuses</option>{Object.entries(projectStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="clear-filters-button" disabled={!projectSearch.trim() && projectStatusFilter === "all"} onClick={() => { setProjectSearch(""); setProjectStatusFilter("all"); }} aria-label="Clear all project filters" title="Clear filters"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{filteredProjectRows.length} {filteredProjectRows.length === 1 ? "Project" : "Projects"}</span><div className="view-switcher" role="group" aria-label="Project display style"><button type="button" className={projectView === "cards" ? "active" : ""} onClick={() => setProjectView("cards")} title="Cards view" aria-label="Cards view">▦</button><button type="button" className={projectView === "table" ? "active" : ""} onClick={() => setProjectView("table")} title="Table view" aria-label="Table view">☷</button></div></div>
          {filteredProjectRows.length === 0 ? <div className="empty-state"><strong>{projectRows.length ? "لا توجد مشاريع مطابقة" : "لا توجد مشاريع بعد"}</strong><p>{projectRows.length ? "غيّر البحث أو حالة المشروع لعرض نتائج أخرى." : "أضف أول مشروع لبدء تنظيم مهام الفريق."}</p></div> : projectView === "cards" ? <div className="project-grid directory-project-grid">{filteredProjectRows.map((project) => <button className="project-card directory-project-card" key={project.id} onClick={() => openProjectWorkspace(project.code)}><div className="project-card-head"><span className="project-table-identity"><strong>{project.name}</strong><small className="project-code">{project.code}</small></span>{isManagement(currentUser) && <span role="button" tabIndex={0} className="project-settings-button" onClick={(event) => { event.stopPropagation(); openProject(project); }}>⚙</span>}</div><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status]}</span><div className="project-card-progress"><span>Progress</span><strong>{project.progress}%</strong><progress max="100" value={project.progress} /></div><div className="project-card-metrics"><span><strong>{project.total}</strong> Tasks</span><span><strong>{project.totalIssues}</strong> Issues</span><span><strong>{project.memberEmails.length}</strong> Team</span></div><small>{project.client || "No client"} · {formatDate(project.targetDate)}</small></button>)}</div> : <div className="task-table-wrap directory-table-wrap"><table className="task-table directory-table project-management-table"><thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Progress</th><th>Tasks</th><th>Issues</th><th>RFI</th><th>Team</th><th>Target</th><th className="project-settings-column">Setting</th></tr></thead><tbody>{filteredProjectRows.map((project) => <tr key={project.id} onClick={() => openProjectWorkspace(project.code)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProjectWorkspace(project.code); }}><td><span className="project-table-identity"><strong>{project.name}</strong><small className="project-code">{project.code}</small></span></td><td>{project.client || "—"}</td><td><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status]}</span></td><td><strong>{project.progress}%</strong></td><td><span className="project-record-count"><strong>{project.total}</strong><small>{project.done} closed</small></span></td><td><span className="project-record-count"><strong>{project.totalIssues}</strong><small>{project.closedIssues} closed</small></span></td><td><span className="project-record-count"><strong>{project.totalRfi}</strong><small>{project.closedRfi} closed</small></span></td><td>{project.memberEmails.length}</td><td>{formatDate(project.targetDate)}</td><td className="project-settings-column">{isManagement(currentUser) ? <button type="button" className="project-settings-button" onClick={(event) => { event.stopPropagation(); openProject(project); }} onKeyDown={(event) => event.stopPropagation()} aria-label={`Edit ${project.name}`} title="Project settings">⚙</button> : <span>—</span>}</td></tr>)}</tbody></table></div>}
        </section>}

        {tab === "team" && <section className="panel team-panel">
          <div className="directory-filters team-filter-row"><label className="search-box directory-search"><span>⌕</span><input value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Search employee..." aria-label="Search employee" /></label><select value={teamDisciplineFilter} onChange={(event) => setTeamDisciplineFilter(event.target.value)} aria-label="فلترة الفريق حسب التخصص"><option value="all">كل التخصصات · All disciplines</option>{disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select><select value={teamRoleFilter} onChange={(event) => setTeamRoleFilter(event.target.value)} aria-label="فلترة الفريق حسب المسؤولية"><option value="all">كل المسؤوليات · All roles</option><option value="member">Member · موظف</option><option value="manager">Manager · مسؤول</option><option value="owner">Owner · مالك</option></select><button type="button" className="clear-filters-button" disabled={!teamSearch.trim() && teamDisciplineFilter === "all" && teamRoleFilter === "all"} onClick={() => { setTeamSearch(""); setTeamDisciplineFilter("all"); setTeamRoleFilter("all"); }} aria-label="Clear all team filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{filteredTeamRows.length} {filteredTeamRows.length === 1 ? "Employee" : "Employees"}</span><div className="view-switcher" role="group" aria-label="Team display style"><button type="button" className={teamView === "cards" ? "active" : ""} onClick={() => setTeamView("cards")} title="Cards view" aria-label="Cards view">▦</button><button type="button" className={teamView === "table" ? "active" : ""} onClick={() => setTeamView("table")} title="Table view" aria-label="Table view">☷</button></div></div>
          {filteredTeamRows.length === 0 ? <div className="empty-state"><strong>لا يوجد موظفون مطابقون</strong><p>غيّر البحث أو التخصص أو المسؤولية لعرض نتائج أخرى.</p></div> : teamView === "cards" ? <div className="team-grid">{filteredTeamRows.map((row) => <button className="team-card" key={row.email} onClick={() => openUser(row)}>
            <div className="team-card-head"><UserAvatar user={row} name={row.displayName} className="soft" /><div><strong>{row.displayName}</strong><span>{roleLabel(row.role)}</span></div>{row.temporary && <em className="temporary-badge">مؤقت</em>}</div>
            <div className={`discipline-badge${row.discipline ? "" : " unset"}`}>{row.discipline || "غير محدد · Not specified"}</div>
            <div className="team-metrics"><div><span>المهام</span><strong>{row.total}</strong></div><div><span>مكتمل</span><strong>{row.done}</strong></div><div><span>متابعة</span><strong className={row.attention ? "warn-text" : ""}>{row.attention}</strong></div><div><span>فعلي</span><strong>{row.actual.toFixed(1)}h</strong></div></div>
            <div className="employee-email">{row.temporary ? "سيتم ربط البريد عند النقل" : row.email}</div>
          </button>)}</div> : <div className="task-table-wrap directory-table-wrap"><table className="task-table directory-table"><thead><tr><th>Employee</th><th>Role</th><th>Discipline</th><th>Email</th><th>Tasks</th><th>Done</th><th>Attention</th><th>Actual</th></tr></thead><tbody>{filteredTeamRows.map((row) => <tr key={row.email} onClick={() => openUser(row)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openUser(row)}><td><div className="employee-cell"><UserAvatar user={row} name={row.displayName} /><strong>{row.displayName}</strong></div></td><td>{roleLabel(row.role)}</td><td>{row.discipline || "—"}</td><td dir="ltr">{row.temporary ? "Temporary account" : row.email}</td><td>{row.total}</td><td>{row.done}</td><td><strong className={row.attention ? "warn-text" : ""}>{row.attention}</strong></td><td>{row.actual.toFixed(1)}h</td></tr>)}</tbody></table></div>}
        </section>}

        {tab === "activity" && currentUser?.role === "owner" && <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>Activity Log</h2><p>سجل شامل للإنشاء والتعديل والحذف وجميع العمليات في التطبيق</p></div><button className="secondary-button activity-refresh" onClick={() => void openActivityLog()} disabled={activityLoading}><ButtonLabel en={activityLoading ? "Loading..." : "Refresh"} ar={activityLoading ? "جاري التحميل" : "تحديث"} /></button></div>
          {activityLoading ? <div className="loading-state"><div className="spinner" /><p>Loading activity...</p></div> : activity.length === 0 ? <div className="empty-state"><strong>No recorded activity</strong><p>لا توجد عمليات مسجلة حتى الآن.</p></div> : <div className="task-table-wrap"><table className="task-table activity-table"><thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Type</th><th>Item</th><th>Project</th><th>Details</th></tr></thead><tbody>{activity.map((entry) => <tr key={entry.id}><td dir="ltr">{formatDateTime(entry.createdAt)}</td><td><strong>{entry.actorName}</strong><small>{entry.actorEmail}</small></td><td><span className={`activity-action action-${entry.action}`}>{entry.action.replaceAll("_", " ")}</span></td><td>{({ task: "Task · مهمة", issue: "Issue · مشكلة", project: "Project · مشروع", user: "User · مستخدم", account: "Account · حساب", backup: "Backup · نسخة احتياطية", notification: "Notification · إشعار" } as Record<string, string>)[entry.entityType] || entry.entityType}</td><td>{entry.entityId && entry.action !== "deleted" && (entry.entityType === "task" || entry.entityType === "issue") ? <button className="activity-link" onClick={() => { if (entry.entityType === "task") void openLinkedTask(entry.entityId!); else { setTab("issues"); window.setTimeout(() => issuesModuleRef.current?.openIssue(entry.entityId!), 150); } }}>{entry.entityLabel}</button> : <strong>{entry.entityLabel}</strong>}</td><td><span className="project-code">{entry.projectCode || "—"}</span></td><td>{entry.details || "—"}</td></tr>)}</tbody></table></div>}
        </section>}

        {tab === "reports" && <div className="reports-workspace"><div className="report-type-selector" role="tablist" aria-label="Report type"><button className={reportType === "tasks" ? "active" : ""} onClick={() => setReportType("tasks")} aria-label="Open Task Report"><span className="report-type-icon" aria-hidden="true">✓</span><span>Task Report</span></button><button className={reportType === "issues" ? "active" : ""} onClick={() => setReportType("issues")} aria-label="Open Project Issues Report"><span className="report-type-icon" aria-hidden="true">!</span><span>Project Issues</span></button><button className={reportType === "rfi" ? "active" : ""} onClick={() => setReportType("rfi")} aria-label="Open RFI Report"><span className="report-type-icon" aria-hidden="true">?</span><span>RFI</span></button></div>
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

      {userRemovalWarning && <div className="drawer-layer dependency-warning-layer" role="dialog" aria-modal="true" aria-label="Employee assigned tasks warning"><button className="drawer-backdrop" onClick={() => setUserRemovalWarning(null)} aria-label="Close warning" /><section className="dependency-warning-dialog"><div className="dependency-warning-icon">!</div><h2>Employee has assigned tasks</h2><h3>لدى الموظف مهام موكلة إليه</h3><p><strong>{userRemovalWarning.employeeName}</strong> has {userRemovalWarning.taskCount} assigned task(s). Reassign these tasks before deleting the employee.</p><p dir="rtl">يجب تغيير الموظف المسؤول عن هذه المهام قبل حذف الموظف من النظام.</p><div className="dependency-project-links">{userRemovalWarning.projects.map((item) => <button key={item.project} onClick={() => reviewEmployeeTasks(userRemovalWarning.employeeName, item.project)}><span>↗</span><strong>Open {item.project} tasks</strong><small>{item.taskCount} tasks</small></button>)}</div><button className="secondary-button dependency-close" onClick={() => setUserRemovalWarning(null)}><ButtonLabel en="Cancel" ar="إلغاء" /></button></section></div>}
      {taskDrawerOpen && <TaskDrawer selectedId={selectedTaskId} form={taskForm} setOpen={setTaskDrawerOpen} saveTask={saveTask} deleteTask={deleteTask} saving={saving} currentUser={currentUser} users={users} projects={tab === "projects" && selectedProject ? [selectedProject] : projects} openProjectSettings={openProjectFromTask} updateForm={updateTaskForm} comments={comments.filter((comment) => comment.taskId === selectedTaskId)} commentDraft={commentDraft} setCommentDraft={setCommentDraft} addComment={addComment} updateComment={updateComment} deleteComment={deleteComment} savingComment={savingComment} task={tasks.find((task) => task.id === selectedTaskId) || null} timeEntries={timeEntries.filter((entry) => entry.taskId === selectedTaskId)} clock={clock} updateTimer={updateTimer} updateWorkSession={updateWorkSession} deleteWorkSession={deleteWorkSession} savingTimer={savingTimer} submitPrivateTask={submitPrivateTask} subtasks={subtasks.filter((subtask) => subtask.taskId === selectedTaskId)} draftSubtasks={draftSubtasks} deleteDraftSubtask={deleteDraftSubtask} subtaskDraft={subtaskDraft} setSubtaskDraft={setSubtaskDraft} addSubtask={addSubtask} toggleSubtask={toggleSubtask} deleteSubtask={deleteSubtask} subtaskBusy={subtaskBusy} attachments={taskAttachments.filter((attachment) => attachment.taskId === selectedTaskId)} draftAttachments={draftTaskAttachments} addDraftAttachments={addDraftTaskAttachments} deleteDraftAttachment={deleteDraftTaskAttachment} uploadAttachment={uploadTaskAttachment} deleteAttachment={deleteTaskAttachment} attachmentBusy={taskAttachmentBusy} attachmentProgress={taskAttachmentProgress} />}
      {projectDrawerOpen && <ProjectDrawer selectedId={selectedProjectId} form={projectForm} setForm={setProjectForm} setOpen={setProjectDrawerOpen} saveProject={saveProject} deleteProject={deleteProject} saving={saving} users={users} tasks={tasks} currentUser={currentUser} projectCode={projects.find((project) => project.id === selectedProjectId)?.code || projectForm.code} onResolveMemberTasks={reviewMemberProjectTasks} onEditUser={openUserFromProject} />}
      {userDrawerOpen && <UserDrawer selectedEmail={selectedUserEmail} form={userForm} setForm={setUserForm} setOpen={(open) => { setUserDrawerOpen(open); if (!open) setUserDrawerReturnToProject(false); }} saveUser={saveUser} deleteUser={deleteUser} saving={saving} currentUser={currentUser} projects={projects} />}
      {passwordDrawerOpen && <PasswordDrawer form={passwordForm} setForm={setPasswordForm} setOpen={setPasswordDrawerOpen} changePassword={changePassword} saving={saving} />}
      {confirmDialog}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

function ProjectOverviewDashboard(props: {
  loading: boolean;
  projects: ProjectOverviewRow[];
  tasks: Task[];
  issues: OverviewIssue[];
  timeEntries: TaskTimeEntry[];
  clock: number;
  isEmployee: boolean;
  openProject: (project: Project) => void;
  openTask: (task: Task) => void;
  openIssue: (id: number) => void;
  showProjects: () => void;
  showTasks: () => void;
  showIssues: () => void;
}) {
  const activeProjects = props.projects.filter((project) => project.status === "active");
  const completedProjects = props.projects.filter((project) => project.status === "completed").length;
  const onHoldProjects = props.projects.filter((project) => project.status === "on_hold").length;
  const openTasks = props.tasks.filter((task) => task.status !== "done");
  const pendingReview = props.tasks.filter((task) => task.managerCheck === "pending");
  const openIssues = props.issues.filter((issue) => issue.status !== "closed");
  const criticalIssues = openIssues.filter((issue) => issue.priority === "critical");
  const completion = props.tasks.length ? Math.round((props.tasks.filter((task) => task.status === "done").length / props.tasks.length) * 100) : 0;
  const plannedHours = props.tasks.reduce((sum, task) => sum + task.plannedHours, 0);
  const actualHours = props.tasks.reduce((sum, task) => sum + taskLoggedHours(task, props.timeEntries.filter((entry) => entry.taskId === task.id), props.clock), 0);
  const attentionTasks = [...props.tasks]
    .filter((task) => task.status !== "done" || task.managerCheck === "pending")
    .sort((a, b) => {
      const aRisk = taskFlag(a).key === "ok" ? 0 : 1;
      const bRisk = taskFlag(b).key === "ok" ? 0 : 1;
      return bRisk - aRisk || a.taskDate.localeCompare(b.taskDate) || b.id - a.id;
    }).slice(0, 6);
  const attentionIssues = [...openIssues].sort((a, b) => {
    const priority = { critical: 4, high: 3, medium: 2, low: 1 };
    return priority[b.priority] - priority[a.priority] || b.updatedAt.localeCompare(a.updatedAt);
  }).slice(0, 6);
  const visibleProjects = [...props.projects].sort((a, b) => {
    const statusOrder = { active: 0, on_hold: 1, completed: 2 };
    return statusOrder[a.status] - statusOrder[b.status] || b.openIssues - a.openIssues || a.code.localeCompare(b.code);
  }).slice(0, 6);

  if (props.loading) return <div className="loading-state overview-loading"><div className="spinner" /><p>Preparing project overview...</p></div>;

  return <section className="project-overview-dashboard" aria-label="Project portfolio dashboard">
    <div className="overview-kpis">
      {props.isEmployee
        ? <article className="overview-kpi kpi-projects employee-project-kpi"><span>Active Projects</span><strong>{activeProjects.length}</strong></article>
        : <button className="overview-kpi kpi-projects" onClick={props.showProjects}><span>Active Projects</span><strong>{activeProjects.length}</strong><small>{completedProjects} completed · {onHoldProjects} on hold · {props.projects.length} total</small><i>↗</i></button>}
      <button className="overview-kpi kpi-progress" onClick={props.showTasks}><span>Task Completion</span><strong>{completion}%</strong><small>{props.tasks.length - openTasks.length} of {props.tasks.length} complete</small><div className="overview-mini-progress"><i style={{ width: `${completion}%` }} /></div></button>
      <button className="overview-kpi kpi-tasks" onClick={props.showTasks}><span>Open Tasks</span><strong>{openTasks.length}</strong><small>{pendingReview.length} pending review</small><i>↗</i></button>
      <button className="overview-kpi kpi-issues" onClick={props.showIssues}><span>Open Issues</span><strong>{openIssues.length}</strong><small>{criticalIssues.length} critical</small><i>↗</i></button>
      <article className="overview-kpi kpi-hours"><span>Workload</span><strong>{actualHours.toFixed(1)}h</strong><small>{plannedHours.toFixed(1)}h planned</small><em>{plannedHours ? `${Math.round((actualHours / plannedHours) * 100)}% used` : "No hours planned"}</em></article>
    </div>

    <div className="overview-main-grid">
      <section className="panel overview-portfolio-panel">
        <div className="overview-panel-heading"><div><span>PORTFOLIO HEALTH</span><h2>Projects at a glance</h2></div><button onClick={props.showProjects}>View all projects →</button></div>
        {visibleProjects.length === 0 ? <div className="empty-state"><strong>No projects yet</strong><p>Add a project to start tracking delivery.</p></div> : <div className="overview-project-list">{visibleProjects.map((project) => <button key={project.id} onClick={() => props.openProject(project)}>
          <div className="overview-project-title"><span className="project-code">{project.code}</span><div><strong>{project.name}</strong><small>{project.client || "No client"}</small></div><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status].split(" · ")[0]}</span></div>
          <div className="overview-project-metrics"><span><strong>{project.progress}%</strong> complete</span><span><strong>{project.done}/{project.total}</strong> tasks</span><span className={project.openIssues ? "danger" : ""}><strong>{project.openIssues}</strong> open issues</span><span><strong>{project.memberEmails.length}</strong> team</span></div>
          <div className="overview-project-progress"><i style={{ width: `${project.progress}%` }} /></div>
        </button>)}</div>}
      </section>

      <aside className="overview-side-stack">
        <section className="panel overview-breakdown-panel">
          <div className="overview-panel-heading"><div><span>DELIVERY STATUS</span><h2>Task distribution</h2></div></div>
          <div className="overview-donut-row"><div className="overview-donut" style={{ background: `conic-gradient(#2f8063 0 ${completion}%, #ffd200 ${completion}% ${Math.min(100, completion + (pendingReview.length / Math.max(1, props.tasks.length)) * 100)}%, #ecece7 0)` }}><span><strong>{completion}%</strong><small>complete</small></span></div><div className="overview-legend"><span><i className="done" />Done <strong>{props.tasks.length - openTasks.length}</strong></span><span><i className="review" />Pending review <strong>{pendingReview.length}</strong></span><span><i className="open" />In progress <strong>{openTasks.filter((task) => task.managerCheck !== "pending").length}</strong></span></div></div>
        </section>
        <section className="panel overview-alert-panel">
          <div className="overview-panel-heading"><div><span>ATTENTION</span><h2>Current risk signals</h2></div></div>
          <div className="risk-signal-grid"><button onClick={props.showTasks}><strong>{props.tasks.filter((task) => taskFlag(task).key === "late").length}</strong><span>Late tasks</span></button><button onClick={props.showTasks}><strong>{props.tasks.filter((task) => task.status === "blocked").length}</strong><span>Blocked</span></button><button onClick={props.showIssues}><strong>{criticalIssues.length}</strong><span>Critical issues</span></button></div>
        </section>
      </aside>
    </div>

    <div className="overview-detail-grid">
      <section className="panel overview-queue-panel">
        <div className="overview-panel-heading"><div><span>TASK QUEUE</span><h2>Tasks needing attention</h2></div><button onClick={props.showTasks}>Open tasks →</button></div>
        {attentionTasks.length === 0 ? <div className="overview-empty-compact">All visible tasks are complete.</div> : <div className="overview-record-list">{attentionTasks.map((task) => { const flag = taskFlag(task); return <button key={task.id} onClick={() => props.openTask(task)}><span className={`overview-record-marker marker-${flag.key}`} /><div><strong>{task.title}</strong><small>{task.project} · {task.employeeName}</small></div><span className={`flag ${flag.key}`}>{flag.label.split(" · ")[0]}</span><time>{formatDueDate(task.taskDate)}</time></button>; })}</div>}
      </section>
      <section className="panel overview-queue-panel issue-queue">
        <div className="overview-panel-heading"><div><span>ISSUE QUEUE</span><h2>Issues needing attention</h2></div><button onClick={props.showIssues}>Open issues →</button></div>
        {attentionIssues.length === 0 ? <div className="overview-empty-compact">No open project issues.</div> : <div className="overview-record-list">{attentionIssues.map((issue) => <button key={issue.id} onClick={() => props.openIssue(issue.id)}><span className={`overview-record-marker issue-${issue.priority}`} /><div><strong>{issue.issueNumber}</strong><small>{issue.projectCode} · {issue.description}</small></div><span className={`issue-pill issue-priority-${issue.priority}`}>{issue.priority}</span><time>{formatDueDate(issue.issueDate)}</time></button>)}</div>}
      </section>
    </div>
  </section>;
}

type TaskTableProps = {
  loading: boolean; tasks: Task[]; filteredCount: number; tab: Tab; employees: { name: string; discipline: string }[]; users: User[]; projects: string[];
  lockedProjectCode?: string;
  search: string; employeeFilter: string; projectFilter: string; statusFilter: string; reviewFilter: string; dueDateFilter: string; disciplineFilter: string; showEmployeeFilter: boolean; showDisciplineColumn: boolean;
  setSearch: (value: string) => void; setEmployeeFilter: (value: string) => void; setProjectFilter: (value: string) => void; setStatusFilter: (value: string) => void; setReviewFilter: (value: string) => void; setDueDateFilter: (value: string) => void; setDisciplineFilter: (value: string) => void;
  openTask: (task: Task) => void; showAll: () => void;
  timeEntries: TaskTimeEntry[]; clock: number;
  commentCounts: Map<number, number>;
  subtasks: TaskSubtask[];
};

function TaskTable(props: TaskTableProps) {
  const filtersActive = Boolean(props.search.trim()) || props.employeeFilter !== "all" || (!props.lockedProjectCode && props.projectFilter !== "all") || props.statusFilter !== "all" || props.reviewFilter !== "all" || Boolean(props.dueDateFilter) || (props.showDisciplineColumn && props.disciplineFilter !== "all");
  const clearFilters = () => {
    props.setSearch("");
    props.setEmployeeFilter("all");
    if (!props.lockedProjectCode) props.setProjectFilter("all");
    props.setStatusFilter("all");
    props.setReviewFilter("all");
    props.setDueDateFilter("");
    props.setDisciplineFilter("all");
  };
  return <section className="panel">
    <div className="filters"><label className="search-box"><span>⌕</span><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder={props.lockedProjectCode ? "Search tasks in this project..." : "Search for a task or project..."} /></label>{props.showEmployeeFilter && <select value={props.employeeFilter} onChange={(event) => props.setEmployeeFilter(event.target.value)} aria-label="Filter by employee"><option value="all">All employees · كل الموظفين</option>{props.employees.map((employee) => <option key={employee.name} value={employee.name}>{employee.name} ({employee.discipline})</option>)}</select>}{props.showDisciplineColumn && <select value={props.disciplineFilter} onChange={(event) => props.setDisciplineFilter(event.target.value)} aria-label="Filter by discipline"><option value="all">All disciplines · كل التخصصات</option>{disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select>}{!props.lockedProjectCode && <select value={props.projectFilter} onChange={(event) => props.setProjectFilter(event.target.value)} aria-label="Filter by project"><option value="all">All projects · كل المشاريع</option>{props.projects.map((project) => <option key={project}>{project}</option>)}</select>}<select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="all">All employee statuses · كل حالات الموظف</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={props.reviewFilter} onChange={(event) => props.setReviewFilter(event.target.value)} aria-label="Filter by manager review"><option value="all">All manager reviews · كل مراجعات المسؤول</option>{Object.entries(checkLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="due-date-filter"><span>Due Date</span><input type="date" value={props.dueDateFilter} onChange={(event) => props.setDueDateFilter(event.target.value)} aria-label="Filter by due date" /></label><button type="button" className="clear-filters-button" onClick={clearFilters} disabled={!filtersActive} aria-label="Clear all task filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{props.filteredCount} {props.filteredCount === 1 ? "Task" : "Tasks"}</span></div>
    {props.loading ? <div className="loading-state"><div className="spinner" /><p>جاري تحميل المهام...</p></div> : props.tasks.length === 0 ? <div className="empty-state"><strong>لا توجد مهام مطابقة</strong><p>غيّر خيارات البحث أو أضف مهمة جديدة.</p></div> : <><div className="task-table-wrap"><table className={`task-table task-data-table task-table-ltr${props.showEmployeeFilter ? "" : " member-task-table"}`}><thead><tr><th>Task</th>{props.showEmployeeFilter && <th>Employee</th>}<th>Created By</th>{props.showDisciplineColumn && <th>Discipline</th>}<th>Created Date</th><th>Due Date</th><th>Priority</th><th>Hours</th><th>Status</th><th>Manager Review</th><th>Indicator</th></tr></thead><tbody>{props.tasks.map((task) => { const flag = taskFlag(task); const entries = props.timeEntries.filter((entry) => entry.taskId === task.id); const taskSubtasks = props.subtasks.filter((subtask) => subtask.taskId === task.id); const logged = taskLoggedHours(task, entries, props.clock); const active = entries.some((entry) => !entry.endedAt); const noteCount = props.commentCounts.get(task.id) || 0; const creator = props.users.find((user) => user.email === task.createdBy); const employee = props.users.find((user) => user.email === task.employeeEmail || user.displayName === task.employeeName); const creatorName = task.createdByName || creator?.displayName || "Unknown user"; return <tr key={task.id} onClick={() => props.openTask(task)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && props.openTask(task)}><td><div className="task-cell"><strong>{task.title}</strong><div className="task-tags">{task.visibility === "private" && <span className="private-badge">Private</span>}{taskSubtasks.length > 0 && <span className="subtask-indicator" title={`${taskSubtasks.filter((item) => item.completed).length}/${taskSubtasks.length} subtasks completed`} aria-label={`${taskSubtasks.length} subtasks`}>☑ <small>{taskSubtasks.length}</small></span>}{noteCount > 0 && <span className="note-indicator" title={`${noteCount} notes · ${noteCount} ملاحظات`} aria-label={`${noteCount} notes`}>▰ <small>{noteCount}</small></span>}</div><small>{task.expectedOutput}</small></div></td>{props.showEmployeeFilter && <td><div className="employee-cell"><UserAvatar user={employee} name={task.employeeName} /><strong>{task.employeeName}</strong></div></td>}<td><div className="employee-cell creator-person-cell" title={creatorName}><UserAvatar user={creator} name={creatorName} /><strong>{creatorName}</strong></div></td>{props.showDisciplineColumn && <td><span className="task-discipline">{task.employeeDiscipline || employee?.discipline || "—"}</span></td>}<td><span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span></td><td><span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></td><td><span className={`pill priority-${task.priority}`}>{priorityLabel[task.priority]}</span></td><td><strong className={active ? "live-hours" : ""}>{logged ? logged.toFixed(2) : "—"}{active && <i />}</strong><small className="hours-note"> / {task.plannedHours || "—"}h</small></td><td><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span></td><td><span className={`pill check-${task.managerCheck}`}>{checkLabel[task.managerCheck]}</span></td><td><span className={`flag flag-${flag.key}`}>{flag.label}</span></td></tr>; })}</tbody></table></div>
      <div className="mobile-task-list">{props.tasks.map((task) => { const flag = taskFlag(task); const entries = props.timeEntries.filter((entry) => entry.taskId === task.id); const taskSubtasks = props.subtasks.filter((subtask) => subtask.taskId === task.id); const logged = taskLoggedHours(task, entries, props.clock); const creatorName = task.createdByName || props.users.find((user) => user.email === task.createdBy)?.displayName || "Unknown user"; return <button className="mobile-task" key={task.id} onClick={() => props.openTask(task)}><div className="mobile-task-top"><div className="task-tags">{task.visibility === "private" && <span className="private-badge">خاص · Private</span>}{taskSubtasks.length > 0 && <span className="subtask-indicator">☑ <small>{taskSubtasks.length}</small></span>}</div><span className={`flag flag-${flag.key}`}>{flag.label}</span></div><strong>{task.title}</strong><small>{props.showEmployeeFilter ? `${task.employeeName} · ` : ""}<span className="mobile-date-label">Created by</span> {creatorName} · <span className="mobile-date-label">Created</span> <span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span> · <span className="mobile-date-label">Due</span> <span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></small><div className="mobile-task-bottom"><span className={`pill status-${task.status}`}>{statusLabel[task.status]}</span><span>{logged.toFixed(2)}/{task.plannedHours}h</span></div></button>; })}</div>
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
  openProjectSettings: (project: Project) => void;
  lockedProjectCode?: string;
  updateForm: <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => void;
  comments: TaskComment[];
  commentDraft: string;
  setCommentDraft: (value: string) => void;
  addComment: () => void;
  updateComment: (commentId: number, body: string) => Promise<boolean>;
  deleteComment: (comment: TaskComment) => void;
  savingComment: boolean;
  task: Task | null;
  timeEntries: TaskTimeEntry[];
  clock: number;
  updateTimer: (action: "start" | "pause" | "finish") => void;
  updateWorkSession: (entryId: number, startedAt: string, endedAt: string) => void;
  deleteWorkSession: (entryId: number) => void;
  savingTimer: boolean;
  submitPrivateTask: () => void;
  subtasks: TaskSubtask[];
  draftSubtasks: DraftSubtask[];
  deleteDraftSubtask: (id: string) => void;
  subtaskDraft: string;
  setSubtaskDraft: (value: string) => void;
  addSubtask: () => void;
  toggleSubtask: (subtask: TaskSubtask) => void;
  deleteSubtask: (subtask: TaskSubtask) => void;
  subtaskBusy: boolean;
  attachments: TaskAttachment[];
  draftAttachments: DraftTaskAttachment[];
  addDraftAttachments: (files: File[]) => void;
  deleteDraftAttachment: (id: string) => void;
  uploadAttachment: (file: File, subtaskId: number | null) => void;
  deleteAttachment: (attachment: TaskAttachment) => void;
  attachmentBusy: boolean;
  attachmentProgress: AttachmentUploadProgress | null;
};

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function WorkSessionRow({ entry, clock, editable, busy, onUpdate, onDelete }: { entry: TaskTimeEntry; clock: number; editable: boolean; busy: boolean; onUpdate: (entryId: number, startedAt: string, endedAt: string) => void; onDelete: (entryId: number) => void; }) {
  const [editing, setEditing] = useState(false);
  const [startedAt, setStartedAt] = useState(() => toLocalInput(entry.startedAt));
  const [endedAt, setEndedAt] = useState(() => toLocalInput(entry.endedAt));
  const save = () => {
    if (!startedAt || !endedAt) return;
    onUpdate(entry.id, new Date(startedAt).toISOString(), new Date(endedAt).toISOString());
    setEditing(false);
  };
  if (editing) return <article className="session-editor"><label><span>Start · البداية</span><input required type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label><span>End · النهاية</span><input required type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label><div className="session-editor-actions"><button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button><button type="button" className="session-save" onClick={save} disabled={busy || !startedAt || !endedAt || endedAt <= startedAt}>Save</button></div></article>;
  return <article className={entry.endedAt ? "" : "active"}><div><strong>{formatDateTime(entry.startedAt)}</strong><span>Start</span></div><b>→</b><div><strong>{entry.endedAt ? formatDateTime(entry.endedAt) : "Running now"}</strong><span>{formatDuration(entrySeconds(entry, clock))}</span></div>{editable && <div className="session-row-actions"><button type="button" onClick={() => { setStartedAt(toLocalInput(entry.startedAt)); setEndedAt(toLocalInput(entry.endedAt)); setEditing(true); }} disabled={busy} title="Edit work session">✎</button><button type="button" className="session-delete" onClick={() => onDelete(entry.id)} disabled={busy} title="Delete work session">×</button></div>}</article>;
}

function fileSizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type TaskOfficeKind = "word" | "excel" | "powerpoint";
function taskOfficeKind(attachment: TaskAttachment): TaskOfficeKind | null {
  const extension = attachment.fileName.split(".").pop()?.toLowerCase();
  if (extension === "docx" || attachment.contentType.includes("wordprocessingml")) return "word";
  if (["xlsx", "xls"].includes(extension || "") || attachment.contentType.includes("spreadsheet") || attachment.contentType.includes("ms-excel")) return "excel";
  if (extension === "pptx" || attachment.contentType.includes("presentationml")) return "powerpoint";
  return null;
}
function taskEscapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"); }
function taskOfficeDocument(title: string, body: string, wide = false) { return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#f4f4f1;color:#222;font:14px/1.55 Arial,sans-serif}main{${wide ? "max-width:1200px" : "max-width:860px"};margin:auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:26px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ddd;padding:7px}.slide{margin:0 0 22px;padding:24px;border:1px solid #ddd;border-left:5px solid #ffd200;border-radius:9px}.slide p{white-space:pre-wrap;font-size:17px}</style></head><body><main><h1>${taskEscapeHtml(title)}</h1>${body}</main></body></html>`; }

function TaskOfficePreview({ attachment }: { attachment: TaskAttachment }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void (async () => { try {
    const response = await fetch(`/api/task-attachments?id=${attachment.id}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    const buffer = await response.arrayBuffer();
    const kind = taskOfficeKind(attachment);
    if (kind === "word") { const mammoth = await import("mammoth/mammoth.browser"); const result = await mammoth.convertToHtml({ arrayBuffer: buffer }); if (active) setHtml(taskOfficeDocument(attachment.fileName, result.value || "<p>This document is empty.</p>")); }
    if (kind === "excel") { const XLSX = await import("xlsx"); const workbook = XLSX.read(buffer, { type: "array" }); const sheets = workbook.SheetNames.slice(0, 5).map((name) => `<section><h2>${taskEscapeHtml(name)}</h2>${XLSX.utils.sheet_to_html(workbook.Sheets[name])}</section>`).join(""); if (active) setHtml(taskOfficeDocument(attachment.fileName, sheets || "<p>This workbook is empty.</p>", true)); }
    if (kind === "powerpoint") { const JSZip = (await import("jszip")).default; const zip = await JSZip.loadAsync(buffer); const names = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0])); const slides = await Promise.all(names.map(async (name, index) => { const xml = await zip.files[name].async("string"); const text = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((match) => new DOMParser().parseFromString(`<!doctype html><body>${match[1]}`, "text/html").body.textContent || "").join("\n"); return `<article class="slide"><h2>SLIDE ${index + 1}</h2><p>${taskEscapeHtml(text || "No extractable text on this slide.")}</p></article>`; })); if (active) setHtml(taskOfficeDocument(attachment.fileName, slides.join("") || "<p>This presentation is empty.</p>", true)); }
  } catch { if (active) setError("This Office file could not be previewed."); } })(); return () => { active = false; }; }, [attachment]);
  if (error) return <div className="attachment-no-preview"><strong>{error}</strong><a href={`/api/task-attachments?id=${attachment.id}&download=1`} download>Download file</a></div>;
  if (!html) return <div className="office-preview-loading"><div className="spinner" /><strong>Preparing Office preview...</strong></div>;
  return <iframe className="office-preview-frame" sandbox="" srcDoc={html} title={`Office preview: ${attachment.fileName}`} />;
}

function TaskAttachmentTable({ attachments, onUpload, onDelete, busy, compact = false, progress = null, readOnly = false }: { attachments: TaskAttachment[]; onUpload: (file: File) => void; onDelete: (attachment: TaskAttachment) => void; busy: boolean; compact?: boolean; progress?: AttachmentUploadProgress | null; readOnly?: boolean }) {
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const canPreview = (attachment: TaskAttachment) => attachment.contentType.startsWith("image/") || attachment.contentType === "application/pdf" || Boolean(taskOfficeKind(attachment));
  return <>
    {!readOnly && <div className={`task-attachment-toolbar${compact ? " compact" : ""}`}>
      <label className="task-attachment-add" title="Add attachment"><span>＋</span>{!compact && <strong>Add Attachment</strong>}<input type="file" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} /></label>
      {!compact && <small>Optional · maximum 25 MB per file</small>}
    </div>}
    {progress && <div className={`attachment-upload-progress${compact ? " compact" : ""}`} role="status" aria-live="polite"><div><strong>{compact ? "Uploading" : progress.fileName}</strong><span>{progress.percent}%</span></div><progress max="100" value={progress.percent} /></div>}
    {compact && attachments.length > 0 && <div className="subtask-attachment-list">{attachments.map((attachment) => <div key={attachment.id}><button type="button" className="subtask-attachment-open" onClick={() => canPreview(attachment) ? setPreview(attachment) : window.open(`/api/task-attachments?id=${attachment.id}&download=1`, "_blank")} title={attachment.fileName}>📎 <span>{attachment.fileName}</span></button>{!readOnly && <button type="button" className="subtask-attachment-remove" onClick={() => onDelete(attachment)} disabled={busy} title="Delete attachment" aria-label={`Delete ${attachment.fileName}`}>×</button>}</div>)}</div>}
    {!compact && attachments.length > 0 && <div className="attachment-table-wrap task-attachments-table-wrap"><table className="attachment-table task-attachments-table"><thead><tr><th>File</th><th>Size</th><th>Uploaded</th>{!readOnly && <th />}</tr></thead><tbody>{attachments.map((attachment) => <tr key={attachment.id} className="clickable-attachment" onClick={() => canPreview(attachment) ? setPreview(attachment) : window.open(`/api/task-attachments?id=${attachment.id}&download=1`, "_blank")}><td><strong>{attachment.fileName}</strong></td><td>{fileSizeLabel(attachment.sizeBytes)}</td><td>{formatCreatedDate(attachment.createdAt)}</td>{!readOnly && <td onClick={(event) => event.stopPropagation()}><button type="button" className="attachment-delete" onClick={() => onDelete(attachment)} disabled={busy} title="Delete attachment" aria-label={`Delete ${attachment.fileName}`}>×</button></td>}</tr>)}</tbody></table></div>}
    {preview && <div className="attachment-preview-layer" role="dialog" aria-modal="true" aria-label={`Preview ${preview.fileName}`}><button type="button" className="attachment-preview-backdrop" onClick={() => setPreview(null)} aria-label="Close preview" /><section className="attachment-preview-dialog"><header><div><strong>{preview.fileName}</strong><span>{fileSizeLabel(preview.sizeBytes)}</span></div><div><a href={`/api/task-attachments?id=${preview.id}&download=1`} download>Download</a><button type="button" onClick={() => setPreview(null)} aria-label="Close preview">×</button></div></header><div className="attachment-preview-content">{preview.contentType.startsWith("image/") ? <img src={`/api/task-attachments?id=${preview.id}`} alt={preview.fileName} /> : preview.contentType === "application/pdf" ? <iframe src={`/api/task-attachments?id=${preview.id}`} title={preview.fileName} /> : <TaskOfficePreview attachment={preview} />}</div></section></div>}
  </>;
}

function TaskDrawer({ selectedId, form, setOpen, saveTask, deleteTask, saving, currentUser, users, projects, lockedProjectCode = "", openProjectSettings, updateForm, comments, commentDraft, setCommentDraft, addComment, updateComment, deleteComment, savingComment, task, timeEntries, clock, updateTimer, updateWorkSession, deleteWorkSession, savingTimer, submitPrivateTask, subtasks, draftSubtasks, deleteDraftSubtask, subtaskDraft, setSubtaskDraft, addSubtask, toggleSubtask, deleteSubtask, subtaskBusy, attachments, draftAttachments, addDraftAttachments, deleteDraftAttachment, uploadAttachment, deleteAttachment, attachmentBusy, attachmentProgress }: TaskDrawerProps) {
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const selectedProject = projects.find((project) => project.code === form.project);
  const canOpenProjectSettings = Boolean(selectedProject && currentUser && (currentUser.role === "owner" || currentUser.role === "manager"));
  const managerCreatorReadOnly = Boolean(currentUser?.role === "manager" && task && task.createdBy !== currentUser.email);
  const privateOwner = currentUser?.role === "member" && form.visibility === "private" && (!task || (task.createdBy === currentUser.email && !task.submittedToManager));
  const memberOwnPrivate = currentUser?.role === "member" && task?.visibility === "private" && task.createdBy === currentUser.email && task.employeeEmail === currentUser.email;
  const management = isManagement(currentUser) && !managerCreatorReadOnly;
  const canAuditSessions = management && Boolean(task && (task.managerCheck !== "new" || task.submittedToManager));
  const canEditDetails = management || privateOwner;
  const canCollaborate = canEditDetails || Boolean(task && currentUser && task.employeeEmail === currentUser.email);
  const privateFinishOnly = currentUser?.role === "member" && task?.visibility === "private" && !task.submittedToManager;
  const openSubtaskCount = subtasks.filter((subtask) => !subtask.completed).length;
  const activeEntry = timeEntries.find((entry) => !entry.endedAt);
  const loggedSeconds = timeEntries.length
    ? timeEntries.reduce((sum, entry) => sum + entrySeconds(entry, clock), 0)
    : Math.round((task?.actualHours || form.actualHours || 0) * 3600);
  const projectOptions = Array.from(new Set([...projects.filter((project) => project.status === "active" || project.code === form.project).map((project) => project.code), ...(!lockedProjectCode && form.visibility === "private" ? ["PERSONAL"] : [])]));
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
        <div className="form-section"><h3>Task Information <span>معلومات المهمة</span></h3><label className="wide"><span>Task · اسم المهمة</span><input required disabled={!canEditDetails} value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="مثال: تدقيق موديل المنطقة 02" /></label><label className="wide"><span>Expected Output · المخرج المتوقع</span><textarea disabled={!canEditDetails} value={form.expectedOutput} onChange={(event) => updateForm("expectedOutput", event.target.value)} rows={3} placeholder="ما المطلوب تسليمه عند اكتمال المهمة؟" /></label><div className="form-grid"><label><span className="task-project-label"><span>Project · المشروع</span>{canOpenProjectSettings && selectedProject && <button type="button" className="task-project-settings" onClick={() => openProjectSettings(selectedProject)} aria-label="Project settings" title="Project settings">⚙</button>}</span><select required disabled={!canEditDetails} value={form.project} onChange={(event) => { const code = event.target.value; updateForm("project", code); const project = projects.find((item) => item.code === code); if (management && !project?.memberEmails.includes(form.employeeEmail)) { updateForm("employeeEmail", ""); updateForm("employeeName", ""); } }}><option value="">اختر المشروع</option>{projectOptions.map((project) => <option key={project}>{project}</option>)}</select></label><label><span>Due Date · تاريخ الإنجاز المتوقع</span><input type="date" lang="en-GB" disabled={!canEditDetails} value={form.taskDate} onChange={(event) => updateForm("taskDate", event.target.value)} /></label><label><span>Priority · الأولوية</span><select disabled={!canEditDetails} value={form.priority} onChange={(event) => updateForm("priority", event.target.value as Task["priority"])}>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Status · الحالة</span><select disabled value={form.status}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div></div>
        <div className="form-section assignment-time-section"><h3>Assignment & Time</h3><div className={`assignment-time-grid ${management ? "management" : "member"}`}>{management && <label className="assignment-employee"><span>Employee</span><select required value={form.employeeEmail} onChange={(event) => { const user = users.find((item) => item.email === event.target.value); updateForm("employeeEmail", event.target.value); if (user) updateForm("employeeName", user.displayName); }}><option value="">{form.project ? "Select a project employee" : "Select a project first"}</option>{assignmentOptions.map((user) => <option key={user.email} value={user.email}>{user.displayName}{user.discipline ? ` · ${user.discipline}` : ""}</option>)}</select></label>}<label><span>Planned Hours</span><input type="number" disabled={!canEditDetails} min="0" step="0.25" value={form.plannedHours} onChange={(event) => updateForm("plannedHours", Number(event.target.value))} /></label><label><span>Logged Hours</span><input disabled value={formatDuration(loggedSeconds)} /></label></div></div>
        <div className="form-section task-attachments-section"><div className="comments-heading"><h3>Task Attachments <span>مرفقات المهمة</span></h3><span>{selectedId ? attachments.filter((attachment) => attachment.subtaskId === null).length : draftAttachments.length}/10</span></div>{selectedId ? <TaskAttachmentTable attachments={attachments.filter((attachment) => attachment.subtaskId === null)} onUpload={(file) => uploadAttachment(file, null)} onDelete={deleteAttachment} busy={attachmentBusy} progress={attachmentProgress?.subtaskId === null ? attachmentProgress : null} readOnly={!canCollaborate} /> : <><label className="task-attachment-add draft-task-attachment-add"><span>＋</span><strong>Add Attachments</strong><input type="file" multiple disabled={saving || draftAttachments.length >= 10} onChange={(event) => { addDraftAttachments(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /></label><small>Optional · maximum 10 files and 25 MB per file</small>{draftAttachments.length > 0 && <div className="pending-files">{draftAttachments.map(({ id, file }) => <span key={id}>{file.name} <small>{fileSizeLabel(file.size)}</small><button type="button" onClick={() => deleteDraftAttachment(id)} aria-label={`Remove ${file.name}`}>×</button></span>)}</div>}</>}</div>
        <div className="form-section subtasks-section"><div className="comments-heading"><h3>Subtasks <span>المهام الفرعية</span></h3><span>{selectedId ? `${subtasks.filter((subtask) => subtask.completed).length}/${subtasks.length}` : draftSubtasks.length}</span></div>{canCollaborate && <div className="subtask-composer"><input maxLength={240} value={subtaskDraft} onChange={(event) => setSubtaskDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSubtask(); } }} placeholder="Add an optional subtask..." /><button type="button" onClick={addSubtask} disabled={subtaskBusy || !subtaskDraft.trim()} title="Add subtask" aria-label="Add subtask">＋</button></div>}{selectedId ? (subtasks.length === 0 ? <div className="comments-empty">No subtasks · لا توجد مهام فرعية</div> : <div className="subtask-table-wrap"><table className="subtask-table"><thead><tr><th>#</th><th>Done</th><th>Subtask</th><th>Attachments</th>{canCollaborate && <th />}</tr></thead><tbody>{subtasks.map((subtask, index) => { const rowAttachments = attachments.filter((attachment) => attachment.subtaskId === subtask.id); return <tr key={subtask.id} className={subtask.completed ? "completed" : ""}><td className="subtask-number">{index + 1}</td><td><input type="checkbox" checked={subtask.completed} onChange={() => toggleSubtask(subtask)} disabled={subtaskBusy || !canCollaborate} aria-label={`Mark ${subtask.title} ${subtask.completed ? "open" : "complete"}`} /></td><td><strong>{subtask.title}</strong>{subtask.completed && <small>Closed {subtask.completedAt ? formatDateTime(subtask.completedAt) : ""}</small>}</td><td><TaskAttachmentTable compact attachments={rowAttachments} onUpload={(file) => uploadAttachment(file, subtask.id)} onDelete={deleteAttachment} busy={attachmentBusy} progress={attachmentProgress?.subtaskId === subtask.id ? attachmentProgress : null} readOnly={!canCollaborate} /></td>{canCollaborate && <td><button type="button" className="subtask-delete" onClick={() => deleteSubtask(subtask)} disabled={subtaskBusy} title="Delete subtask" aria-label={`Delete ${subtask.title}`}>×</button></td>}</tr>; })}</tbody></table></div>) : (draftSubtasks.length === 0 ? <div className="comments-empty">Add subtasks now; they will be saved with the new task.</div> : <div className="subtask-table-wrap"><table className="subtask-table draft-subtask-table"><thead><tr><th>#</th><th>Subtask</th><th>Attachments</th><th /></tr></thead><tbody>{draftSubtasks.map((subtask, index) => <tr key={subtask.id}><td className="subtask-number">{index + 1}</td><td><strong>{subtask.title}</strong></td><td><small className="save-first-note">Available after saving</small></td><td><button type="button" className="subtask-delete" onClick={() => deleteDraftSubtask(subtask.id)} title="Delete subtask" aria-label={`Delete ${subtask.title}`}>×</button></td></tr>)}</tbody></table></div>)}</div>
        {selectedId && currentUser?.role !== "owner" && task?.employeeEmail === currentUser.email && <div className="form-section timer-section"><div className="timer-head"><div><h3>Work Timer <span>تسجيل وقت العمل</span></h3><p>يمكنك إيقاف المهمة للبريك أو عند الانتقال لمهمة أخرى، ثم استئنافها في أي يوم لاحق.</p></div><strong className={activeEntry ? "running" : ""} dir="ltr">{formatDuration(loggedSeconds)}</strong></div><div className="timer-actions">{activeEntry ? <button type="button" className="pause-task-button" onClick={() => updateTimer("pause")} disabled={savingTimer}><ButtonLabel en="Ⅱ Pause" ar="إيقاف مؤقت" /></button> : <button type="button" className="start-task-button" onClick={() => updateTimer("start")} disabled={savingTimer || task.managerCheck === "approved"}><ButtonLabel en="▶ Start / Resume" ar="ابدأ / استأنف" /></button>}{task.status !== "done" && <button type="button" className="finish-task-button" onClick={() => updateTimer("finish")} disabled={savingTimer || openSubtaskCount > 0} title={openSubtaskCount ? `Complete ${openSubtaskCount} open subtasks first` : privateFinishOnly ? "Finish private task" : "Finish and submit task"}><ButtonLabel en={privateFinishOnly ? "✓ Finish" : "✓ Finish & Submit"} ar={privateFinishOnly ? "إنهاء المهمة" : "إنهاء وإرسال للمراجعة"} /></button>}</div>{openSubtaskCount > 0 && <div className="subtask-submit-lock">{privateFinishOnly ? "Complete all subtasks before finishing the main task" : "Complete all subtasks before submitting the main task"} · يجب إغلاق جميع المهام الفرعية أولًا ({openSubtaskCount})</div>}{task.managerCheck === "approved" && <div className="timer-lock-note">المهمة معتمدة. يجب على المسؤول إعادة فتح المراجعة قبل استئناف العمل.</div>}</div>}
        {selectedId && timeEntries.length > 0 && <div className="form-section time-history"><div className="comments-heading"><h3>Work Sessions <span>سجل جلسات العمل</span></h3><span>{timeEntries.length}</span></div>{canAuditSessions && <div className="session-audit-note">Management review mode · يمكن للمالك والمسؤول تدقيق الوقت وتعديله أو حذف الجلسة</div>}<div className="time-entry-list">{[...timeEntries].reverse().map((entry) => <WorkSessionRow key={entry.id} entry={entry} clock={clock} editable={canAuditSessions && Boolean(entry.endedAt)} busy={savingTimer} onUpdate={updateWorkSession} onDelete={deleteWorkSession} />)}</div></div>}
        {selectedId && currentUser?.role === "member" && task?.visibility === "private" && task.createdBy === currentUser.email && <div className="form-section private-share-section"><h3>Private Task Sharing <span>مشاركة المهمة</span></h3>{task.submittedToManager ? <div className="private-shared-note">تمت مشاركة المهمة مع المسؤول، ويمكنه الآن رؤيتها أو تفويضها لموظف آخر. ستحتاج إلى إغلاق جميع المهام الفرعية قبل إرسال المهمة للموافقة.</div> : <><p>يمكنك مشاركة المهمة مع المسؤول الآن حتى عند وجود مهام فرعية مفتوحة. لن تُرسل للموافقة إلا بعد إغلاقها جميعًا.</p><button type="button" className="share-task-button" onClick={submitPrivateTask} disabled={saving} title="Share private task with manager"><ButtonLabel en="Share with Manager" ar="مشاركة مع المسؤول" /></button></>}</div>}
        {management && <div className="form-section manager-section"><h3>Manager Review <span>مراجعة المسؤول</span></h3><div className="review-choice">{(["new", "pending", "approved", "returned"] as const).map((value) => <button type="button" key={value} className={form.managerCheck === value ? `selected ${value}` : value} onClick={() => updateForm("managerCheck", value)}>{checkLabel[value]}</button>)}</div></div>}
        <div className="form-section comments-section">
          <div className="comments-heading"><h3>Activity Notes <span>سجل الملاحظات</span></h3><span>{comments.length}</span></div>
          {selectedId && (comments.length === 0 ? <div className="comments-empty">لا توجد ملاحظات حتى الآن · No notes yet</div> : <div className="comment-list">{comments.map((comment) => {
            const author = users.find((user) => user.email === comment.authorEmail);
            const editable = canEditComment(comment, currentUser, clock);
            const editing = editingCommentId === comment.id;
            return <article className="comment-entry" key={comment.id}>
              <UserAvatar user={author} name={comment.authorName} className="comment-avatar" />
              <div className="comment-content"><div className="comment-meta"><strong>{comment.authorName}</strong><span className="comment-role">{author?.role === "owner" ? "Owner" : author?.role === "manager" ? "Manager" : author?.discipline || "Team member"}</span><time dir="ltr">{formatDateTime(comment.createdAt)}</time>{editable && !editing && <button type="button" className="comment-edit-button" onClick={() => { setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }} aria-label="Edit note" title="Edit note (available for 15 minutes)">✎</button>}{currentUser?.role === "owner" && !editing && <button type="button" className="comment-delete-button" onClick={() => deleteComment(comment)} disabled={savingComment} aria-label="Delete note" title="Owner: delete note">×</button>}</div>{editing ? <div className="comment-editor"><textarea maxLength={2000} rows={3} value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} /><div><button type="button" onClick={() => setEditingCommentId(null)} disabled={savingComment}>Cancel</button><button type="button" className="comment-edit-save" disabled={savingComment || !editingCommentBody.trim()} onClick={async () => { if (await updateComment(comment.id, editingCommentBody)) setEditingCommentId(null); }}>Save</button></div></div> : <p>{comment.body}</p>}</div>
            </article>;
          })}</div>)}
          {canCollaborate && <div className="comment-composer"><label className="wide"><span>{selectedId ? "Add a note · أضف ملاحظة" : "Initial note (optional) · ملاحظة أولية (اختيارية)"}</span><textarea maxLength={2000} rows={3} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="اكتب تحديثًا أو ملاحظة مرتبطة بهذه المهمة..." /></label><div><small>{commentDraft.length}/2000</small>{selectedId && <button type="button" className="comment-button" onClick={addComment} disabled={savingComment || !commentDraft.trim()}><ButtonLabel en={savingComment ? "Posting..." : "Post note"} ar={savingComment ? "جاري الإضافة..." : "إضافة الملاحظة"} /></button>}</div></div>}
        </div>
        <div className="drawer-actions">{selectedId && (management || memberOwnPrivate) && <button type="button" className="delete-button" onClick={deleteTask} disabled={saving}><ButtonLabel en="Delete Task" ar="حذف المهمة" /></button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Close" ar="إغلاق" /></button>{canEditDetails && <button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selectedId ? "Save Changes" : "Create Task"} ar={saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إنشاء مهمة"} /></button>}</div>
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
  onEditUser: (user: User) => void;
  currentUser: User | null;
};

function ProjectDrawer({ selectedId, form, setForm, setOpen, saveProject, deleteProject, saving, users, tasks, projectCode, onResolveMemberTasks, onEditUser, currentUser }: ProjectDrawerProps) {
  const [removalWarning, setRemovalWarning] = useState<{ user: User; taskCount: number } | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const owner = currentUser?.role === "owner";
  const manager = currentUser?.role === "manager";
  const canEditTeam = owner || manager;
  const teamMembers = users.filter((user) => (user.role === "member" || user.role === "manager") && (owner || (manager && user.discipline === currentUser?.discipline) || (!canEditTeam && form.memberEmails.includes(user.email))));
  const availableDisciplines = disciplines.filter((discipline) => teamMembers.some((user) => user.discipline === discipline));
  const memberSearchTerm = memberSearch.trim().toLowerCase();
  const filteredTeamMembers = teamMembers.filter((user) =>
    (disciplineFilter === "all" || user.discipline === disciplineFilter) &&
    (!memberSearchTerm || `${user.displayName} ${user.email} ${user.discipline}`.toLowerCase().includes(memberSearchTerm))
  );

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
      projectManagerEmails: isRemoving
        ? form.projectManagerEmails.filter((item) => item !== user.email)
        : form.projectManagerEmails,
    });
  };

  const toggleProjectManager = (email: string) => {
    if (!canEditTeam || !form.memberEmails.includes(email)) return;
    setForm({
      ...form,
      projectManagerEmails: form.projectManagerEmails.includes(email)
        ? form.projectManagerEmails.filter((item) => item !== email)
        : [...form.projectManagerEmails, email],
    });
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات المشروع">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" />
    <aside className="task-drawer compact-drawer">
      <div className="drawer-head"><div><p>PROJECT</p><h2 className="drawer-record-title">{selectedId ? <><span>{form.name}</span> Edit</> : "Add new project"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div>
      <form onSubmit={saveProject} className="task-form">
        <div className="form-section"><h3>Project Information <span>معلومات المشروع</span></h3><div className="form-grid"><label><span>Code · كود المشروع</span><input required disabled={!owner} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="مثال: DH2" /></label><label><span>Status · الحالة</span><select disabled={!owner} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Project["status"] })}>{Object.entries(projectStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="wide"><span>Project Name · اسم المشروع</span><input required disabled={!owner} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="اسم المشروع الكامل" /></label><label className="wide"><span>Client · العميل</span><input disabled={!owner} value={form.client} onChange={(event) => setForm({ ...form, client: event.target.value })} placeholder="اسم العميل" /></label><div className="form-grid"><label><span>Start Date · تاريخ البداية</span><input type="date" disabled={!owner} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label><span>Target Date · التسليم المستهدف</span><input type="date" disabled={!owner} value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label></div></div>
        <div className="form-section"><div className="comments-heading project-team-heading"><h3>Project Team <span>فريق المشروع</span></h3><div className="project-team-controls"><label className="search-box project-team-search"><span>⌕</span><input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search employee..." aria-label="Search project employees" /></label><select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)} aria-label="Filter project team by discipline"><option value="all">All disciplines · كل التخصصات</option>{availableDisciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select><span aria-label={`${form.memberEmails.length} selected project members`}>{form.memberEmails.length}</span></div></div>{teamMembers.length === 0 ? <div className="comments-empty">أضف الموظفين أولاً من بوابة الفريق.</div> : filteredTeamMembers.length === 0 ? <div className="comments-empty">No matching employees · لا يوجد موظفون مطابقون</div> : <div className="member-picker">{filteredTeamMembers.map((user) => { const selected = form.memberEmails.includes(user.email); const projectManager = form.projectManagerEmails.includes(user.email); return <div key={user.email} className={`member-picker-row${selected ? " selected" : ""}${projectManager ? " project-manager" : ""}`}><label className="member-select"><input type="checkbox" disabled={!canEditTeam} checked={selected} onChange={() => toggleMember(user)} /><UserAvatar user={user} name={user.displayName} /><span><strong>{user.displayName} <em className="member-role">({roleLabel(user.role)})</em></strong><small>{user.discipline || "Team member"}</small></span></label>{(owner || (manager && user.role === "member" && user.discipline === currentUser?.discipline)) && <button type="button" className="project-member-settings" onClick={() => onEditUser(user)} aria-label={`Edit ${user.displayName}`} title="Edit employee">⚙</button>}<label className="project-manager-toggle" title={selected ? "Grant full project visibility" : "Select the employee first"}><input type="checkbox" disabled={!canEditTeam || !selected} checked={projectManager} onChange={() => toggleProjectManager(user.email)} /><span>Project Manager</span></label></div>; })}</div>}
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
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="بيانات الموظف"><button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" /><aside className="task-drawer compact-drawer"><div className="drawer-head"><div><p>TEAM MEMBER</p><h2 className="drawer-record-title">{selectedEmail ? <><span>{form.displayName}</span> Edit</> : "New Team"}</h2></div><button className="close-button" onClick={() => setOpen(false)}>×</button></div><form onSubmit={saveUser} className="task-form"><div className="form-section"><h3>بيانات الموظف <span>Employee Information</span></h3><label className="wide"><span>الاسم · Name</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="اسم الموظف" /></label><label className="wide"><span>التخصص · Discipline</span><select required disabled={managerLimited} value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value as Discipline })}><option value="" disabled>اختر التخصص</option>{disciplineOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="wide"><span>Email · البريد</span><input required type="email" disabled={Boolean(selectedEmail)} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@eng-bim.com" /></label><label className="wide"><span>{selectedEmail ? "كلمة مرور جديدة · New Password" : "كلمة مرور مؤقتة · Temporary Password"}</span><input required={!selectedEmail} minLength={10} type="password" value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} placeholder={selectedEmail ? "اتركها فارغة دون تغيير" : "10 أحرف على الأقل"} autoComplete="new-password" /></label><label className="wide"><span>الصلاحية داخل النظام · Role</span><select disabled={managerLimited} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as User["role"] })}><option value="member">Member · موظف</option>{!managerLimited && <option value="manager">Manager · مسؤول</option>}{currentUser?.role === "owner" && <option value="owner">Owner · المالك</option>}</select></label>{managerLimited && <div className="temporary-note">يمكنك إضافة وإدارة موظفين من تخصصك فقط: {currentUser?.discipline || "غير محدد"}.</div>}{form.role === "owner" && <div className="owner-warning">المالك لديه أعلى صلاحيات النظام، بما فيها إضافة ملاك آخرين واستعادة النسخ الاحتياطية.</div>}<div className="temporary-note">أرسل للمستخدم كلمة المرور المؤقتة بطريقة آمنة. يستطيع تغييرها من حسابه بعد تسجيل الدخول.</div></div>{selectedEmail && <div className="form-section user-projects-section"><div className="comments-heading"><h3>Assigned Projects <span>المشاريع المدرج عليها الموظف</span></h3><span>{assignedProjects.length}</span></div>{assignedProjects.length ? <div className="assigned-project-list">{assignedProjects.map((project) => <div key={project.id}><strong>{project.code}</strong><span>{project.name}</span></div>)}</div> : <div className="comments-empty">No assigned projects · غير مدرج على أي مشروع</div>}</div>}<div className="drawer-actions">{selectedEmail && selectedEmail !== currentUser?.email && <button type="button" className="delete-button" onClick={deleteUser} disabled={saving}><ButtonLabel en="Delete Employee" ar="حذف الموظف" /></button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Cancel" ar="إلغاء" /></button><button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selectedEmail ? "Save Changes" : "Add Employee"} ar={saving ? "جاري الحفظ..." : selectedEmail ? "حفظ التعديلات" : "إضافة المستخدم"} /></button></div></form></aside></div>;
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
