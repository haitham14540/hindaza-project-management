/* eslint-disable @next/next/no-img-element */
"use client";

import { CSSProperties, ChangeEvent, ClipboardEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IssueReportPanel, IssuesModule, type IssuesModuleHandle } from "./issues-module";
import { useAppConfirm } from "./confirm-dialog";
import PasswordInput from "./password-input";

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
  commentCount?: number;
  subtaskCount?: number;
  completedSubtaskCount?: number;
  attachmentCount?: number;
  completionPercent: number;
  completionBeforeReview: number;
  status: "not_started" | "in_progress" | "paused" | "blocked" | "needs_revision" | "done";
  managerCheck: "new" | "pending" | "approved" | "returned";
  managerNote: string;
  visibility: "team" | "private";
  submittedToManager: boolean;
  originatedByEmail: string;
  originatedByName: string;
  acceptedByEmail: string;
  acceptedByName: string;
  workCycle: number;
  createdBy: string;
  createdByName: string;
  createdByProfileImageKey: string;
  createdAt: string;
  updatedAt: string;
};

type TaskTimeEntry = {
  id: number;
  taskId: number;
  employeeEmail: string;
  employeeName: string;
  startedAt: string;
  resumedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  workCycle: number;
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

type TaskIssueLink = {
  id: number;
  issueNumber: string;
  projectCode: string;
  convertedTaskId: number;
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
  type: "task_assigned" | "review_updated" | "private_task_submitted" | "task_ready_for_review" | "subtask_completed" | "task_note_added" | "issue_created" | "issue_updated" | "issue_note_added" | "project_member_added";
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

type TaskForm = Omit<Task, "id" | "createdByName" | "createdByProfileImageKey" | "employeeDiscipline" | "createdAt" | "updatedAt" | "managerNote" | "submittedToManager" | "originatedByEmail" | "originatedByName" | "acceptedByEmail" | "acceptedByName" | "workCycle" | "completionBeforeReview">;
type ProjectForm = Omit<Project, "id" | "createdAt">;
type UserForm = Pick<User, "email" | "displayName" | "role" | "discipline"> & { temporaryPassword: string };
type Tab = "overview" | "tasks" | "rfi" | "issues" | "projects" | "team" | "reports" | "activity";
type DirectoryView = "cards" | "table";
type ProjectWorkspaceTab = "tasks" | "issues" | "rfi";
type ReportMetric = "all" | "approved" | "wip" | "pending";

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
  comments?: TaskComment[];
  timeEntries?: TaskTimeEntry[];
  timeEntriesMode?: "active" | "full";
  subtasks?: TaskSubtask[];
  taskAttachments?: TaskAttachment[];
  taskIssueLinks?: TaskIssueLink[];
  notifications: Notification[];
};

type TaskDetailsData = {
  comments: TaskComment[];
  timeEntries: TaskTimeEntry[];
  subtasks: TaskSubtask[];
  taskAttachments: TaskAttachment[];
  taskIssueLinks: TaskIssueLink[];
};

const tabValues: Tab[] = ["overview", "tasks", "rfi", "issues", "projects", "team", "reports", "activity"];
const activeTabStorageKey = "hindaza-project-management-active-tab";

function tabFromLocation(): Tab {
  if (typeof window === "undefined") return "overview";
  const value = new URL(window.location.href).searchParams.get("view");
  return tabValues.includes(value as Tab) ? value as Tab : "overview";
}

async function fetchWorkspaceData(timeoutMs = 15_000): Promise<WorkspaceData | null> {
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

async function fetchTaskDetails(taskId: number, timeoutMs = 12_000): Promise<TaskDetailsData | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/task-details?taskId=${taskId}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    if (response.status === 401) {
      window.location.replace("/login");
      return null;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load task details.");
    return data as TaskDetailsData;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Task details took too long to load. Please try again.");
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

const tableStatusLabel: Record<Task["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  paused: "Paused",
  blocked: "Blocked",
  needs_revision: "Revision",
  done: "Done",
};

const tablePriorityLabel: Record<Task["priority"], string> = { high: "High", medium: "Medium", low: "Low" };
const tableCheckLabel: Record<Task["managerCheck"], string> = { new: "New/WIP", pending: "Pending", approved: "Approved", returned: "Returned" };

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
    completionPercent: 0,
    status: "not_started",
    managerCheck: "new",
    visibility,
    createdBy: user?.email || "",
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
  if (task.status === "done" && task.managerCheck === "approved") return { key: "ok", label: "OK" };
  if (task.status === "done") return { key: "wait", label: "Wait" };
  if (task.taskDate && task.taskDate < localToday()) return { key: "late", label: "Late" };
  return { key: "na", label: "NA" };
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function UserAvatar({ user, name, className = "small" }: { user?: User; name: string; className?: string }) {
  const hasImage = Boolean(user?.profileImageKey);
  return <span className={`avatar ${className}${hasImage ? " has-image" : ""}`}>{hasImage ? <img src={`/api/profile-image?email=${encodeURIComponent(user!.email)}&v=${encodeURIComponent(user!.profileImageKey)}`} alt={name} /> : initials(name)}</span>;
}

async function profileImageResponse(response: Response, fallback: string) {
  const text = await response.text();
  let payload: { error?: string; profileImageKey?: string; uploadId?: string; chunkBytes?: number } = {};
  try { payload = text ? JSON.parse(text) as typeof payload : {}; } catch { /* A gateway can return plain text. */ }
  if (!response.ok) {
    const tooLarge = response.status === 413 || /payload too large/i.test(text);
    throw new Error(payload.error || (tooLarge ? "The image request is too large. Please try again." : fallback));
  }
  return payload;
}

async function uploadProfileImageFile(image: File, email: string, onProgress?: (percent: number) => void) {
  if (image.size <= 0 || image.size > 3 * 1024 * 1024) throw new Error("Image size must not exceed 3 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) throw new Error("Use a JPG, PNG, or WEBP image.");
  let uploadId = "";
  try {
    onProgress?.(1);
    const startResponse = await fetch("/api/profile-image?action=start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, contentType: image.type, sizeBytes: image.size }),
    });
    const start = await profileImageResponse(startResponse, "Unable to start profile image upload.");
    if (!start.uploadId || !start.chunkBytes) throw new Error("Unable to start profile image upload.");
    uploadId = start.uploadId;
    const chunkBytes = start.chunkBytes;
    const chunkCount = Math.ceil(image.size / chunkBytes);
    for (let index = 0; index < chunkCount; index += 1) {
      const startOffset = index * chunkBytes;
      const endOffset = Math.min(image.size, startOffset + chunkBytes);
      const chunkResponse = await fetch(`/api/profile-image?action=chunk&uploadId=${encodeURIComponent(uploadId)}&index=${index}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: image.slice(startOffset, endOffset),
      });
      await profileImageResponse(chunkResponse, `Unable to upload image part ${index + 1}.`);
      onProgress?.(Math.min(96, Math.max(2, Math.round((endOffset / image.size) * 96))));
    }
    const completeResponse = await fetch("/api/profile-image?action=complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    });
    const complete = await profileImageResponse(completeResponse, "Unable to finish profile image upload.");
    if (!complete.profileImageKey) throw new Error("Unable to finish profile image upload.");
    onProgress?.(100);
    return { profileImageKey: complete.profileImageKey };
  } catch (error) {
    if (uploadId) {
      await fetch("/api/profile-image?action=abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      }).catch(() => undefined);
    }
    throw error;
  }
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

function ActionIcon({ kind }: { kind: "refresh" | "excel" | "pdf" }) {
  if (kind === "refresh") return <svg className="action-icon refresh-action-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M25.7 11.2A11 11 0 0 0 7.5 7.5L4 11" /><path d="M4 5.5V11h5.5" /><path d="M6.3 20.8a11 11 0 0 0 18.2 3.7L28 21" /><path d="M28 26.5V21h-5.5" /></svg>;
  if (kind === "excel") return <svg className="action-icon excel-action-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4.5 6.5 18 4v24L4.5 25.5z" /><path d="M18 8h9.5v17H18" /><path d="m8.5 11 5.5 10m0-10-5.5 10" /><path d="M21 12h4M21 16h4M21 20h4" /></svg>;
  return <svg className="action-icon pdf-action-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M7 3.5h11l7 7V28.5H7z" /><path d="M18 3.5v7h7" /><text x="16" y="23">PDF</text></svg>;
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
  const resumed = new Date(entry.resumedAt || entry.startedAt).getTime();
  return entry.durationSeconds + (Number.isFinite(resumed) ? Math.max(0, Math.floor((now - resumed) / 1000)) : 0);
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

function rowsByTaskId<T extends { taskId: number }>(rows: T[]) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.taskId);
    if (existing) existing.push(row);
    else grouped.set(row.taskId, [row]);
  }
  return grouped;
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
  const [taskIssueLinks, setTaskIssueLinks] = useState<TaskIssueLink[]>([]);
  const [taskDetailsLoadedIds, setTaskDetailsLoadedIds] = useState<Set<number>>(() => new Set());
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [overviewIssues, setOverviewIssues] = useState<OverviewIssue[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityExportBusy, setActivityExportBusy] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [projectDrawerReturnToTask, setProjectDrawerReturnToTask] = useState(false);
  const [projectDrawerReturnToReport, setProjectDrawerReturnToReport] = useState(false);
  const [projectDrawerReturnToUserEmail, setProjectDrawerReturnToUserEmail] = useState<string | null>(null);
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [userDrawerReturnToProject, setUserDrawerReturnToProject] = useState(false);
  const [userDrawerReturnToEmployeeTasks, setUserDrawerReturnToEmployeeTasks] = useState<string | null>(null);
  const [userDrawerReturnToReport, setUserDrawerReturnToReport] = useState(false);
  const [passwordDrawerOpen, setPasswordDrawerOpen] = useState(false);
  const [employeeTasksEmail, setEmployeeTasksEmail] = useState<string | null>(null);
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
  const [completionSavingTaskId, setCompletionSavingTaskId] = useState<number | null>(null);
  const [backupBusy, setBackupBusy] = useState<"download" | "restore" | null>(null);
  const [profileImageBusy, setProfileImageBusy] = useState(false);
  const [profileImageProgress, setProfileImageProgress] = useState(0);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [projectSwitcherSearch, setProjectSwitcherSearch] = useState("");
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const projectSwitcherRef = useRef<HTMLDivElement>(null);

  const issuesModuleRef = useRef<IssuesModuleHandle>(null);
  const syncInFlightRef = useRef(false);
  const taskDetailsInFlightRef = useRef(new Set<number>());
  const taskDetailsLoaderRef = useRef<(taskId: number) => void>(() => undefined);
  const lastWorkspaceSyncAtRef = useRef(0);
  const issueSyncInFlightRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const deepLinkedTaskRef = useRef<number | null>(null);
  const reportAnchorAutoSelectedRef = useRef(false);
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
  const [reportPeriod, setReportPeriod] = useState<"week" | "month" | "custom">("week");
  const [reportType, setReportType] = useState<"tasks" | "issues" | "rfi">("tasks");
  const [reportGroup, setReportGroup] = useState<"project" | "employee">("project");
  const [reportAnchor, setReportAnchor] = useState(localToday());
  const [reportCustomStart, setReportCustomStart] = useState(localToday());
  const [reportCustomEnd, setReportCustomEnd] = useState(localToday());
  const [reportScope, setReportScope] = useState("all");
  const [reportDialogMetric, setReportDialogMetric] = useState<ReportMetric | null>(null);
  const [reportRowKey, setReportRowKey] = useState("");

  const taskCommentCounts = useMemo(() => {
    const counts = new Map<number, number>();
    comments.forEach((comment) => counts.set(comment.taskId, (counts.get(comment.taskId) || 0) + 1));
    return counts;
  }, [comments]);

  const applyWorkspaceData = useCallback((data: WorkspaceData, initialize = false) => {
    setTasks(data.tasks || []);
    if (Array.isArray(data.comments)) setComments(data.comments);
    if (Array.isArray(data.timeEntries)) {
      if (data.timeEntriesMode === "active") {
        const visibleTaskIds = new Set((data.tasks || []).map((task) => task.id));
        setTimeEntries((current) => [
          ...current.filter((entry) => Boolean(entry.endedAt) && visibleTaskIds.has(entry.taskId)),
          ...data.timeEntries!,
        ]);
      } else setTimeEntries(data.timeEntries);
    }
    if (Array.isArray(data.subtasks)) setSubtasks(data.subtasks);
    if (Array.isArray(data.taskAttachments)) setTaskAttachments(data.taskAttachments);
    if (Array.isArray(data.taskIssueLinks)) setTaskIssueLinks(data.taskIssueLinks);
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
      if (!data) {
        setLoading(false);
        return false;
      }
      applyWorkspaceData(data, initialize);
      lastWorkspaceSyncAtRef.current = Date.now();
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

  async function loadTaskDetails(taskId: number) {
    if (taskDetailsInFlightRef.current.has(taskId)) return;
    taskDetailsInFlightRef.current.add(taskId);
    try {
      const data = await fetchTaskDetails(taskId);
      if (!data) return;
      setComments((current) => [...current.filter((row) => row.taskId !== taskId), ...(data.comments || [])]);
      setTimeEntries((current) => [...current.filter((row) => row.taskId !== taskId), ...(data.timeEntries || [])]);
      setSubtasks((current) => [...current.filter((row) => row.taskId !== taskId), ...(data.subtasks || [])]);
      setTaskAttachments((current) => [...current.filter((row) => row.taskId !== taskId), ...(data.taskAttachments || [])]);
      setTaskIssueLinks((current) => [...current.filter((row) => row.convertedTaskId !== taskId), ...(data.taskIssueLinks || [])]);
      setTasks((current) => current.map((task) => task.id === taskId ? {
        ...task,
        commentCount: data.comments?.length || 0,
        subtaskCount: data.subtasks?.length || 0,
        completedSubtaskCount: data.subtasks?.filter((row) => row.completed).length || 0,
        attachmentCount: data.taskAttachments?.length || 0,
      } : task));
      setTaskDetailsLoadedIds((current) => new Set(current).add(taskId));
    } catch (detailsError) {
      setError(detailsError instanceof Error ? detailsError.message : "Unable to load task details.");
    } finally {
      taskDetailsInFlightRef.current.delete(taskId);
    }
  }
  taskDetailsLoaderRef.current = (taskId) => { void loadTaskDetails(taskId); };

  const loadOverviewIssues = useCallback(async () => {
    if (issueSyncInFlightRef.current) return;
    issueSyncInFlightRef.current = true;
    try {
      const response = await fetch("/api/issues?summary=1", { cache: "no-store" });
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
      if (Date.now() - lastWorkspaceSyncAtRef.current < 20_000) return;
      await loadWorkspace();
    };
    const interval = window.setInterval(refresh, 60_000);
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
    url.searchParams.delete("task");
    window.history.pushState({ ...window.history.state, hindazaTab: tab, hindazaProject: nextProject, hindazaSection: nextSection, hindazaEmployeeTasks: null, hindazaReportTasks: null, hindazaTask: null }, "", url);
  }, [tab, selectedProjectCode, projectWorkspaceTab, tabReady]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const url = new URL(window.location.href);
      const value = url.searchParams.get("view");
      const previousTab = tabValues.includes(value as Tab) ? value as Tab : "overview";
      applyingHistoryRef.current = true;
      setTab(previousTab);
      setSelectedProjectCode(url.searchParams.get("project") || "");
      const section = url.searchParams.get("section");
      if (section === "tasks" || section === "issues" || section === "rfi") setProjectWorkspaceTab(section);
      const historyState = event.state as { hindazaEmployeeTasks?: unknown; hindazaEmployeeEdit?: unknown; hindazaReportTasks?: unknown; hindazaReportRow?: unknown; hindazaReportProjectEdit?: unknown; hindazaReportEmployeeEdit?: unknown; hindazaUserEdit?: unknown; hindazaUserProjectEdit?: unknown } | null;
      const employeeTasksState = typeof historyState?.hindazaEmployeeTasks === "string" ? historyState.hindazaEmployeeTasks : null;
      const employeeEditState = typeof historyState?.hindazaEmployeeEdit === "string" ? historyState.hindazaEmployeeEdit : null;
      const reportTasksState = historyState?.hindazaReportTasks;
      const reportMetricState = reportTasksState === "all" || reportTasksState === "approved" || reportTasksState === "wip" || reportTasksState === "pending" ? reportTasksState : null;
      const reportRowState = typeof historyState?.hindazaReportRow === "string" ? historyState.hindazaReportRow : "";
      const reportRowSeparator = reportRowState.indexOf(":");
      if (reportRowSeparator > 0) {
        const restoredGroup = reportRowState.slice(0, reportRowSeparator);
        if (restoredGroup === "project" || restoredGroup === "employee") setReportGroup(restoredGroup);
        setReportRowKey(reportRowState.slice(reportRowSeparator + 1));
      } else setReportRowKey("");
      const reportProjectEditId = Number(historyState?.hindazaReportProjectEdit);
      const reportProjectEdit = Number.isInteger(reportProjectEditId) && reportProjectEditId > 0 ? projects.find((project) => project.id === reportProjectEditId) : null;
      if (reportProjectEdit) {
        setSelectedProjectId(reportProjectEdit.id);
        setProjectForm({ code: reportProjectEdit.code, name: reportProjectEdit.name, client: reportProjectEdit.client, status: reportProjectEdit.status, startDate: reportProjectEdit.startDate, targetDate: reportProjectEdit.targetDate, memberEmails: reportProjectEdit.memberEmails || [], projectManagerEmails: reportProjectEdit.projectManagerEmails || [] });
        setProjectDrawerReturnToTask(false);
        setProjectDrawerReturnToReport(true);
        setProjectDrawerOpen(true);
      } else if (projectDrawerReturnToReport) {
        setProjectDrawerOpen(false);
        setProjectDrawerReturnToReport(false);
      }
      const userProjectEditId = Number(historyState?.hindazaUserProjectEdit);
      const userProjectEdit = Number.isInteger(userProjectEditId) && userProjectEditId > 0 ? projects.find((project) => project.id === userProjectEditId) : null;
      const userEditEmail = typeof historyState?.hindazaUserEdit === "string" ? historyState.hindazaUserEdit : "";
      if (userProjectEdit && userEditEmail) {
        setSelectedProjectId(userProjectEdit.id);
        setProjectForm({ code: userProjectEdit.code, name: userProjectEdit.name, client: userProjectEdit.client, status: userProjectEdit.status, startDate: userProjectEdit.startDate, targetDate: userProjectEdit.targetDate, memberEmails: userProjectEdit.memberEmails || [], projectManagerEmails: userProjectEdit.projectManagerEmails || [] });
        setProjectDrawerReturnToTask(false);
        setProjectDrawerReturnToReport(false);
        setProjectDrawerReturnToUserEmail(userEditEmail);
        setUserDrawerOpen(false);
        setProjectDrawerOpen(true);
      } else if (projectDrawerReturnToUserEmail) {
        setProjectDrawerOpen(false);
        setProjectDrawerReturnToUserEmail(null);
        const user = users.find((item) => item.email === userEditEmail);
        if (user) {
          setSelectedUserEmail(user.email);
          setUserForm({ email: user.email, displayName: user.displayName, role: user.role, discipline: user.discipline, temporaryPassword: "" });
          setUserDrawerOpen(true);
        }
      }
      setEmployeeTasksEmail(employeeTasksState);
      setReportDialogMetric(reportMetricState);
      if (employeeTasksState) {
        setUserDrawerOpen(false);
        setUserDrawerReturnToEmployeeTasks(null);
      } else if (employeeEditState) {
        const employee = users.find((user) => user.email === employeeEditState);
        if (employee) {
          setSelectedUserEmail(employee.email);
          setUserForm({ email: employee.email, displayName: employee.displayName, role: employee.role, discipline: employee.discipline, temporaryPassword: "" });
          setUserDrawerReturnToEmployeeTasks(employee.email);
          setUserDrawerOpen(true);
        }
      }
      const reportEmployeeEditEmail = typeof historyState?.hindazaReportEmployeeEdit === "string" ? historyState.hindazaReportEmployeeEdit : "";
      const reportEmployeeEdit = reportEmployeeEditEmail ? users.find((user) => user.email === reportEmployeeEditEmail) : null;
      if (reportEmployeeEdit) {
        setSelectedUserEmail(reportEmployeeEdit.email);
        setUserForm({ email: reportEmployeeEdit.email, displayName: reportEmployeeEdit.displayName, role: reportEmployeeEdit.role, discipline: reportEmployeeEdit.discipline, temporaryPassword: "" });
        setUserDrawerReturnToProject(false);
        setUserDrawerReturnToEmployeeTasks(null);
        setUserDrawerReturnToReport(true);
        setUserDrawerOpen(true);
      } else if (userDrawerReturnToReport) {
        setUserDrawerOpen(false);
        setUserDrawerReturnToReport(false);
      }
      const taskId = Number(url.searchParams.get("task"));
      if (!Number.isInteger(taskId) || taskId <= 0) {
        deepLinkedTaskRef.current = null;
        setTaskDrawerOpen(false);
        setSelectedTaskId(null);
      } else {
        const task = tasks.find((item) => item.id === taskId);
        if (task) {
          deepLinkedTaskRef.current = taskId;
          openTask(task);
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [tasks, users, projects, projectDrawerReturnToReport, projectDrawerReturnToUserEmail, userDrawerReturnToReport]);

  useEffect(() => {
    if (loading || !tabReady) return;
    const taskId = Number(new URL(window.location.href).searchParams.get("task"));
    if (!Number.isInteger(taskId) || taskId <= 0 || deepLinkedTaskRef.current === taskId) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    deepLinkedTaskRef.current = taskId;
    openProjectWorkspace(task.project, "tasks");
    openTask(task);
  }, [loading, tabReady, tasks]);

  useEffect(() => {
    if (!tabReady) return;
    const stateEmail = typeof window.history.state?.hindazaEmployeeTasks === "string" ? window.history.state.hindazaEmployeeTasks : null;
    if (employeeTasksEmail && stateEmail !== employeeTasksEmail) {
      const url = new URL(window.location.href);
      url.searchParams.delete("task");
      window.history.pushState({ ...window.history.state, hindazaEmployeeTasks: employeeTasksEmail, hindazaTask: null }, "", url);
    } else if (!employeeTasksEmail && stateEmail) {
      const url = new URL(window.location.href);
      url.searchParams.delete("task");
      window.history.replaceState({ ...window.history.state, hindazaEmployeeTasks: null, hindazaTask: null }, "", url);
      deepLinkedTaskRef.current = null;
      const closeDrawerTimer = window.setTimeout(() => {
        setTaskDrawerOpen(false);
        setSelectedTaskId(null);
      }, 0);
      return () => window.clearTimeout(closeDrawerTimer);
    }
  }, [employeeTasksEmail, tabReady]);

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
        if (reportDialogMetric) {
          closeReportTasks();
          return;
        }
        if (employeeTasksEmail) {
          closeEmployeeTasks();
          return;
        }
        if (userDrawerOpen) {
          if (userDrawerReturnToReport) {
            window.history.back();
            return;
          }
          if (userDrawerReturnToEmployeeTasks) {
            window.history.back();
            return;
          }
          setUserDrawerOpen(false);
          setUserDrawerReturnToProject(false);
          return;
        }
        if (projectDrawerOpen) {
          if (projectDrawerReturnToReport || projectDrawerReturnToUserEmail) {
            window.history.back();
            return;
          }
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
  }, [employeeTasksEmail, reportDialogMetric, projectDrawerOpen, projectDrawerReturnToReport, projectDrawerReturnToUserEmail, userDrawerOpen, userDrawerReturnToEmployeeTasks, userDrawerReturnToReport]);

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
  const userByIdentity = useMemo(() => {
    const map = new Map<string, User>();
    for (const user of users) {
      map.set(user.email.toLowerCase(), user);
      map.set(user.displayName, user);
    }
    return map;
  }, [users]);
  const projectCodes = useMemo(() => projects.map((project) => project.code).sort(), [projects]);
  const activeWork = useMemo(() => {
    const activeEntryByTask = new Map(timeEntries.filter((entry) => !entry.endedAt).map((entry) => [entry.taskId, entry]));
    const byEmployee = new Map<string, { entry: TaskTimeEntry | null; task: Task; employeeEmail: string; employeeName: string; activeSince: string }>();
    tasks.filter((task) => task.status === "in_progress" || activeEntryByTask.has(task.id)).forEach((task) => {
      const entry = activeEntryByTask.get(task.id) || null;
      const employeeEmail = entry?.employeeEmail || task.employeeEmail;
      const employeeName = entry?.employeeName || task.employeeName;
      const activeSince = entry?.resumedAt || entry?.startedAt || task.updatedAt;
      const key = employeeEmail || employeeName;
      const existing = byEmployee.get(key);
      if (!existing || activeSince > existing.activeSince) byEmployee.set(key, { entry, task, employeeEmail, employeeName, activeSince });
    });
    return Array.from(byEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [tasks, timeEntries]);
  const activeEmployeeWork = currentUser
    ? activeWork.find(({ employeeEmail, task }) => employeeEmail === currentUser.email || task.employeeEmail === currentUser.email) || null
    : null;
  const activeWorkByProject = useMemo(() => {
    const grouped = new Map<string, typeof activeWork>();
    for (const work of activeWork) {
      const rows = grouped.get(work.task.project);
      if (rows) rows.push(work); else grouped.set(work.task.project, [work]);
    }
    return grouped;
  }, [activeWork]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const searchable = `${task.title} ${task.expectedOutput} ${task.project} ${task.employeeName}`.toLowerCase();
      return (!term || searchable.includes(term)) &&
        (employeeFilter === "all" || task.employeeName === employeeFilter) &&
        (tab === "projects" && selectedProjectCode ? task.project === selectedProjectCode : projectFilter === "all" || task.project === projectFilter) &&
        (statusFilter === "all" || task.status === statusFilter) &&
        (reviewFilter === "all" || (reviewFilter === "unapproved" ? task.managerCheck !== "approved" : task.managerCheck === reviewFilter)) &&
        (!dueDateFilter || task.taskDate === dueDateFilter) &&
        (disciplineFilter === "all" || task.employeeDiscipline === disciplineFilter || userByIdentity.get(task.employeeEmail.toLowerCase())?.discipline === disciplineFilter || userByIdentity.get(task.employeeName)?.discipline === disciplineFilter);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }, [tasks, userByIdentity, search, employeeFilter, projectFilter, statusFilter, reviewFilter, dueDateFilter, disciplineFilter, tab, selectedProjectCode]);

  const selectedProject = useMemo(() => projects.find((project) => project.code === selectedProjectCode) || null, [projects, selectedProjectCode]);
  const currentUserIsProjectManager = Boolean(currentUser && selectedProject?.projectManagerEmails.includes(currentUser.email));
  const projectTasks = useMemo(() => filteredTasks.filter((task) => task.project === selectedProjectCode), [filteredTasks, selectedProjectCode]);
  const allProjectTasks = useMemo(() => tasks.filter((task) => task.project === selectedProjectCode), [tasks, selectedProjectCode]);
  const projectStats = useMemo(() => {
    const count = (value: Task["managerCheck"]) => allProjectTasks.filter((task) => task.managerCheck === value).length;
    return { total: allProjectTasks.length, new: count("new"), pending: count("pending"), approved: count("approved"), returned: count("returned") };
  }, [allProjectTasks]);

  const stats = useMemo(() => {
    const count = (value: Task["managerCheck"]) => tasks.filter((task) => task.managerCheck === value).length;
    return { total: tasks.length, new: count("new"), pending: count("pending"), approved: count("approved"), returned: count("returned") };
  }, [tasks]);

  const teamRows = useMemo(() => {
    const tasksByEmployee = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = task.employeeEmail ? task.employeeEmail.toLowerCase() : task.employeeName;
      const rows = tasksByEmployee.get(key);
      if (rows) rows.push(task); else tasksByEmployee.set(key, [task]);
    }
    return users.map((user) => {
    const rows = tasksByEmployee.get(user.email.toLowerCase()) || tasksByEmployee.get(user.displayName) || [];
    return {
      ...user,
      temporary: user.email.endsWith("@hindaza.local"),
      total: rows.length,
      done: rows.filter((task) => task.status === "done").length,
      attention: rows.filter((task) => taskFlag(task).key !== "ok").length,
      planned: rows.reduce((sum, task) => sum + task.plannedHours, 0),
      actual: rows.reduce((sum, task) => sum + task.actualHours, 0),
    };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  }, [users, tasks]);

  const filteredTeamRows = useMemo(() => {
    const term = teamSearch.trim().toLowerCase();
    return teamRows.filter((user) =>
      (!term || `${user.displayName} ${user.email} ${user.discipline} ${user.role}`.toLowerCase().includes(term)) &&
      (teamDisciplineFilter === "all" || user.discipline === teamDisciplineFilter) &&
      (teamRoleFilter === "all" || user.role === teamRoleFilter)
    );
  }, [teamRows, teamSearch, teamDisciplineFilter, teamRoleFilter]);

  const projectRows = useMemo(() => {
    const tasksByProject = new Map<string, Task[]>();
    const issuesByProject = new Map<string, OverviewIssue[]>();
    for (const task of tasks) {
      const rows = tasksByProject.get(task.project);
      if (rows) rows.push(task); else tasksByProject.set(task.project, [task]);
    }
    for (const issue of overviewIssues) {
      const rows = issuesByProject.get(issue.projectCode);
      if (rows) rows.push(issue); else issuesByProject.set(issue.projectCode, [issue]);
    }
    return projects.map((project) => {
    const rows = tasksByProject.get(project.code) || [];
    const issueRows = issuesByProject.get(project.code) || [];
    const done = rows.filter((task) => task.status === "done").length;
    return {
      ...project,
      total: rows.length,
      done,
      reviewNew: rows.filter((task) => task.managerCheck === "new").length,
      reviewPending: rows.filter((task) => task.managerCheck === "pending").length,
      reviewApproved: rows.filter((task) => task.managerCheck === "approved").length,
      reviewReturned: rows.filter((task) => task.managerCheck === "returned").length,
      progress: rows.length ? Math.round((done / rows.length) * 100) : 0,
      planned: rows.reduce((sum, task) => sum + task.plannedHours, 0),
      actual: rows.reduce((sum, task) => sum + task.actualHours, 0),
      openIssues: issueRows.filter((issue) => issue.status !== "closed").length,
      totalIssues: issueRows.length,
      closedIssues: issueRows.filter((issue) => issue.status === "closed").length,
      totalRfi: 0,
      closedRfi: 0,
    };
    });
  }, [projects, tasks, overviewIssues]);

  const filteredProjectRows = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    return projectRows.filter((project) =>
      (!term || `${project.name} ${project.code} ${project.client}`.toLowerCase().includes(term)) &&
      (projectStatusFilter === "all" || project.status === projectStatusFilter)
    ).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }));
  }, [projectRows, projectSearch, projectStatusFilter]);

  const customRangeInvalid = reportPeriod === "custom" && Boolean(reportCustomStart && reportCustomEnd) && reportCustomEnd < reportCustomStart;
  const range = useMemo(() => reportPeriod === "custom" ? {
    start: reportCustomStart,
    end: reportCustomEnd,
  } : reportRange(reportAnchor, reportPeriod), [reportAnchor, reportPeriod, reportCustomStart, reportCustomEnd]);
  const reportPeriodLabel = reportPeriod === "week" ? "Weekly" : reportPeriod === "month" ? "Monthly" : "Custom Range";
  const reportProjectCodes = useMemo(() => new Set(projects.map((project) => project.code)), [projects]);
  const reportEligibleTasks = useMemo(() => tasks.filter((task) => reportProjectCodes.has(task.project)), [tasks, reportProjectCodes]);
  const reportEmployees = useMemo(() => Array.from(new Set(reportEligibleTasks.map((task) => task.employeeName).filter(Boolean))).sort(), [reportEligibleTasks]);
  useEffect(() => {
    if (loading || reportAnchorAutoSelectedRef.current || reportPeriod === "custom" || reportEligibleTasks.length === 0) return;
    reportAnchorAutoSelectedRef.current = true;
    const visibleRange = reportRange(reportAnchor, reportPeriod);
    if (reportEligibleTasks.some((task) => task.taskDate >= visibleRange.start && task.taskDate <= visibleRange.end)) return;
    const dates = reportEligibleTasks.map((task) => task.taskDate).filter(Boolean).sort();
    const mostRecentDate = dates.filter((date) => date <= localToday()).at(-1) || dates[0];
    if (mostRecentDate) {
      const anchorTimer = window.setTimeout(() => setReportAnchor(mostRecentDate), 0);
      return () => window.clearTimeout(anchorTimer);
    }
  }, [loading, reportEligibleTasks, reportAnchor, reportPeriod]);
  const reportTasks = useMemo(() => customRangeInvalid ? [] : reportEligibleTasks.filter((task) => task.taskDate >= range.start && task.taskDate <= range.end && (
    reportScope === "all" || (reportGroup === "project" ? task.project === reportScope : task.employeeName === reportScope)
  )), [reportEligibleTasks, range, reportScope, reportGroup, customRangeInvalid]);

  const reportRows = useMemo(() => {
    const keys = reportGroup === "project" ? projectCodes : reportEmployees;
    return keys.map((key) => {
      const rows = reportTasks.filter((task) => reportGroup === "project" ? task.project === key : task.employeeName === key);
      return {
        key,
        label: reportGroup === "project" ? projects.find((project) => project.code === key)?.name || key : key,
        total: rows.length,
        projectCount: new Set(rows.map((task) => task.project)).size,
        employeeCount: new Set(rows.map((task) => task.employeeEmail || task.employeeName).filter(Boolean)).size,
        approved: rows.filter((task) => task.managerCheck === "approved").length,
        wip: rows.filter((task) => task.managerCheck === "new").length,
        pending: rows.filter((task) => task.managerCheck === "pending").length,
        returned: rows.filter((task) => task.managerCheck === "returned").length,
        planned: rows.reduce((sum, task) => sum + task.plannedHours, 0),
        actual: rows.reduce((sum, task) => sum + task.actualHours, 0),
      };
    }).filter((row) => row.total > 0).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  }, [reportTasks, reportGroup, projectCodes, reportEmployees, projects]);

  const reportSummary = useMemo(() => ({
    total: reportTasks.length,
    approved: reportTasks.filter((task) => task.managerCheck === "approved").length,
    wip: reportTasks.filter((task) => task.managerCheck === "new").length,
    pending: reportTasks.filter((task) => task.managerCheck === "pending").length,
    returned: reportTasks.filter((task) => task.managerCheck === "returned").length,
    planned: reportTasks.reduce((sum, task) => sum + task.plannedHours, 0),
    actual: reportTasks.reduce((sum, task) => sum + task.actualHours, 0),
  }), [reportTasks]);

  const displayedReportRows = reportRows;

  const reportDialogTasks = useMemo(() => {
    if (!reportDialogMetric || reportDialogMetric === "all") return reportTasks;
    const managerCheck = reportDialogMetric === "wip" ? "new" : reportDialogMetric;
    return reportTasks.filter((task) => task.managerCheck === managerCheck);
  }, [reportTasks, reportDialogMetric]);
  const reportRowTasks = useMemo(() => !reportRowKey ? [] : reportTasks.filter((task) => reportGroup === "project" ? task.project === reportRowKey : task.employeeName === reportRowKey), [reportTasks, reportGroup, reportRowKey]);

  function openProjectWorkspace(projectCode: string, section: ProjectWorkspaceTab = "tasks") {
    setSelectedProjectCode(projectCode);
    setProjectWorkspaceTab(section);
    setSearch("");
    setEmployeeFilter("all");
    setProjectFilter("all");
    setStatusFilter("all");
    setReviewFilter("unapproved");
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
    if (!currentUser) return;
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
      completionPercent: task.completionPercent,
      visibility: task.visibility,
      createdBy: task.createdBy,
    });
    setCommentDraft("");
    setSubtaskDraft("");
    setDraftSubtasks([]);
    setDraftTaskAttachments([]);
    setTaskAttachmentProgress(null);
    setTaskDrawerOpen(true);
    taskDetailsLoaderRef.current(task.id);
  }

  function openEmployeeTask(task: Task) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "projects");
    url.searchParams.set("project", task.project);
    url.searchParams.set("section", "tasks");
    url.searchParams.set("task", String(task.id));
    window.history.pushState({ ...window.history.state, hindazaEmployeeTasks: null, hindazaTask: task.id }, "", url);
    deepLinkedTaskRef.current = task.id;
    setEmployeeTasksEmail(null);
    openProjectWorkspace(task.project, "tasks");
    openTask(task);
  }

  function openReportRow(key: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    window.history.pushState({ ...window.history.state, hindazaReportRow: `${reportGroup}:${key}`, hindazaTask: null }, "", url);
    setReportRowKey(key);
  }

  function closeReportRow() {
    if (window.history.state?.hindazaReportRow) window.history.back();
    else setReportRowKey("");
  }

  function openReportTasks(metric: ReportMetric) {
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    window.history.pushState({ ...window.history.state, hindazaReportTasks: metric, hindazaTask: null }, "", url);
    setReportDialogMetric(metric);
  }

  function closeReportTasks() {
    if (window.history.state?.hindazaReportTasks) window.history.back();
    else setReportDialogMetric(null);
  }

  function openReportTask(task: Task) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "projects");
    url.searchParams.set("project", task.project);
    url.searchParams.set("section", "tasks");
    url.searchParams.set("task", String(task.id));
    window.history.pushState({ ...window.history.state, hindazaReportTasks: null, hindazaReportRow: null, hindazaTask: task.id }, "", url);
    deepLinkedTaskRef.current = task.id;
    setReportDialogMetric(null);
    setReportRowKey("");
    openProjectWorkspace(task.project, "tasks");
    openTask(task);
  }

  function openReportProjectTasks(projectCode: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "projects");
    url.searchParams.set("project", projectCode);
    url.searchParams.set("section", "tasks");
    url.searchParams.delete("task");
    window.history.pushState({ ...window.history.state, hindazaReportRow: null, hindazaTask: null }, "", url);
    setReportRowKey("");
    openProjectWorkspace(projectCode, "tasks");
  }

  function openReportProjectSettings(project: Project) {
    const url = new URL(window.location.href);
    window.history.pushState({ ...window.history.state, hindazaReportRow: null, hindazaIssueReport: null, hindazaIssueProject: null, hindazaReportProjectEdit: project.id, hindazaReportEmployeeEdit: null }, "", url);
    setReportRowKey("");
    openProject(project);
    setProjectDrawerReturnToReport(true);
  }

  function openReportEmployeeSettings(user: User) {
    const url = new URL(window.location.href);
    window.history.pushState({ ...window.history.state, hindazaReportRow: null, hindazaReportProjectEdit: null, hindazaReportEmployeeEdit: user.email }, "", url);
    setReportRowKey("");
    openUser(user);
    setUserDrawerReturnToReport(true);
  }

  function closeEmployeeTasks() {
    setEmployeeTasksEmail(null);
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
    setProjectDrawerReturnToReport(false);
    setProjectDrawerReturnToUserEmail(null);
    setSelectedProjectId(null);
    setProjectForm(blankProject());
    setProjectDrawerOpen(true);
  }

  function openProject(project: Project) {
    setProjectDrawerReturnToTask(false);
    setProjectDrawerReturnToReport(false);
    setProjectDrawerReturnToUserEmail(null);
    setSelectedProjectId(project.id);
    setProjectForm({ code: project.code, name: project.name, client: project.client, status: project.status, startDate: project.startDate, targetDate: project.targetDate, memberEmails: project.memberEmails || [], projectManagerEmails: project.projectManagerEmails || [] });
    setProjectDrawerOpen(true);
  }

  function openProjectFromTask(project: Project) {
    setProjectDrawerReturnToTask(true);
    setProjectDrawerReturnToReport(false);
    setProjectDrawerReturnToUserEmail(null);
    setSelectedProjectId(project.id);
    setProjectForm({ code: project.code, name: project.name, client: project.client, status: project.status, startDate: project.startDate, targetDate: project.targetDate, memberEmails: project.memberEmails || [], projectManagerEmails: project.projectManagerEmails || [] });
    setProjectDrawerOpen(true);
  }

  function openProjectFromUser(project: Project) {
    if (!selectedUserEmail || !isManagement(currentUser)) return;
    const url = new URL(window.location.href);
    const baseState = { ...window.history.state, hindazaUserEdit: selectedUserEmail, hindazaUserProjectEdit: null };
    window.history.replaceState(baseState, "", url);
    window.history.pushState({ ...baseState, hindazaUserProjectEdit: project.id }, "", url);
    setUserDrawerOpen(false);
    setProjectDrawerReturnToTask(false);
    setProjectDrawerReturnToReport(false);
    setProjectDrawerReturnToUserEmail(selectedUserEmail);
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

  function openLinkedIssue(link: TaskIssueLink) {
    openProjectWorkspace(link.projectCode, "issues");
    window.setTimeout(() => issuesModuleRef.current?.openIssue(link.id), 180);
  }

  function syncIssueLink(issue: { id: number; issueNumber: string; projectCode: string; convertedTaskId: number | null; createdAt?: string }) {
    setTaskIssueLinks((current) => {
      const withoutIssue = current.filter((link) => link.id !== issue.id);
      return issue.convertedTaskId ? [...withoutIssue, { ...issue, convertedTaskId: issue.convertedTaskId, createdAt: issue.createdAt || new Date().toISOString() }] : withoutIssue;
    });
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
    setToast(`Showing ${user.displayName} tasks for ${projectCode} to change the assigned employee · تم عرض مهام ${user.displayName} على مشروع ${projectCode} لتغيير الموظف المسؤول`);
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
    setUserDrawerReturnToEmployeeTasks(null);
    setUserDrawerReturnToReport(false);
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
    setUserDrawerReturnToEmployeeTasks(null);
    setUserDrawerReturnToReport(false);
    setUserRemovalWarning(null);
    setSelectedUserEmail(user.email);
    setUserForm({ email: user.email, displayName: user.displayName, role: user.role, discipline: user.discipline, temporaryPassword: "" });
    setUserDrawerOpen(true);
  }

  function openUserFromProject(user: User) {
    if (!isManagement(currentUser)) return;
    if (currentUser?.role === "manager" && (user.role !== "member" || user.discipline !== currentUser.discipline)) return;
    setUserDrawerReturnToProject(true);
    setUserDrawerReturnToEmployeeTasks(null);
    setUserDrawerReturnToReport(false);
    setUserRemovalWarning(null);
    setSelectedUserEmail(user.email);
    setUserForm({ email: user.email, displayName: user.displayName, role: user.role, discipline: user.discipline, temporaryPassword: "" });
    setUserDrawerOpen(true);
  }

  function openUserFromEmployeeTasks(user: User) {
    if (!isManagement(currentUser)) return;
    if (currentUser?.role === "manager" && (user.role !== "member" || user.discipline !== currentUser.discipline)) return;
    if (user.role === "owner" && currentUser?.role !== "owner") return;
    const url = new URL(window.location.href);
    window.history.pushState({ ...window.history.state, hindazaEmployeeTasks: null, hindazaEmployeeEdit: user.email }, "", url);
    setEmployeeTasksEmail(null);
    setUserDrawerReturnToProject(false);
    setUserDrawerReturnToEmployeeTasks(user.email);
    setUserDrawerReturnToReport(false);
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
      setToast(selectedTaskId ? "Task updated successfully · تم تحديث المهمة بنجاح" : "Task created successfully · تمت إضافة المهمة بنجاح");
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
      setToast("Task note added successfully · تمت إضافة الملاحظة إلى سجل المهمة");
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
      setToast("Task note updated successfully · تم تحديث الملاحظة بنجاح");
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
      setToast("Task note deleted successfully · تم حذف الملاحظة بنجاح");
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

  function updateDraftSubtask(id: string, title: string) {
    const nextTitle = title.trim().slice(0, 240);
    if (!nextTitle) return;
    setDraftSubtasks((current) => current.map((subtask) => subtask.id === id ? { ...subtask, title: nextTitle } : subtask));
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

  async function updateSubtaskTitle(subtask: TaskSubtask, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === subtask.title) return Boolean(nextTitle);
    setSubtaskBusy(true); setError("");
    try {
      const response = await fetch("/api/task-subtasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: subtask.id, title: nextTitle }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to edit subtask.");
      setSubtasks((current) => current.map((item) => item.id === data.subtask.id ? data.subtask : item));
      setToast("Subtask updated · تم تعديل المهمة الفرعية");
      return true;
    } catch (subtaskError) {
      setError(subtaskError instanceof Error ? subtaskError.message : "Unable to edit subtask.");
      return false;
    } finally { setSubtaskBusy(false); }
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
        ? "Task timer started · بدأ تسجيل وقت المهمة"
        : action === "pause"
          ? "Task timer paused · تم إيقاف الوقت مؤقتًا"
          : data.submittedForReview
            ? "Task completed and submitted for review · اكتملت المهمة وأُرسلت للمراجعة"
            : "Private task completed · اكتملت المهمة الخاصة");
    } catch (timerError) {
      setError(timerError instanceof Error ? timerError.message : "تعذر تحديث وقت المهمة");
    } finally {
      setSavingTimer(false);
    }
  }

  async function updateTaskCompletion(taskId: number, completionPercent: number) {
    setCompletionSavingTaskId(taskId); setError("");
    try {
      const completingTask = completionPercent === 100;
      const response = await fetch(completingTask ? "/api/task-timer" : "/api/tasks", {
        method: completingTask ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(completingTask
          ? { taskId, action: "finish" }
          : { id: taskId, action: "update_completion", completionPercent }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update task completion.");
      if (completingTask) {
        mergeTimerResponse(data);
        setToast(data.submittedForReview
          ? "Task completed and submitted for review · اكتملت المهمة وأُرسلت للمراجعة"
          : "Private task completed · اكتملت المهمة الخاصة");
      } else {
        setTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...data.task } : task));
        if (selectedTaskId === taskId) setTaskForm((current) => ({ ...current, completionPercent }));
        setToast(`Task completion updated to ${completionPercent}% · تم تحديث نسبة الإنجاز إلى ${completionPercent}%`);
      }
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : "Unable to update task completion.");
    } finally {
      setCompletionSavingTaskId(null);
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
      setToast("Private task shared with the manager · تمت مشاركة المهمة الخاصة مع المسؤول");
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
      setTaskDrawerOpen(false); setToast("Task deleted successfully · تم حذف المهمة");
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
      setToast(selectedUserEmail ? "Employee details updated · تم تحديث بيانات الموظف" : "Employee account added · تمت إضافة حساب الموظف");
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
      setUserDrawerOpen(false); setToast("Employee deleted · تم حذف الموظف");
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

  async function exportActivityExcel() {
    if (currentUser?.role !== "owner" || activity.length === 0) return;
    setActivityExportBusy(true); setError("");
    const headers = ["Date & Time", "User", "Email", "Action", "Type", "Item", "Project", "Details"];
    const rows = activity.map((entry) => [formatDateTime(entry.createdAt), entry.actorName, entry.actorEmail, entry.action.replaceAll("_", " "), entry.entityType, entry.entityLabel, entry.projectCode || "—", entry.details || "—"]);
    const columnName = (index: number) => String.fromCharCode(65 + index);
    const worksheetRows = [headers, ...rows].map((row, rowIndex) => {
      const excelRow = rowIndex + 8;
      const cells = row.map((cell, cellIndex) => `<c r="${columnName(cellIndex)}${excelRow}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t>${escapeXml(cell)}</t></is></c>`).join("");
      return `<row r="${excelRow}">${cells}</row>`;
    }).join("");
    try {
      const [{ default: JSZip }, logoResponse] = await Promise.all([import("jszip"), fetch("/report-logo.png")]);
      if (!logoResponse.ok) throw new Error("Unable to load report logo.");
      const logo = await logoResponse.arrayBuffer();
      const zip = new JSZip();
      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
      zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
      zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Activity Log" sheetId="1" r:id="rId1"/></sheets></workbook>`);
      zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
      zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF171717"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`);
      zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="21" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="7" width="20" customWidth="1"/><col min="8" max="8" width="52" customWidth="1"/></cols><sheetData><row r="1" ht="78" customHeight="1"/><row r="6"><c r="A6" t="inlineStr"><is><t>${escapeXml(`HINDAZA Activity Log · ${formatDateTime(new Date().toISOString())}`)}</t></is></c></row>${worksheetRows}</sheetData><mergeCells count="1"><mergeCell ref="A6:H6"/></mergeCells><drawing r:id="rId1"/></worksheet>`);
      zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
      zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="2286000" cy="833000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="HINDAZA Report Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
      zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/report-logo.png"/></Relationships>`);
      zip.file("xl/media/report-logo.png", logo);
      const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `HINDAZA_activity_log_${localToday()}.xlsx`; link.click(); URL.revokeObjectURL(url);
      setToast("Activity log downloaded with the report logo · تم تنزيل سجل التعديلات مع شعار التقارير");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export the activity log.");
    } finally {
      setActivityExportBusy(false);
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
      setToast("Password changed successfully · تم تغيير كلمة المرور بنجاح");
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
    setProfileImageBusy(true); setProfileImageProgress(1); setError("");
    try {
      const data = await uploadProfileImageFile(image, currentUser?.email || "", setProfileImageProgress);
      setCurrentUser((current) => current ? { ...current, profileImageKey: data.profileImageKey } : current);
      setUsers((current) => current.map((user) => user.email === currentUser?.email ? { ...user, profileImageKey: data.profileImageKey } : user));
      await new Promise((resolve) => window.setTimeout(resolve, 280));
      setAccountMenuOpen(false);
      setToast("Profile image updated · تم تحديث صورة الحساب");
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "تعذر تحديث صورة الحساب");
    } finally {
      input.value = "";
      setProfileImageProgress(0);
      setProfileImageBusy(false);
    }
  }

  async function removeProfileImage() {
    if (!currentUser?.profileImageKey) return;
    const approved = await confirm({ title: "Delete profile image?", titleAr: "حذف صورة الحساب؟", message: "The current profile image will be removed from your account.", messageAr: "سيتم حذف صورة الحساب الحالية.", confirmLabel: "Delete image", confirmLabelAr: "حذف الصورة" });
    if (!approved) return;
    setProfileImageBusy(true); setError("");
    try {
      const response = await fetch("/api/profile-image?action=remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: currentUser.email }) });
      const data = await profileImageResponse(response, "Unable to remove profile image.");
      if (!response.ok) throw new Error(data.error || "Unable to remove profile image.");
      setCurrentUser((current) => current ? { ...current, profileImageKey: "" } : current);
      setUsers((current) => current.map((user) => user.email === currentUser.email ? { ...user, profileImageKey: "" } : user));
      setAccountMenuOpen(false);
      setToast("Profile image deleted · تم حذف صورة الحساب");
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
      setToast("System backup downloaded · تم تنزيل النسخة الاحتياطية لجميع بيانات النظام");
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
      setToast("System data restored while preserving the current owner account · تمت استعادة البيانات بنجاح مع الحفاظ على حساب المالك الحالي وكلمة مروره");
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

  function changeReportCalendar(value: string) {
    if (!value) return;
    if (reportPeriod === "month") {
      if (/^\d{4}-\d{2}$/.test(value)) setReportAnchor(`${value}-01`);
      return;
    }
    const match = value.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return;
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (!Number.isInteger(year) || week < 1 || week > 53) return;
    const januaryFourth = new Date(year, 0, 4, 12);
    const monday = new Date(januaryFourth);
    monday.setDate(januaryFourth.getDate() - ((januaryFourth.getDay() + 6) % 7) + (week - 1) * 7);
    setReportAnchor(isoDate(monday));
  }

  async function exportExcel() {
    const headers = ["Group", "Total Tasks", "Manager Approved", "WIP", "Needs Review", "Returned", "Planned Hours", "Actual Hours"];
    const rows: (string | number)[][] = displayedReportRows.map((row) => [row.label, row.total, row.approved, row.wip, row.pending, row.returned, row.planned, row.actual]);
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
      zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="8" width="17" customWidth="1"/></cols><sheetData><row r="1" ht="78" customHeight="1"/><row r="6"><c r="A6" t="inlineStr"><is><t>${escapeXml(`HINDAZA ${reportPeriodLabel} Report · ${formatDate(range.start)} — ${formatDate(range.end)}`)}</t></is></c></row>${worksheetRows}</sheetData><mergeCells count="1"><mergeCell ref="A6:H6"/></mergeCells><drawing r:id="rId1"/></worksheet>`);
      zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
      zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="2286000" cy="833000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="HINDAZA Report Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
      zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/report-logo.png"/></Relationships>`);
      zip.file("xl/media/report-logo.png", logo);
      const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `HINDAZA_${reportPeriod}_report_${range.start}_${range.end}.xlsx`; link.click(); URL.revokeObjectURL(url);
      setToast("Excel report downloaded successfully");
    } catch (excelError) {
      setError(excelError instanceof Error ? excelError.message : "Unable to create the Excel report.");
    }
  }

  function exportPdf() {
    const popup = window.open("", "_blank", "width=1050,height=760");
    if (!popup) { setError("Please allow pop-ups to create the PDF report."); return; }
    const bars = displayedReportRows.map((row) => {
      const scale = (value: number) => (value / Math.max(1, row.total)) * 100;
      const groupCount = reportGroup === "employee" ? `${row.projectCount} projects` : `${row.employeeCount} employees`;
      return `<div class="bar-row"><strong>${escapeXml(row.label)}<small>(${groupCount})</small></strong><div class="bar"><i class="approved" style="width:${scale(row.approved)}%">${row.approved || ""}</i><i class="wip" style="width:${scale(row.wip)}%">${row.wip || ""}</i><i class="pending" style="width:${scale(row.pending)}%">${row.pending || ""}</i><i class="returned" style="width:${scale(row.returned)}%">${row.returned || ""}</i></div><span>${row.total}</span></div>`;
    }).join("");
    const reportTableRows = displayedReportRows.map((row) => `<tr><td>${escapeXml(row.label)}</td><td>${row.total}</td><td>${row.approved}</td><td>${row.wip}</td><td>${row.pending}</td><td>${row.returned}</td><td>${row.planned.toFixed(2)}</td><td>${row.actual.toFixed(2)}</td></tr>`).join("");
    const reportTable = `<table class="report-detail-table"><thead><tr><th>${reportGroup === "project" ? "Project" : "Employee"}</th><th>Total Tasks</th><th>Manager Approved</th><th>WIP</th><th>Needs Review</th><th>Returned</th><th>Planned Hours</th><th>Actual Hours</th></tr></thead><tbody>${reportTableRows}</tbody></table>`;
    popup.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>HINDAZA Project Management Report</title><style>*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,Tahoma,sans-serif;color:#1d1d1d;padding:26px;text-align:left}.logo{display:block;width:220px;max-height:76px;object-fit:contain;object-position:left center;margin:0 0 20px}h1{color:#171717;margin:0;border-left:5px solid #ffd200;padding-left:12px}.meta{color:#737373;margin:8px 0 22px}.summary{display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:10px;margin:20px 0}.summary div{border:1px solid #d9d9d2;border-radius:10px;padding:11px 14px}.summary strong{font-size:22px;color:#8b6c00;display:block;margin-top:4px}.chart{margin:22px 0;padding:14px;border:1px solid #deded8;border-radius:10px}.bar-row{display:grid;grid-template-columns:190px 1fr 35px;gap:10px;align-items:center;margin:9px 0;font-size:11px}.bar-row strong small{display:block;margin-top:3px;color:#c8414a;font-size:8px}.bar{display:flex;height:18px;background:#f1f1ed;border:1px solid #bfc3c3;border-radius:8px;overflow:hidden}.bar i{display:grid;height:100%;min-width:0;place-items:center;color:white;font-size:9px;font-style:normal;text-shadow:0 1px 2px rgba(0,0,0,.45)}.approved{background:#2f8a64!important}.wip{background:#627b87!important}.pending{background:#ffd200!important;color:#171717!important;text-shadow:none!important}.returned{background:#d05a62!important}.legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:13px;font-size:10px}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:18px;height:8px;border:1px solid #999;border-radius:4px}.report-detail-table{width:100%;margin-top:16px;border-collapse:collapse;table-layout:fixed}.report-detail-table th,.report-detail-table td{padding:8px 7px;border:1px solid #d9d9d2;text-align:left;font-size:9px}.report-detail-table th{background:#171717;color:#fff;font-size:8px}.report-detail-table th:first-child{width:22%}.footer{margin-top:30px;color:#858585;font-size:9px}@media print{body{padding:0}.report-detail-table{break-inside:auto}.report-detail-table tr{break-inside:avoid}}</style></head><body><img class="logo" src="/report-logo.png" alt="HINDAZA"><h1>HINDAZA Project Management</h1><div class="meta">${reportPeriodLabel} Report · ${formatDate(range.start)} — ${formatDate(range.end)}</div><div class="summary"><div>Total Tasks<strong>${reportSummary.total}</strong></div><div>Manager Approved<strong>${reportSummary.approved}</strong></div><div>WIP<strong>${reportSummary.wip}</strong></div><div>Needs Review<strong>${reportSummary.pending}</strong></div></div><div class="chart">${bars}<div class="legend"><span><i class="approved"></i>Manager Approved</span><span><i class="wip"></i>WIP</span><span><i class="pending"></i>Needs Review</span><span><i class="returned"></i>Returned</span></div></div>${reportTable}<div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>{window.print();}</script></body></html>`);
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
  const projectLiveIndicators = (projectCode: string) => {
    const workers = activeWorkByProject.get(projectCode) || [];
    if (!isManagement(currentUser) || workers.length === 0) return null;
    return <span className="project-live-workers" aria-label={`${workers.length} employees working now`}>{workers.map(({ employeeEmail, employeeName, task }) => <i key={`${employeeEmail}-${task.id}`} title={`${employeeName} is working on ${task.title}`} aria-label={`${employeeName}: ${task.title}`} />)}</span>;
  };
  const switcherTerm = projectSwitcherSearch.trim().toLowerCase();
  const switcherProjects = projects
    .filter((project) => !switcherTerm || `${project.name} ${project.code}`.toLowerCase().includes(switcherTerm))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const accountProfileProgressStyle = { "--profile-upload-progress": `${profileImageProgress * 3.6}deg` } as CSSProperties;

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="التنقل الرئيسي">
        <a className="brand-block" href="https://pm.hindaza.com/" aria-label="Go to HINDAZA Project Management home"><img src="/hindaza-logo.png" alt="HINDAZA Engineering BIM" /><span>PROJECT MANAGEMENT</span></a>
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
            <button type="button" className={`sidebar-user-trigger${accountMenuOpen ? " open" : ""}`} onClick={() => { setNotificationMenuOpen(false); setAccountMenuOpen((open) => !open); }} aria-label="Account details" aria-expanded={accountMenuOpen}>
              <span className="sidebar-account-photo"><span className={`avatar${currentUser?.profileImageKey ? " has-image" : ""}`}>{currentUser?.profileImageKey ? <img src={`/api/profile-image?v=${encodeURIComponent(currentUser.profileImageKey)}`} alt={currentUser.displayName} /> : initials(currentUser?.displayName || "H")}</span>{profileImageBusy && profileImageProgress > 0 && <span className="sidebar-photo-progress" style={accountProfileProgressStyle} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={profileImageProgress} aria-label={`Uploading profile image ${profileImageProgress}%`}><span>{profileImageProgress}%</span></span>}</span>
              <span className="sidebar-user-copy"><strong>{currentUser?.displayName || "جاري التحميل"}</strong><span>{currentUser ? roleLabel(currentUser.role) : ""}</span></span>
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className={`topbar${tab === "projects" && selectedProject ? " project-context-topbar" : ""}`}>
          <div className="page-heading"><div className="project-heading-line"><h1 dir="ltr">{tab === "projects" && selectedProject ? selectedProject.name : pageTitle[tab]}</h1>{tab === "projects" && selectedProject && projects.length > 1 && <div className="project-switcher" ref={projectSwitcherRef}><button type="button" className="project-switcher-button" onClick={() => { setProjectSwitcherOpen((open) => !open); setProjectSwitcherSearch(""); }} aria-label="Switch project" aria-expanded={projectSwitcherOpen} title="Switch project"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5-5 5 5M17 15l-5 5-5-5" /></svg></button>{projectSwitcherOpen && <div className="project-switcher-menu" role="menu" aria-label="Available projects"><label className="project-switcher-search"><span>⌕</span><input autoFocus value={projectSwitcherSearch} onChange={(event) => setProjectSwitcherSearch(event.target.value)} placeholder="Search project..." aria-label="Search projects" /></label>{switcherProjects.length ? switcherProjects.map((project) => <button type="button" role="menuitem" key={project.code} className={project.code === selectedProject.code ? "active" : ""} onClick={() => { openProjectWorkspace(project.code, projectWorkspaceTab); setProjectSwitcherOpen(false); setProjectSwitcherSearch(""); }}><strong>{project.name}</strong><small>{project.code}</small></button>) : <div className="project-switcher-empty">No matching projects</div>}</div>}</div>}</div>{tab === "projects" && selectedProject && <div className="project-heading-meta"><span className="project-heading-code">{selectedProject.code}</span><span className={`project-status ${selectedProject.status}`}>{projectStatusLabel[selectedProject.status]}</span>{selectedProject.client && <span className="project-heading-client">{selectedProject.client}</span>}</div>}<p className="subhead" dir="ltr">{new Intl.DateTimeFormat("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}</p></div>
          <div className="topbar-actions">
            {tab === "projects" && selectedProject && projectWorkspaceTab === "tasks" && isManagement(currentUser) && <button className="primary-button topbar-add-button" onClick={() => openNewTask(selectedProject.code)}><span className="button-icon" aria-hidden="true">✓</span><span>New Task</span></button>}
            {tab === "projects" && selectedProject && projectWorkspaceTab === "tasks" && currentUser && <button className="primary-button topbar-add-button private-task-button" onClick={() => openNewPrivateTask(selectedProject.code)}><span className="button-icon" aria-hidden="true">✓</span><span>Private Task</span></button>}
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

        {activeEmployeeWork && <button type="button" className="employee-active-work-banner" onClick={() => openEmployeeTask(activeEmployeeWork.task)} aria-label={`Open active task ${activeEmployeeWork.task.title}`}><span className="active-work-pulse" aria-hidden="true" /><span><small>WORKING NOW · يعمل الآن</small><strong dir="auto">{activeEmployeeWork.task.title}</strong><em>{projects.find((project) => project.code === activeEmployeeWork.task.project)?.name || activeEmployeeWork.task.project} · {activeEmployeeWork.task.project}</em></span><b aria-hidden="true">Open Task →</b></button>}

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
              <article className="stat-card amber"><span>Returned · مُعادة</span><strong>{projectStats.returned}</strong></article>
              <article className="stat-card green"><span>Approved · معتمدة</span><strong>{projectStats.approved}</strong></article>
            </section>
            <TaskTable loading={loading} tasks={projectTasks} filteredCount={projectTasks.length} tab={tab} employees={employeeOptions} users={users} projects={[selectedProject.code]} lockedProjectCode={selectedProject.code} search={search} employeeFilter={employeeFilter} projectFilter={projectFilter} statusFilter={statusFilter} reviewFilter={reviewFilter} dueDateFilter={dueDateFilter} disciplineFilter={disciplineFilter} showEmployeeFilter={currentUser?.role !== "member" || currentUserIsProjectManager} showDisciplineColumn={currentUser?.role === "owner" || currentUser?.role === "manager" || currentUserIsProjectManager} setSearch={setSearch} setEmployeeFilter={setEmployeeFilter} setProjectFilter={setProjectFilter} setStatusFilter={setStatusFilter} setReviewFilter={setReviewFilter} setDueDateFilter={setDueDateFilter} setDisciplineFilter={setDisciplineFilter} openTask={openTask} showAll={() => undefined} timeEntries={timeEntries} clock={clock} commentCounts={taskCommentCounts} detailsLoadedTaskIds={taskDetailsLoadedIds} subtasks={subtasks} attachments={taskAttachments} issueLinks={taskIssueLinks} openIssue={openLinkedIssue} currentUser={currentUser} completionSavingTaskId={completionSavingTaskId} updateCompletion={updateTaskCompletion} />
          </>}
          {projectWorkspaceTab === "issues" && currentUser && <IssuesModule key={selectedProject.code} ref={issuesModuleRef} currentUser={currentUser} users={users} projects={[selectedProject]} lockedProjectCode={selectedProject.code} onTaskCreated={(task) => setTasks((current) => [task as Task, ...current])} onIssueChanged={syncIssueLink} onOpenTask={(id) => void openLinkedTask(id)} onOpenProjectSettings={(project) => openProjectFromTask(project as Project)} onToast={setToast} />}
          {projectWorkspaceTab === "rfi" && <section className="panel module-placeholder"><div className="module-icon">RFI</div><p>REQUEST FOR INFORMATION</p><h2>{selectedProject.name}</h2><span>This RFI workspace is limited to {selectedProject.code}.</span><div className="module-status">Ready for configuration</div></section>}
        </section>}

        {tab === "tasks" && <>
          <section className="stats-grid task-stats-ltr" aria-label="Task summary" dir="ltr">
            <article className="stat-card navy"><span>Total Tasks · إجمالي المهام</span><strong>{stats.total}</strong><small>جميع المهام الظاهرة لك</small></article>
            <article className="stat-card violet"><span>New / WIP · جديدة / قيد العمل</span><strong>{stats.new}</strong><small>جديدة أو قيد التنفيذ</small></article>
            <article className="stat-card blue"><span>Pending Review · بانتظار المراجعة</span><strong>{stats.pending}</strong><small>قيد مراجعة المسؤول</small></article>
            <article className="stat-card amber"><span>Returned · مُعادة</span><strong>{stats.returned}</strong><small>تحتاج إجراء من الموظف</small></article>
            <article className="stat-card green"><span>Approved · معتمدة</span><strong>{stats.approved}</strong><small>تم اعتمادها من المسؤول</small></article>
          </section>
          <TaskTable loading={loading} tasks={filteredTasks} filteredCount={filteredTasks.length} tab={tab} employees={employeeOptions} users={users} projects={projectCodes} search={search} employeeFilter={employeeFilter} projectFilter={projectFilter} statusFilter={statusFilter} reviewFilter={reviewFilter} dueDateFilter={dueDateFilter} disciplineFilter={disciplineFilter} showEmployeeFilter={currentUser?.role !== "member"} showDisciplineColumn={currentUser?.role === "owner" || currentUser?.role === "manager"} setSearch={setSearch} setEmployeeFilter={setEmployeeFilter} setProjectFilter={setProjectFilter} setStatusFilter={setStatusFilter} setReviewFilter={setReviewFilter} setDueDateFilter={setDueDateFilter} setDisciplineFilter={setDisciplineFilter} openTask={openTask} showAll={() => setTab("tasks")} timeEntries={timeEntries} clock={clock} commentCounts={taskCommentCounts} detailsLoadedTaskIds={taskDetailsLoadedIds} subtasks={subtasks} attachments={taskAttachments} issueLinks={taskIssueLinks} openIssue={openLinkedIssue} currentUser={currentUser} completionSavingTaskId={completionSavingTaskId} updateCompletion={updateTaskCompletion} />
        </>}

        {tab === "rfi" && <section className="panel module-placeholder">
          <div className="module-icon">{tab === "rfi" ? "RFI" : "!"}</div>
          <p>{tab === "rfi" ? "REQUEST FOR INFORMATION" : "PROJECT ISSUES"}</p>
          <h2>{tab === "rfi" ? "بوابة طلبات المعلومات" : "سجل مشاكل المشاريع"}</h2>
          <span>تمت إضافة الوحدة إلى النظام، وسيتم استكمال الحقول ومسار العمل في المرحلة التالية.</span>
          <div className="module-status">جاهزة لإضافة التفاصيل · Ready for configuration</div>
        </section>}

        {tab === "issues" && currentUser && <IssuesModule ref={issuesModuleRef} currentUser={currentUser} users={users} projects={projects} onTaskCreated={(task) => setTasks((current) => [task as Task, ...current])} onIssueChanged={syncIssueLink} onOpenTask={(id) => void openLinkedTask(id)} onOpenProjectSettings={(project) => openProjectFromTask(project as Project)} onToast={setToast} />}

        {tab === "projects" && !selectedProject && <section className="panel projects-panel">
          <div className="directory-filters project-filter-row"><label className="search-box directory-search"><span>⌕</span><input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Search project..." aria-label="Search project" /></label><select value={projectStatusFilter} onChange={(event) => setProjectStatusFilter(event.target.value)} aria-label="فلترة المشاريع حسب الحالة"><option value="all">كل حالات المشاريع · All statuses</option>{Object.entries(projectStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="clear-filters-button" disabled={!projectSearch.trim() && projectStatusFilter === "all"} onClick={() => { setProjectSearch(""); setProjectStatusFilter("all"); }} aria-label="Clear all project filters" title="Clear filters"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{filteredProjectRows.length} {filteredProjectRows.length === 1 ? "Project" : "Projects"}</span><div className="view-switcher" role="group" aria-label="Project display style"><button type="button" className={projectView === "cards" ? "active" : ""} onClick={() => setProjectView("cards")} title="Cards view" aria-label="Cards view">▦</button><button type="button" className={projectView === "table" ? "active" : ""} onClick={() => setProjectView("table")} title="Table view" aria-label="Table view">☷</button></div></div>
          {filteredProjectRows.length === 0 ? <div className="empty-state"><strong>{projectRows.length ? "لا توجد مشاريع مطابقة" : "لا توجد مشاريع بعد"}</strong><p>{projectRows.length ? "غيّر البحث أو حالة المشروع لعرض نتائج أخرى." : "أضف أول مشروع لبدء تنظيم مهام الفريق."}</p></div> : projectView === "cards" ? <div className="project-grid directory-project-grid">{filteredProjectRows.map((project) => <button className="project-card directory-project-card" key={project.id} onClick={() => openProjectWorkspace(project.code)}><div className="project-card-head"><span className="project-table-identity"><span className="project-name-live"><strong>{project.name}</strong>{projectLiveIndicators(project.code)}</span><small className="project-code">{project.code}</small></span>{isManagement(currentUser) && <span role="button" tabIndex={0} className="project-settings-button" onClick={(event) => { event.stopPropagation(); openProject(project); }}>⚙</span>}</div><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status]}</span><div className="project-card-progress"><span>Progress</span><strong>{project.progress}%</strong><progress max="100" value={project.progress} /></div><div className="project-card-metrics"><span><strong>{project.total}</strong> Tasks</span><span><strong>{project.totalIssues}</strong> Issues</span><span><strong>{project.memberEmails.length}</strong> Team</span></div><small>{project.client || "No client"} · {formatDate(project.targetDate)}</small></button>)}</div> : <div className="task-table-wrap directory-table-wrap"><table className="task-table directory-table project-management-table"><thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Progress</th><th>Tasks</th><th>Issues</th><th>RFI</th><th>Team</th><th>Target</th><th className="project-settings-column">Setting</th></tr></thead><tbody>{filteredProjectRows.map((project) => <tr key={project.id} onClick={() => openProjectWorkspace(project.code)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProjectWorkspace(project.code); }}><td><span className="project-table-identity"><span className="project-name-live"><strong>{project.name}</strong>{projectLiveIndicators(project.code)}</span><small className="project-code">{project.code}</small></span></td><td>{project.client || "—"}</td><td><span className={`project-status ${project.status}`}>{projectStatusLabel[project.status]}</span></td><td><strong>{project.progress}%</strong></td><td><span className="project-record-count"><strong>{project.total}</strong><small className="project-review-counts">New {project.reviewNew} · Pending {project.reviewPending}<br />Approved {project.reviewApproved} · Returned {project.reviewReturned}</small></span></td><td><span className="project-record-count"><strong>{project.totalIssues}</strong><small>{project.closedIssues} closed</small></span></td><td><span className="project-record-count"><strong>{project.totalRfi}</strong><small>{project.closedRfi} closed</small></span></td><td>{project.memberEmails.length}</td><td>{formatDate(project.targetDate)}</td><td className="project-settings-column">{isManagement(currentUser) ? <button type="button" className="project-settings-button" onClick={(event) => { event.stopPropagation(); openProject(project); }} onKeyDown={(event) => event.stopPropagation()} aria-label={`Edit ${project.name}`} title="Project settings">⚙</button> : <span>—</span>}</td></tr>)}</tbody></table></div>}
        </section>}

        {tab === "team" && <section className="panel team-panel">
          <div className="directory-filters team-filter-row"><label className="search-box directory-search"><span>⌕</span><input value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Search employee..." aria-label="Search employee" /></label><select value={teamDisciplineFilter} onChange={(event) => setTeamDisciplineFilter(event.target.value)} aria-label="فلترة الفريق حسب التخصص"><option value="all">كل التخصصات · All disciplines</option>{disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select><select value={teamRoleFilter} onChange={(event) => setTeamRoleFilter(event.target.value)} aria-label="فلترة الفريق حسب المسؤولية"><option value="all">كل المسؤوليات · All roles</option><option value="member">Member · موظف</option><option value="manager">Manager · مسؤول</option><option value="owner">Owner · مالك</option></select><button type="button" className="clear-filters-button" disabled={!teamSearch.trim() && teamDisciplineFilter === "all" && teamRoleFilter === "all"} onClick={() => { setTeamSearch(""); setTeamDisciplineFilter("all"); setTeamRoleFilter("all"); }} aria-label="Clear all team filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{filteredTeamRows.length} {filteredTeamRows.length === 1 ? "Employee" : "Employees"}</span><div className="view-switcher" role="group" aria-label="Team display style"><button type="button" className={teamView === "cards" ? "active" : ""} onClick={() => setTeamView("cards")} title="Cards view" aria-label="Cards view">▦</button><button type="button" className={teamView === "table" ? "active" : ""} onClick={() => setTeamView("table")} title="Table view" aria-label="Table view">☷</button></div></div>
          {filteredTeamRows.length === 0 ? <div className="empty-state"><strong>لا يوجد موظفون مطابقون</strong><p>غيّر البحث أو التخصص أو المسؤولية لعرض نتائج أخرى.</p></div> : teamView === "cards" ? <div className="team-grid">{filteredTeamRows.map((row) => <button className="team-card" key={row.email} onClick={() => openUser(row)}>
            <div className="team-card-head"><UserAvatar user={row} name={row.displayName} className="soft" /><div><strong>{row.displayName}</strong><span>{roleLabel(row.role)}</span></div>{row.temporary && <em className="temporary-badge">مؤقت</em>}</div>
            <div className={`discipline-badge${row.discipline ? "" : " unset"}`}>{row.discipline || "غير محدد · Not specified"}</div>
            <div className="team-metrics"><div><span>المهام</span><strong>{row.total}</strong></div><div><span>مكتمل</span><strong>{row.done}</strong></div><div><span>متابعة</span><strong className={row.attention ? "warn-text" : ""}>{row.attention}</strong></div><div><span>فعلي</span><strong>{row.actual.toFixed(1)}h</strong></div></div>
            <div className="employee-email">{row.temporary ? "سيتم ربط البريد عند النقل" : row.email}</div>
          </button>)}</div> : <div className="task-table-wrap directory-table-wrap"><table className="task-table directory-table team-management-table"><thead><tr><th>Employee</th><th>Role</th><th>Discipline</th><th>Email</th><th>Tasks</th><th>Done</th><th>Attention</th><th>Actual</th><th className="team-settings-column">Setting</th></tr></thead><tbody>{filteredTeamRows.map((row) => <tr key={row.email} onClick={() => setEmployeeTasksEmail(row.email)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEmployeeTasksEmail(row.email); } }} aria-label={`Show ${row.displayName} tasks`}><td><div className="employee-cell employee-summary-trigger" title="Show employee tasks"><UserAvatar user={row} name={row.displayName} /><strong>{row.displayName}</strong></div></td><td>{roleLabel(row.role)}</td><td>{row.discipline || "—"}</td><td dir="ltr">{row.temporary ? "Temporary account" : row.email}</td><td>{row.total}</td><td>{row.done}</td><td><strong className={row.attention ? "warn-text" : ""}>{row.attention}</strong></td><td>{row.actual.toFixed(1)}h</td><td className="team-settings-column"><button type="button" className="project-settings-button team-settings-button" onClick={(event) => { event.stopPropagation(); openUser(row); }} onKeyDown={(event) => event.stopPropagation()} aria-label={`Edit ${row.displayName}`} title="Employee settings">⚙</button></td></tr>)}</tbody></table></div>}
        </section>}

        {tab === "activity" && currentUser?.role === "owner" && <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>Activity Log</h2><p>سجل شامل للإنشاء والتعديل والحذف وجميع العمليات في التطبيق</p></div><div className="activity-heading-actions"><button className="activity-icon-button activity-excel-icon" onClick={() => void exportActivityExcel()} disabled={activityLoading || activityExportBusy || activity.length === 0} aria-label={activityExportBusy ? "Preparing Activity Log Excel" : "Download Activity Log Excel"} title="Download Excel"><ActionIcon kind="excel" /></button><button className="activity-icon-button activity-refresh-icon" onClick={() => void openActivityLog()} disabled={activityLoading} aria-label={activityLoading ? "Refreshing Activity Log" : "Refresh Activity Log"} title="Refresh"><ActionIcon kind="refresh" /></button></div></div>
          {activityLoading ? <div className="loading-state"><div className="spinner" /><p>Loading activity...</p></div> : activity.length === 0 ? <div className="empty-state"><strong>No recorded activity</strong><p>لا توجد عمليات مسجلة حتى الآن.</p></div> : <div className="task-table-wrap"><table className="task-table activity-table"><thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Type</th><th>Item</th><th>Project</th><th>Details</th></tr></thead><tbody>{activity.map((entry) => <tr key={entry.id}><td dir="ltr">{formatDateTime(entry.createdAt)}</td><td><strong>{entry.actorName}</strong><small>{entry.actorEmail}</small></td><td><span className={`activity-action action-${entry.action}`}>{entry.action.replaceAll("_", " ")}</span></td><td>{({ task: "Task · مهمة", issue: "Issue · مشكلة", project: "Project · مشروع", user: "User · مستخدم", account: "Account · حساب", backup: "Backup · نسخة احتياطية", notification: "Notification · إشعار" } as Record<string, string>)[entry.entityType] || entry.entityType}</td><td>{entry.entityId && entry.action !== "deleted" && (entry.entityType === "task" || entry.entityType === "issue") ? <button className="activity-link" onClick={() => { if (entry.entityType === "task") void openLinkedTask(entry.entityId!); else { setTab("issues"); window.setTimeout(() => issuesModuleRef.current?.openIssue(entry.entityId!), 150); } }}>{entry.entityLabel}</button> : <strong>{entry.entityLabel}</strong>}</td><td><span className="project-code">{entry.projectCode || "—"}</span></td><td>{entry.details || "—"}</td></tr>)}</tbody></table></div>}
        </section>}

        {tab === "reports" && <div className="reports-workspace"><div className="report-type-selector" role="tablist" aria-label="Report type"><button className={reportType === "tasks" ? "active" : ""} onClick={() => setReportType("tasks")} aria-label="Open Task Report"><span className="report-type-icon" aria-hidden="true">✓</span><span>Task Report</span></button><button className={reportType === "issues" ? "active" : ""} onClick={() => setReportType("issues")} aria-label="Open Project Issues Report"><span className="report-type-icon" aria-hidden="true">!</span><span>Project Issues</span></button><button className={reportType === "rfi" ? "active" : ""} onClick={() => setReportType("rfi")} aria-label="Open RFI Report"><span className="report-type-icon" aria-hidden="true">?</span><span>RFI</span></button></div>
        {reportType === "tasks" && <section className="report-layout">
          <div className="panel report-controls"><div className="panel-heading"><div><h2>Task Report Settings</h2></div></div>
            <div className="report-filter-grid">
              <label><span>Calendar Period</span><select value={reportPeriod} onChange={(event) => { setReportPeriod(event.target.value as "week" | "month" | "custom"); setReportScope("all"); }}><option value="week">Week</option><option value="month">Month</option><option value="custom">Custom Range</option></select></label>
              {reportPeriod !== "custom" ? <label><span>{reportPeriod === "week" ? "Select Week" : "Select Month"}</span><input type={reportPeriod === "week" ? "week" : "month"} value={reportPeriod === "week" ? (() => { const start = new Date(`${range.start}T12:00:00`); const firstThursday = new Date(start); firstThursday.setDate(start.getDate() + 4 - (start.getDay() || 7)); const yearStart = new Date(firstThursday.getFullYear(), 0, 1); const week = Math.ceil((((firstThursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7); return `${firstThursday.getFullYear()}-W${String(week).padStart(2, "0")}`; })() : reportAnchor.slice(0, 7)} onChange={(event) => changeReportCalendar(event.currentTarget.value)} /></label> : <><label><span>From</span><input type="date" value={reportCustomStart} onChange={(event) => setReportCustomStart(event.target.value)} /></label><label><span>To</span><input type="date" min={reportCustomStart || undefined} value={reportCustomEnd} onChange={(event) => setReportCustomEnd(event.target.value)} /></label></>}
              <label><span>Group By</span><select value={reportGroup} onChange={(event) => { setReportGroup(event.target.value as "project" | "employee"); setReportScope("all"); }}><option value="project">Project</option><option value="employee">Employee</option></select></label>
              <label><span>{reportGroup === "project" ? "Project" : "Employee"}</span><select value={reportScope} onChange={(event) => setReportScope(event.target.value)}><option value="all">All</option>{reportGroup === "project" ? projectCodes.map((code) => <option key={code} value={code}>{projects.find((project) => project.code === code)?.name || code}</option>) : reportEmployees.map((employeeName) => <option key={employeeName} value={employeeName}>{employeeName}</option>)}</select></label>
            </div>
            {reportPeriod !== "custom" ? <div className="period-nav"><button type="button" onClick={() => moveReport(-1)}>← Previous</button><div><strong>{formatDate(range.start)} — {formatDate(range.end)}</strong><small>{reportPeriodLabel}</small></div><button type="button" onClick={() => moveReport(1)}>Next →</button></div> : <div className="report-range-summary"><strong>{formatDate(range.start)} — {formatDate(range.end)}</strong></div>}
            <div className="export-actions"><button className="report-download-icon-button excel-button" onClick={exportExcel} disabled={!reportRows.length} aria-label="Download Excel report" title="Download Excel"><ActionIcon kind="excel" /></button><button className="report-download-icon-button pdf-button" onClick={exportPdf} disabled={!reportRows.length} aria-label="Download PDF report" title="Download PDF"><ActionIcon kind="pdf" /></button></div>
          </div>
          <div className="report-content">
            <section className="report-stats report-filter-stats"><button type="button" onClick={() => openReportTasks("all")}><span>All Tasks</span><strong>{reportSummary.total}</strong></button><button type="button" onClick={() => openReportTasks("approved")}><span>Manager Approved</span><strong>{reportSummary.approved}</strong></button><button type="button" onClick={() => openReportTasks("wip")}><span>WIP</span><strong>{reportSummary.wip}</strong></button><button type="button" onClick={() => openReportTasks("pending")}><span>Needs Review</span><strong>{reportSummary.pending}</strong></button></section>
            <section className="panel chart-panel"><div className="panel-heading"><div><h2>{reportGroup === "project" ? "Project Task Review" : "Employee Task Review"}</h2></div><span className="count-badge">{displayedReportRows.length} groups</span></div>
              {displayedReportRows.length === 0 ? <div className="empty-state"><strong>No data for this filter</strong><p>Change the calendar period or selected scope.</p></div> : <div className="bar-chart">{displayedReportRows.map((row) => <div className="bar-chart-row report-clickable-row" key={row.key} role="button" tabIndex={0} onClick={() => openReportRow(row.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openReportRow(row.key); }}><strong title={row.label}>{row.label}<small className="report-project-count">({reportGroup === "project" ? `${row.employeeCount} employees` : `${row.projectCount} projects`})</small></strong><div className="bar-track report-review-track"><i className="bar-approved" style={{ width: `${(row.approved / row.total) * 100}%` }}>{row.approved > 0 && <b>{row.approved}</b>}</i><i className="bar-wip" style={{ width: `${(row.wip / row.total) * 100}%` }}>{row.wip > 0 && <b>{row.wip}</b>}</i><i className="bar-pending" style={{ width: `${(row.pending / row.total) * 100}%` }}>{row.pending > 0 && <b>{row.pending}</b>}</i><i className="bar-returned" style={{ width: `${(row.returned / row.total) * 100}%` }}>{row.returned > 0 && <b>{row.returned}</b>}</i></div><span>{row.total}</span></div>)}<div className="chart-legend"><span><i className="legend-approved" />Manager Approved</span><span><i className="legend-wip" />WIP</span><span><i className="legend-pending" />Needs Review</span><span><i className="legend-returned" />Returned</span></div></div>}
            </section>
          </div>
          {customRangeInvalid && <div className="report-date-warning" role="alert">To date must be the same as or after From date.</div>}
        </section>}
        {reportType === "issues" && <IssueReportPanel projects={projects} onProjectSettings={(issueProject) => { const project = projects.find((item) => item.code === issueProject.code); if (project) openReportProjectSettings(project); }} onOpenIssue={(id, projectCode) => { openProjectWorkspace(projectCode, "issues"); window.setTimeout(() => issuesModuleRef.current?.openIssue(id), 180); }} />}
        {reportType === "rfi" && <section className="panel module-placeholder report-rfi-placeholder"><div className="module-icon">RFI</div><p>REQUEST FOR INFORMATION</p><h2>RFI Report</h2><span>The RFI report will be available when the RFI module is enabled.</span></section>}
        </div>}
      </main>

      {projectRemovalWarning && <div className="drawer-layer dependency-warning-layer" role="dialog" aria-modal="true" aria-label="Project deletion blocked"><button className="drawer-backdrop" onClick={() => setProjectRemovalWarning(null)} aria-label="Close warning" /><section className="dependency-warning-dialog project-dependency-warning"><div className="dependency-warning-icon">!</div><h2>Project cannot be deleted</h2><h3>لا يمكن حذف المشروع حاليًا</h3><p><strong>{projectRemovalWarning.projectCode} · {projectRemovalWarning.projectName}</strong> still contains linked records. Remove all items below, then try deleting the project again.</p><p dir="rtl">يحتوي المشروع على بيانات مرتبطة. يجب إزالة جميع العناصر التالية أولًا ثم إعادة محاولة الحذف.</p><div className="project-dependency-counts"><div><strong>{projectRemovalWarning.dependencies.tasks}</strong><span>Tasks</span><small>مهام</small></div><div><strong>{projectRemovalWarning.dependencies.issues}</strong><span>Issues</span><small>مشاكل</small></div><div><strong>{projectRemovalWarning.dependencies.team}</strong><span>Team</span><small>أعضاء الفريق</small></div><div><strong>{projectRemovalWarning.dependencies.rfi}</strong><span>RFI</span><small>طلبات معلومات</small></div></div><div className="project-dependency-note">Only an empty project can be deleted · يمكن حذف المشروع فقط عندما يكون فارغًا بالكامل</div><button className="secondary-button dependency-close" onClick={() => setProjectRemovalWarning(null)}><ButtonLabel en="Close" ar="إغلاق" /></button></section></div>}

      {userRemovalWarning && <div className="drawer-layer dependency-warning-layer" role="dialog" aria-modal="true" aria-label="Employee assigned tasks warning"><button className="drawer-backdrop" onClick={() => setUserRemovalWarning(null)} aria-label="Close warning" /><section className="dependency-warning-dialog"><div className="dependency-warning-icon">!</div><h2>Employee has assigned tasks</h2><h3>لدى الموظف مهام موكلة إليه</h3><p><strong>{userRemovalWarning.employeeName}</strong> has {userRemovalWarning.taskCount} assigned task(s). Reassign these tasks before deleting the employee.</p><p dir="rtl">يجب تغيير الموظف المسؤول عن هذه المهام قبل حذف الموظف من النظام.</p><div className="dependency-project-links">{userRemovalWarning.projects.map((item) => <button key={item.project} onClick={() => reviewEmployeeTasks(userRemovalWarning.employeeName, item.project)}><span>↗</span><strong>Open {item.project} tasks</strong><small>{item.taskCount} tasks</small></button>)}</div><button className="secondary-button dependency-close" onClick={() => setUserRemovalWarning(null)}><ButtonLabel en="Cancel" ar="إلغاء" /></button></section></div>}
      {reportDialogMetric && <ReportTasksDialog metric={reportDialogMetric} groupBy={reportGroup} tasks={reportDialogTasks} projects={projects} users={users} timeEntries={timeEntries} clock={clock} currentUser={currentUser} updateCompletion={updateTaskCompletion} completionSavingTaskId={completionSavingTaskId} onClose={closeReportTasks} onOpenTask={openReportTask} />}
      {reportRowKey && <ReportTasksDialog metric="all" title={reportGroup === "project" ? projects.find((project) => project.code === reportRowKey)?.name || reportRowKey : reportRowKey} groupBy="project" tasks={reportRowTasks} projects={projects} users={users} timeEntries={timeEntries} clock={clock} currentUser={currentUser} updateCompletion={updateTaskCompletion} completionSavingTaskId={completionSavingTaskId} projectCode={reportGroup === "project" ? reportRowKey : ""} employee={reportGroup === "employee" ? users.find((user) => user.displayName === reportRowKey) || null : null} hideEmployeeColumn={reportGroup === "employee"} onOpenProject={openReportProjectTasks} onProjectSettings={openReportProjectSettings} onEmployeeSettings={openReportEmployeeSettings} onClose={closeReportRow} onOpenTask={openReportTask} />}
      {employeeTasksEmail && <EmployeeTasksDialog employee={users.find((user) => user.email === employeeTasksEmail) || null} tasks={tasks.filter((task) => task.employeeEmail === employeeTasksEmail)} projects={projects} timeEntries={timeEntries} clock={clock} currentUser={currentUser} updateCompletion={updateTaskCompletion} completionSavingTaskId={completionSavingTaskId} onClose={() => setEmployeeTasksEmail(null)} onOpenTask={openEmployeeTask} onEditEmployee={openUserFromEmployeeTasks} />}
      {taskDrawerOpen && <TaskDrawer selectedId={selectedTaskId} form={taskForm} setOpen={setTaskDrawerOpen} saveTask={saveTask} deleteTask={deleteTask} saving={saving} currentUser={currentUser} users={users} projects={tab === "projects" && selectedProject ? [selectedProject] : projects} openProjectSettings={openProjectFromTask} updateForm={updateTaskForm} comments={comments.filter((comment) => comment.taskId === selectedTaskId)} commentDraft={commentDraft} setCommentDraft={setCommentDraft} addComment={addComment} updateComment={updateComment} deleteComment={deleteComment} savingComment={savingComment} task={tasks.find((task) => task.id === selectedTaskId) || null} timeEntries={timeEntries.filter((entry) => entry.taskId === selectedTaskId)} clock={clock} updateTimer={updateTimer} updateCompletion={updateTaskCompletion} completionSavingTaskId={completionSavingTaskId} updateWorkSession={updateWorkSession} deleteWorkSession={deleteWorkSession} savingTimer={savingTimer} submitPrivateTask={submitPrivateTask} subtasks={subtasks.filter((subtask) => subtask.taskId === selectedTaskId)} draftSubtasks={draftSubtasks} updateDraftSubtask={updateDraftSubtask} deleteDraftSubtask={deleteDraftSubtask} subtaskDraft={subtaskDraft} setSubtaskDraft={setSubtaskDraft} addSubtask={addSubtask} toggleSubtask={toggleSubtask} updateSubtaskTitle={updateSubtaskTitle} deleteSubtask={deleteSubtask} subtaskBusy={subtaskBusy} attachments={taskAttachments.filter((attachment) => attachment.taskId === selectedTaskId)} draftAttachments={draftTaskAttachments} addDraftAttachments={addDraftTaskAttachments} deleteDraftAttachment={deleteDraftTaskAttachment} uploadAttachment={uploadTaskAttachment} deleteAttachment={deleteTaskAttachment} attachmentBusy={taskAttachmentBusy} attachmentProgress={taskAttachmentProgress} issueLink={taskIssueLinks.find((link) => link.convertedTaskId === selectedTaskId) || null} onOpenIssue={(link) => { setTaskDrawerOpen(false); setSelectedTaskId(null); window.setTimeout(() => openLinkedIssue(link), 0); }} onIssueCreated={syncIssueLink} />}
      {projectDrawerOpen && <ProjectDrawer selectedId={selectedProjectId} form={projectForm} setForm={setProjectForm} setOpen={(open) => { if (!open && (projectDrawerReturnToReport || projectDrawerReturnToUserEmail)) { window.history.back(); return; } setProjectDrawerOpen(open); if (!open) { setProjectDrawerReturnToTask(false); setProjectDrawerReturnToReport(false); setProjectDrawerReturnToUserEmail(null); } }} saveProject={saveProject} deleteProject={deleteProject} saving={saving} users={users} tasks={tasks} currentUser={currentUser} projectCode={projects.find((project) => project.id === selectedProjectId)?.code || projectForm.code} onResolveMemberTasks={reviewMemberProjectTasks} onEditUser={openUserFromProject} />}
      {userDrawerOpen && <UserDrawer selectedEmail={selectedUserEmail} selectedUser={users.find((user) => user.email === selectedUserEmail) || null} form={userForm} setForm={setUserForm} setOpen={(open) => { if (!open && (userDrawerReturnToEmployeeTasks || userDrawerReturnToReport)) { window.history.back(); return; } setUserDrawerOpen(open); if (!open) { setUserDrawerReturnToProject(false); setUserDrawerReturnToEmployeeTasks(null); setUserDrawerReturnToReport(false); if (window.history.state?.hindazaUserEdit) window.history.replaceState({ ...window.history.state, hindazaUserEdit: null, hindazaUserProjectEdit: null }, "", window.location.href); } }} saveUser={saveUser} deleteUser={deleteUser} saving={saving} currentUser={currentUser} projects={projects} onProjectSettings={openProjectFromUser} onProfileImageChange={(email, profileImageKey) => { setUsers((current) => current.map((user) => user.email === email ? { ...user, profileImageKey } : user)); setCurrentUser((current) => current?.email === email ? { ...current, profileImageKey } : current); }} />}
      {passwordDrawerOpen && <PasswordDrawer form={passwordForm} setForm={setPasswordForm} setOpen={setPasswordDrawerOpen} changePassword={changePassword} saving={saving} />}
      {confirmDialog}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

function ReportTasksDialog({ metric, title, groupBy, tasks, projects, users, timeEntries, clock, currentUser, updateCompletion, completionSavingTaskId, projectCode = "", employee = null, hideEmployeeColumn = false, onOpenProject, onProjectSettings, onEmployeeSettings, onClose, onOpenTask }: { metric: ReportMetric; title?: string; groupBy: "project" | "employee"; tasks: Task[]; projects: Project[]; users: User[]; timeEntries: TaskTimeEntry[]; clock: number; currentUser: User | null; updateCompletion: (taskId: number, completionPercent: number) => void; completionSavingTaskId: number | null; projectCode?: string; employee?: User | null; hideEmployeeColumn?: boolean; onOpenProject?: (projectCode: string) => void; onProjectSettings?: (project: Project) => void; onEmployeeSettings?: (user: User) => void; onClose: () => void; onOpenTask: (task: Task) => void; }) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [dueDateFilter, setDueDateFilter] = useState("");
  const groupsRef = useRef<HTMLDivElement>(null);
  const labels: Record<ReportMetric, string> = { all: "All Tasks", approved: "Manager Approved", wip: "WIP", pending: "Needs Review" };
  const dialogTitle = title || labels[metric];
  const dialogProject = projects.find((project) => project.code === projectCode);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const employeeNames = useMemo(() => Array.from(new Set(tasks.map((task) => task.employeeName).filter(Boolean))).sort(), [tasks]);
  const taskDisciplines = useMemo(() => Array.from(new Set(tasks.map((task) => task.employeeDiscipline).filter(Boolean))).sort(), [tasks]);
  const timeEntriesByTaskId = useMemo(() => rowsByTaskId(timeEntries), [timeEntries]);
  const activeTaskIds = useMemo(() => new Set(timeEntries.filter((entry) => !entry.endedAt).map((entry) => entry.taskId)), [timeEntries]);
  const visibleTasks = useMemo(() => tasks.filter((task) => (employeeFilter === "all" || task.employeeName === employeeFilter) && (statusFilter === "all" || task.status === statusFilter) && (reviewFilter === "all" || task.managerCheck === reviewFilter) && (disciplineFilter === "all" || task.employeeDiscipline === disciplineFilter) && (!dueDateFilter || task.taskDate === dueDateFilter)), [tasks, employeeFilter, statusFilter, reviewFilter, disciplineFilter, dueDateFilter]);
  const groups = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    visibleTasks.forEach((task) => {
      const key = groupBy === "project" ? task.project : task.employeeName;
      grouped.set(key, [...(grouped.get(key) || []), task]);
    });
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [visibleTasks, groupBy]);
  const toggleGroup = (key: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const outer = groupsRef.current;
    if (!outer || !event.deltaY) return;
    const target = event.target as HTMLElement;
    const inner = target.closest(".employee-task-table-wrap.has-more-tasks") as HTMLElement | null;
    let remaining = event.deltaY;
    if (inner) {
      const available = event.deltaY > 0 ? Math.max(0, inner.scrollHeight - inner.clientHeight - inner.scrollTop) : Math.max(0, inner.scrollTop);
      const consumed = Math.min(Math.abs(event.deltaY), available);
      inner.scrollTop += Math.sign(event.deltaY) * consumed;
      remaining = Math.sign(event.deltaY) * (Math.abs(event.deltaY) - consumed);
    }
    event.preventDefault();
    if (remaining) outer.scrollTop += remaining;
  };
  const printReportTasks = () => {
    const popup = window.open("", "_blank", "width=1200,height=820");
    if (!popup) return;
    const printedGroups = groups.map(([key, groupTasks]) => {
      const project = groupBy === "project" ? projects.find((item) => item.code === key) : null;
      const employee = groupBy === "employee" ? users.find((item) => item.displayName === key) : null;
      const heading = groupBy === "project" ? project?.name || key : employee?.displayName || key;
      const subheading = groupBy === "project" ? key : employee?.discipline || "Employee";
      const rows = groupTasks.map((task) => {
        const logged = taskLoggedHours(task, timeEntriesByTaskId.get(task.id) || [], clock);
        const flag = taskFlag(task);
        return `<tr><td><strong>${escapeXml(task.title)}</strong><small>${escapeXml(task.expectedOutput || "—")}</small></td>${hideEmployeeColumn ? "" : `<td>${escapeXml(task.employeeName || "Unassigned")}</td>`}<td>${escapeXml(task.createdByName || "Unknown user")}</td><td>${escapeXml(formatCreatedDate(task.createdAt))}</td><td>${escapeXml(formatDueDate(task.taskDate))}</td><td>${escapeXml(tableStatusLabel[task.status])}</td><td>${escapeXml(tableCheckLabel[task.managerCheck])}</td><td>${logged ? `${logged.toFixed(2)}h` : "—"}</td><td>${flag.label}</td></tr>`;
      }).join("");
      return `<section class="group"><header><div><strong>${escapeXml(heading)}</strong><small>${escapeXml(subheading)}</small></div><b>${groupTasks.length}</b></header><table><thead><tr><th>Task</th>${hideEmployeeColumn ? "" : "<th>Employee</th>"}<th>Created By</th><th>Created Date</th><th>Due Date</th><th>Status</th><th>Manager Review</th><th>Hours</th><th>Indicator</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    }).join("");
    popup.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>${escapeXml(dialogTitle)} - HINDAZA</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;font-family:Arial,Tahoma,sans-serif;color:#1d1d1d}.head{display:flex;align-items:center;justify-content:space-between;gap:22px;padding-bottom:13px;border-bottom:4px solid #ffd200}.logo{width:220px;max-height:76px;object-fit:contain;object-position:left center}.meta{text-align:right}.meta p{margin:0 0 4px;color:#8b6c00;font-size:9px;letter-spacing:.14em}.meta h1{margin:0;font-size:22px}.meta span{display:block;margin-top:5px;color:#6e777b;font-size:9px}.group{margin:14px 0;border:1px solid #d9d9d3;border-radius:9px;overflow:hidden;break-inside:avoid}.group>header{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#fffbed}.group>header strong,.group>header small{display:block}.group>header small{margin-top:3px;color:#8a6e00;font-size:8px}.group>header b{min-width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#ffd200;font-size:9px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:7px;border-top:1px solid #e5e5e0;text-align:left;font-size:8px;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f3f1;color:#667278;font-size:7px}th:nth-child(1){width:24%}th:nth-child(2),th:nth-child(3){width:12%}th:nth-child(4),th:nth-child(5){width:10%}th:nth-child(6),th:nth-child(7){width:11%}th:nth-child(8),th:nth-child(9){width:8%}td strong,td small{display:block}td small{margin-top:3px;color:#818b90}.footer{margin-top:18px;padding-top:8px;border-top:1px solid #ddd;color:#81898d;font-size:8px}</style></head><body><div class="head"><img class="logo" src="/report-logo.png" alt="HINDAZA"><div class="meta"><p>REPORT TASKS</p><h1>${escapeXml(dialogTitle)}</h1><span>${visibleTasks.length} filtered tasks · Grouped by ${groupBy}</span></div></div>${printedGroups || '<div class="group"><header>No tasks match this report filter.</header></div>'}<div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  };
  return <div className="drawer-layer employee-tasks-layer report-tasks-layer" role="dialog" aria-modal="true" aria-label={`${dialogTitle} report tasks`}>
    <button className="drawer-backdrop" onClick={onClose} aria-label="Close report tasks" />
    <section className={`employee-tasks-dialog report-tasks-dialog${hideEmployeeColumn ? " employee-specific-report" : ""}`}>
      <header><div className={employee ? "employee-cell" : "report-dialog-heading"}>{employee && <UserAvatar user={employee} name={employee.displayName} className="employee-dialog-avatar" />}<div className="report-dialog-heading"><p>REPORT TASKS</p><h2>{dialogTitle}</h2><span>{visibleTasks.length} of {tasks.length} tasks</span></div></div><div className="employee-tasks-header-actions">{employee && onEmployeeSettings && <button type="button" className="employee-tasks-settings" onClick={() => onEmployeeSettings(employee)} aria-label={`Edit ${employee.displayName}`} title="Employee settings">⚙</button>}{dialogProject && onProjectSettings && <button type="button" className="employee-tasks-settings" onClick={() => onProjectSettings(dialogProject)} aria-label={`Edit ${dialogProject.name}`} title="Project settings">⚙</button>}<button type="button" className="employee-tasks-print" onClick={printReportTasks} aria-label="Print report tasks as PDF" title="Print / Save as PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 13h10v8H7z" /><path d="M17.5 11h.01" /></svg></button><button type="button" className="employee-tasks-close" onClick={onClose} aria-label="Close">×</button></div></header>
      <div className="report-dialog-filterbar">{!hideEmployeeColumn && <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} aria-label="Filter report tasks by employee"><option value="all">All Employees</option>{employeeNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter report tasks by status"><option value="all">All Statuses</option>{Object.entries(tableStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)} aria-label="Filter report tasks by manager review"><option value="all">All Manager Reviews</option>{Object.entries(tableCheckLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)} aria-label="Filter report tasks by discipline"><option value="all">All Disciplines</option>{taskDisciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select><label><span>Due Date</span><input type="date" value={dueDateFilter} onChange={(event) => setDueDateFilter(event.target.value)} /></label>{projectCode && onOpenProject && <button type="button" className="report-open-project-button" onClick={() => onOpenProject(projectCode)}>Open Project Tasks</button>}<small>Click a task row to open it. Use Back to return.</small></div>
      <div className={`employee-project-groups report-task-group-count-${Math.min(groups.length, 3)}`} ref={groupsRef} onWheel={handleWheel}><div className="employee-project-groups-content">{groups.length === 0 ? <div className="comments-empty">No tasks match this report filter.</div> : groups.map(([key, groupTasks]) => {
        const project = groupBy === "project" ? projects.find((item) => item.code === key) : null;
        const groupEmployee = groupBy === "employee" ? users.find((item) => item.displayName === key) : null;
        const collapsed = collapsedGroups.has(key);
        return <section className="employee-project-group" key={key}><button type="button" className={`employee-project-heading${employee && project && onProjectSettings ? " with-settings" : ""}`} onClick={() => toggleGroup(key)} aria-expanded={!collapsed}><span>{collapsed ? "+" : "−"}</span><div><strong>{groupBy === "project" ? project?.name || key : groupEmployee?.displayName || key}</strong><small>{groupBy === "project" ? key : groupEmployee?.discipline || "Employee"}</small></div><em>{groupTasks.length}</em>{employee && project && onProjectSettings && <span className="report-project-settings" role="button" tabIndex={0} title={`Project settings for ${project.name}`} aria-label={`Project settings for ${project.name}`} onClick={(event) => { event.stopPropagation(); onProjectSettings(project); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onProjectSettings(project); } }}>⚙</span>}</button>{!collapsed && <div className={`employee-task-table-wrap${groupTasks.length > 4 ? " has-more-tasks" : ""}`} tabIndex={groupTasks.length > 4 ? 0 : undefined}><table className="employee-task-table"><thead><tr><th>Task</th>{!hideEmployeeColumn && <th>Employee</th>}<th>Created By</th><th>Created Date</th><th>Due Date</th><th>Status</th><th>Manager Review</th><th>Hours</th><th>Indicator</th></tr></thead><tbody>{groupTasks.map((task) => {
          const taskEntries = timeEntriesByTaskId.get(task.id) || [];
          const logged = taskLoggedHours(task, taskEntries, clock);
          const active = task.status === "in_progress" || activeTaskIds.has(task.id);
          const flag = taskFlag(task);
          const href = `/?view=projects&project=${encodeURIComponent(task.project)}&section=tasks&task=${task.id}`;
          const openLink = (event: React.MouseEvent<HTMLAnchorElement>) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); onOpenTask(task); };
          const canEditProgress = canEditTaskCompletion(currentUser, task);
          return <tr className="employee-task-clickable-row" key={task.id} onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0 || (event.target as HTMLElement).closest("a, button, details")) return; onOpenTask(task); }}><td><div className="window-task-title-progress"><TaskProgressControl task={task} canEdit={canEditProgress} busy={completionSavingTaskId === task.id} onChange={(value) => updateCompletion(task.id, value)} /><a href={href} onClick={openLink}><span className="employee-task-title"><strong dir="auto">{task.title}</strong>{active && <i className="employee-task-live-pulse" title="Working now" aria-label="Working now" />}</span><small>{task.expectedOutput || "—"}</small></a></div></td>{!hideEmployeeColumn && <td><a href={href} onClick={openLink}>{task.employeeName || "Unassigned"}</a></td>}<td><a href={href} onClick={openLink}>{task.createdByName || "Unknown user"}</a></td><td dir="ltr"><a href={href} onClick={openLink}>{formatCreatedDate(task.createdAt)}</a></td><td dir="ltr"><a href={href} onClick={openLink}>{formatDueDate(task.taskDate)}</a></td><td><a href={href} onClick={openLink}><span className={`pill status-${task.status}`}>{tableStatusLabel[task.status]}</span></a></td><td><a href={href} onClick={openLink}><span className={`pill check-${task.managerCheck}`}>{tableCheckLabel[task.managerCheck]}</span></a></td><td><a href={href} onClick={openLink}>{logged ? `${logged.toFixed(2)}h` : "—"}</a></td><td><a href={href} onClick={openLink}><span className={`flag flag-${flag.key}`}>{flag.label}</span></a></td></tr>;
        })}</tbody></table></div>}</section>;
      })}</div></div>
    </section>
  </div>;
}

function EmployeeTasksDialog({ employee, tasks, projects, timeEntries, clock, currentUser, updateCompletion, completionSavingTaskId, onClose, onOpenTask, onEditEmployee }: { employee: User | null; tasks: Task[]; projects: Project[]; timeEntries: TaskTimeEntry[]; clock: number; currentUser: User | null; updateCompletion: (taskId: number, completionPercent: number) => void; completionSavingTaskId: number | null; onClose: () => void; onOpenTask: (task: Task) => void; onEditEmployee: (user: User) => void; }) {
  const [showAll, setShowAll] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const projectGroupsRef = useRef<HTMLDivElement>(null);
  const timeEntriesByTaskId = useMemo(() => rowsByTaskId(timeEntries), [timeEntries]);
  const activeTaskIds = useMemo(() => new Set(timeEntries.filter((entry) => !entry.endedAt).map((entry) => entry.taskId)), [timeEntries]);
  const visibleTasks = showAll ? tasks : tasks.filter((task) => task.managerCheck !== "approved");
  const groups = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    visibleTasks.forEach((task) => grouped.set(task.project, [...(grouped.get(task.project) || []), task]));
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [visibleTasks]);
  const toggleProject = (code: string) => setCollapsedProjects((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });
  const handleDialogWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const outer = projectGroupsRef.current;
    if (!outer || !event.deltaY) return;
    const target = event.target as HTMLElement;
    const projectScroller = target.closest(".employee-task-table-wrap.has-more-tasks") as HTMLElement | null;
    let remainingDelta = event.deltaY;
    if (projectScroller) {
      const available = event.deltaY > 0
        ? Math.max(0, projectScroller.scrollHeight - projectScroller.clientHeight - projectScroller.scrollTop)
        : Math.max(0, projectScroller.scrollTop);
      const consumed = Math.min(Math.abs(event.deltaY), available);
      projectScroller.scrollTop += Math.sign(event.deltaY) * consumed;
      remainingDelta = Math.sign(event.deltaY) * (Math.abs(event.deltaY) - consumed);
    }
    event.preventDefault();
    if (remainingDelta) outer.scrollTop += remainingDelta;
  };
  const printEmployeeTasks = () => {
    const popup = window.open("", "_blank", "width=1200,height=820");
    if (!popup) return;
    const printedGroups = groups.map(([projectCode, projectTasks]) => {
      const project = projects.find((item) => item.code === projectCode);
      const rows = projectTasks.map((task) => {
        const logged = taskLoggedHours(task, timeEntriesByTaskId.get(task.id) || [], clock);
        const flag = taskFlag(task);
        return `<tr><td><strong>${escapeXml(task.title)}</strong><small>${escapeXml(task.expectedOutput || "—")}</small></td><td>${escapeXml(task.createdByName || "Unknown user")}</td><td>${escapeXml(formatCreatedDate(task.createdAt))}</td><td>${escapeXml(formatDueDate(task.taskDate))}</td><td>${escapeXml(tableStatusLabel[task.status])}</td><td>${escapeXml(tableCheckLabel[task.managerCheck])}</td><td>${logged ? `${logged.toFixed(2)}h` : "—"}</td><td>${flag.label}</td></tr>`;
      }).join("");
      return `<section class="project"><header><div><strong>${escapeXml(project?.name || projectCode)}</strong><small>${escapeXml(projectCode)}</small></div><b>${projectTasks.length}</b></header><table><thead><tr><th>Task</th><th>Created By</th><th>Created Date</th><th>Due Date</th><th>Status</th><th>Manager Review</th><th>Hours</th><th>Indicator</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    }).join("");
    popup.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>${escapeXml(employee?.displayName || "Employee")} Tasks - HINDAZA</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,Tahoma,sans-serif;color:#1d1d1d;background:#fff}.report-head{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:15px;border-bottom:4px solid #ffd200}.logo{width:220px;max-height:76px;object-fit:contain;object-position:left center}.identity{text-align:right}.identity p{margin:0 0 5px;color:#8b6c00;font-size:10px;font-weight:800;letter-spacing:.14em}.identity h1{margin:0;font-size:24px}.identity span{display:block;margin-top:6px;color:#6e777b;font-size:10px}.filter{margin:14px 0;padding:9px 12px;border:1px solid #e1e1dc;border-radius:8px;background:#fafaf7;font-size:10px}.project{margin:0 0 14px;border:1px solid #d9d9d3;border-radius:10px;overflow:hidden;break-inside:avoid}.project>header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#fffbed}.project>header strong,.project>header small{display:block}.project>header strong{font-size:13px}.project>header small{margin-top:3px;color:#8a6e00;font-size:9px}.project>header b{min-width:26px;height:26px;display:grid;place-items:center;border-radius:50%;background:#ffd200;font-size:10px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:8px 9px;border-top:1px solid #e5e5e0;text-align:left;font-size:9px;vertical-align:top}th{background:#f2f3f1;color:#667278;font-size:8px}th:first-child{width:38%}td strong,td small{display:block}td small{margin-top:4px;color:#818b90}.footer{margin-top:18px;padding-top:9px;border-top:1px solid #ddd;color:#81898d;font-size:8px}@media print{.project{break-inside:avoid}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="report-head"><img class="logo" src="/report-logo.png" alt="HINDAZA"><div class="identity"><p>EMPLOYEE TASKS</p><h1>${escapeXml(employee?.displayName || "Employee")}</h1><span>${escapeXml(employee?.discipline || "—")} · ${visibleTasks.length} tasks</span></div></div><div class="filter">${showAll ? "All Tasks" : "Unapproved Tasks"} — All matching tasks are included</div>${printedGroups || '<div class="filter">No tasks match this filter</div>'}<div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>{window.print();}</script></body></html>`);
    popup.document.close();
  };
  return <div className="drawer-layer employee-tasks-layer" role="dialog" aria-modal="true" aria-label={`${employee?.displayName || "Employee"} tasks`}>
    <button className="drawer-backdrop" onClick={onClose} aria-label="Close employee tasks" />
    <section className="employee-tasks-dialog">
      <header><div className="employee-cell"><UserAvatar user={employee || undefined} name={employee?.displayName || "Employee"} className="employee-dialog-avatar" /><div className="employee-dialog-meta"><p>EMPLOYEE TASKS</p><h2>{employee?.displayName || "Employee"}</h2><span>{employee?.discipline || "—"} · {visibleTasks.length} tasks</span></div></div><div className="employee-tasks-header-actions"><button type="button" className="employee-tasks-print" onClick={printEmployeeTasks} aria-label="Print employee tasks as PDF" title="Print / Save as PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 13h10v8H7z" /><path d="M17.5 11h.01" /></svg></button>{employee && <button type="button" className="employee-tasks-settings" onClick={() => onEditEmployee(employee)} aria-label={`Edit ${employee.displayName}`} title="Employee settings">⚙</button>}<button type="button" className="employee-tasks-close" onClick={onClose} aria-label="Close">×</button></div></header>
      <div className="employee-tasks-toolbar"><div><button type="button" className={!showAll ? "active" : ""} onClick={() => setShowAll(false)}>Unapproved · غير معتمدة</button><button type="button" className={showAll ? "active" : ""} onClick={() => setShowAll(true)}>All Tasks · كل المهام</button></div><small>Click a task to open it. Right-click to open it in a new tab.</small></div>
      <div className="employee-project-groups" ref={projectGroupsRef} onWheel={handleDialogWheel}><div className="employee-project-groups-content">{groups.length === 0 ? <div className="comments-empty">No tasks match this filter · لا توجد مهام مطابقة</div> : groups.map(([projectCode, projectTasks]) => {
        const project = projects.find((item) => item.code === projectCode);
        const collapsed = collapsedProjects.has(projectCode);
        return <section className="employee-project-group" key={projectCode}><button type="button" className="employee-project-heading" onClick={() => toggleProject(projectCode)} aria-expanded={!collapsed}><span>{collapsed ? "+" : "−"}</span><div><strong>{project?.name || projectCode}</strong><small>{projectCode}</small></div><em>{projectTasks.length}</em></button>{!collapsed && <div className={`employee-task-table-wrap${projectTasks.length > 4 ? " has-more-tasks" : ""}`} tabIndex={projectTasks.length > 4 ? 0 : undefined} aria-label={projectTasks.length > 4 ? `${project?.name || projectCode}: scroll for more tasks` : undefined}><table className="employee-task-table"><thead><tr><th>Task</th><th>Created By</th><th>Created Date</th><th>Due Date</th><th>Status</th><th>Manager Review</th><th>Hours</th><th>Indicator</th></tr></thead><tbody>{projectTasks.map((task) => {
          const taskEntries = timeEntriesByTaskId.get(task.id) || [];
          const logged = taskLoggedHours(task, taskEntries, clock);
          const active = task.status === "in_progress" || activeTaskIds.has(task.id);
          const flag = taskFlag(task);
          const href = `/?view=projects&project=${encodeURIComponent(task.project)}&section=tasks&task=${task.id}`;
          const openTaskLink = (event: React.MouseEvent<HTMLAnchorElement>) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); onOpenTask(task); };
          const canEditProgress = canEditTaskCompletion(currentUser, task);
          return <tr className="employee-task-clickable-row" key={task.id} onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0 || (event.target as HTMLElement).closest("a, button, details")) return; onOpenTask(task); }}><td><div className="window-task-title-progress"><TaskProgressControl task={task} canEdit={canEditProgress} busy={completionSavingTaskId === task.id} onChange={(value) => updateCompletion(task.id, value)} /><a href={href} onClick={openTaskLink}><span className="employee-task-title"><strong dir="auto">{task.title}</strong>{active && <i className="employee-task-live-pulse" title="Working now" aria-label="Working now" />}</span><small>{task.expectedOutput || "—"}</small></a></div></td><td><a href={href} onClick={openTaskLink}>{task.createdByName || "Unknown user"}</a></td><td dir="ltr"><a href={href} onClick={openTaskLink}>{formatCreatedDate(task.createdAt)}</a></td><td dir="ltr"><a href={href} onClick={openTaskLink}>{formatDueDate(task.taskDate)}</a></td><td><a href={href} onClick={openTaskLink}><span className={`pill status-${task.status}`}>{tableStatusLabel[task.status]}</span></a></td><td><a href={href} onClick={openTaskLink}><span className={`pill check-${task.managerCheck}`}>{tableCheckLabel[task.managerCheck]}</span></a></td><td><a href={href} onClick={openTaskLink}>{logged ? `${logged.toFixed(2)}h` : "—"}</a></td><td><a href={href} onClick={openTaskLink}><span className={`flag flag-${flag.key}`}>{flag.label}</span></a></td></tr>;
        })}</tbody></table></div>}</section>;
      })}</div></div>
    </section>
  </div>;
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
  const timeEntriesByTaskId = useMemo(() => rowsByTaskId(props.timeEntries), [props.timeEntries]);
  const activeTaskIds = useMemo(() => new Set(props.timeEntries.filter((entry) => !entry.endedAt).map((entry) => entry.taskId)), [props.timeEntries]);
  const activeProjects = props.projects.filter((project) => project.status === "active");
  const completedProjects = props.projects.filter((project) => project.status === "completed").length;
  const onHoldProjects = props.projects.filter((project) => project.status === "on_hold").length;
  const openTasks = props.tasks.filter((task) => task.status !== "done");
  const pendingReview = props.tasks.filter((task) => task.managerCheck === "pending");
  const openIssues = props.issues.filter((issue) => issue.status !== "closed");
  const criticalIssues = openIssues.filter((issue) => issue.priority === "critical");
  const completion = props.tasks.length ? Math.round((props.tasks.filter((task) => task.status === "done").length / props.tasks.length) * 100) : 0;
  const plannedHours = props.tasks.reduce((sum, task) => sum + task.plannedHours, 0);
  const actualHours = props.tasks.reduce((sum, task) => sum + taskLoggedHours(task, timeEntriesByTaskId.get(task.id) || [], props.clock), 0);
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
    const statusOrder: Record<Project["status"], number> = { active: 0, on_hold: 1, completed: 2, archived: 3 };
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
        {attentionTasks.length === 0 ? <div className="overview-empty-compact">All visible tasks are complete.</div> : <div className="overview-record-list">{attentionTasks.map((task) => { const flag = taskFlag(task); const active = task.status === "in_progress" || activeTaskIds.has(task.id); return <button key={task.id} onClick={() => props.openTask(task)}><span className={`overview-record-marker marker-${flag.key}`} /><div><span className="employee-task-title"><strong dir="auto">{task.title}</strong>{active && <i className="employee-task-live-pulse" title="Working now" aria-label="Working now" />}</span><small>{task.project} · {task.employeeName}</small></div><span className={`flag ${flag.key}`}>{flag.label.split(" · ")[0]}</span><time>{formatDueDate(task.taskDate)}</time></button>; })}</div>}
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
  detailsLoadedTaskIds: Set<number>;
  subtasks: TaskSubtask[];
  attachments: TaskAttachment[];
  issueLinks: TaskIssueLink[];
  openIssue: (link: TaskIssueLink) => void;
  currentUser: User | null;
  completionSavingTaskId: number | null;
  updateCompletion: (taskId: number, completionPercent: number) => void;
};

const taskCompletionOptions = [0, 25, 50, 75, 100] as const;

function canEditTaskCompletion(currentUser: User | null, task: Task) {
  return Boolean(
    currentUser &&
    task.employeeEmail.toLowerCase() === currentUser.email.toLowerCase() &&
    task.managerCheck !== "pending" &&
    task.managerCheck !== "approved",
  );
}

function TaskProgressControl({ task, canEdit, busy, onChange }: { task: Task; canEdit: boolean; busy: boolean; onChange: (completionPercent: number) => void; }) {
  const completionPercent = taskCompletionOptions.includes(task.completionPercent as (typeof taskCompletionOptions)[number]) ? task.completionPercent : 0;
  const style = {
    "--task-completion": `${completionPercent * 3.6}deg`,
    "--task-progress-color": `hsl(${completionPercent * 1.2} 68% 43%)`,
  } as CSSProperties;
  const livePulse = task.status === "in_progress" ? <i className="employee-task-live-pulse" title="Working now" aria-label="Working now" /> : null;
  if (!canEdit) return <span className="task-progress-live-wrap"><span className="task-progress-circle readonly" style={style} title={`${completionPercent}% complete`}><span>{completionPercent}%</span></span>{livePulse}</span>;
  return <span className="task-progress-live-wrap"><details className="task-progress-control" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <summary className="task-progress-circle" style={style} title="Update task completion" aria-label={`Task completion ${completionPercent}%`}><span>{completionPercent}%</span></summary>
    <div className="task-progress-menu">{taskCompletionOptions.map((value) => <button type="button" key={value} className={value === completionPercent ? "active" : ""} disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onChange(value); }}>{value}%</button>)}</div>
  </details>{livePulse}</span>;
}

function TaskTable(props: TaskTableProps) {
  const filtersActive = Boolean(props.search.trim()) || props.employeeFilter !== "all" || (!props.lockedProjectCode && props.projectFilter !== "all") || props.statusFilter !== "all" || props.reviewFilter !== "all" || Boolean(props.dueDateFilter) || (props.showDisciplineColumn && props.disciplineFilter !== "all");
  const timeEntriesByTaskId = useMemo(() => rowsByTaskId(props.timeEntries), [props.timeEntries]);
  const subtasksByTaskId = useMemo(() => rowsByTaskId(props.subtasks), [props.subtasks]);
  const attachmentsByTaskId = useMemo(() => rowsByTaskId(props.attachments), [props.attachments]);
  const issueLinkByTaskId = useMemo(() => new Map(props.issueLinks.map((link) => [link.convertedTaskId, link])), [props.issueLinks]);
  const usersByEmail = useMemo(() => new Map(props.users.map((user) => [user.email.toLowerCase(), user])), [props.users]);
  const usersByName = useMemo(() => new Map(props.users.map((user) => [user.displayName, user])), [props.users]);
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
    <div className="filters"><label className="search-box"><span>⌕</span><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder={props.lockedProjectCode ? "Search tasks in this project..." : "Search for a task or project..."} /></label>{props.showEmployeeFilter && <select value={props.employeeFilter} onChange={(event) => props.setEmployeeFilter(event.target.value)} aria-label="Filter by employee"><option value="all">All employees · كل الموظفين</option>{props.employees.map((employee) => <option key={employee.name} value={employee.name}>{employee.name} ({employee.discipline})</option>)}</select>}{props.showDisciplineColumn && <select value={props.disciplineFilter} onChange={(event) => props.setDisciplineFilter(event.target.value)} aria-label="Filter by discipline"><option value="all">All disciplines · كل التخصصات</option>{disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select>}{!props.lockedProjectCode && <select value={props.projectFilter} onChange={(event) => props.setProjectFilter(event.target.value)} aria-label="Filter by project"><option value="all">All projects · كل المشاريع</option>{props.projects.map((project) => <option key={project}>{project}</option>)}</select>}<select value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="all">All employee statuses · كل حالات الموظف</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={props.reviewFilter} onChange={(event) => props.setReviewFilter(event.target.value)} aria-label="Filter by manager review">{props.lockedProjectCode && <option value="unapproved">Unapproved · غير معتمدة</option>}<option value="all">All manager reviews · كل مراجعات المسؤول</option>{Object.entries(checkLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="due-date-filter"><span>Due Date</span><input type="date" value={props.dueDateFilter} onChange={(event) => props.setDueDateFilter(event.target.value)} aria-label="Filter by due date" /></label><button type="button" className="clear-filters-button" onClick={clearFilters} disabled={!filtersActive} aria-label="Clear all task filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count" dir="ltr">{props.filteredCount} {props.filteredCount === 1 ? "Task" : "Tasks"}</span></div>
    {props.loading ? <div className="loading-state"><div className="spinner" /><p>جاري تحميل المهام...</p></div> : props.tasks.length === 0 ? <div className="empty-state"><strong>لا توجد مهام مطابقة</strong><p>غيّر خيارات البحث أو أضف مهمة جديدة.</p></div> : <><div className="task-table-wrap"><table className={`task-table task-data-table task-table-ltr${props.showEmployeeFilter ? "" : " member-task-table"}`}><thead><tr><th>Task</th>{props.showEmployeeFilter && <th>Employee</th>}<th>Created By</th>{props.showDisciplineColumn && <th>Discipline</th>}<th>Created Date</th><th>Due Date</th><th>Priority</th><th>Hours</th><th>Status</th><th>Manager Review</th><th>Indicator</th><th>Issue Link</th></tr></thead><tbody>{props.tasks.map((task) => {
	      const flag = taskFlag(task);
	      const entries = timeEntriesByTaskId.get(task.id) || [];
	      const taskSubtasks = subtasksByTaskId.get(task.id) || [];
	      const detailsLoaded = props.detailsLoadedTaskIds.has(task.id);
	      const subtaskCount = detailsLoaded ? taskSubtasks.length : task.subtaskCount || taskSubtasks.length;
	      const completedSubtaskCount = detailsLoaded ? taskSubtasks.filter((item) => item.completed).length : task.completedSubtaskCount || 0;
	      const attachmentCount = detailsLoaded ? attachmentsByTaskId.get(task.id)?.length || 0 : task.attachmentCount || 0;
      const issueLink = issueLinkByTaskId.get(task.id);
      const logged = taskLoggedHours(task, entries, props.clock);
      const active = task.status === "in_progress" || entries.some((entry) => !entry.endedAt);
	      const noteCount = detailsLoaded ? props.commentCounts.get(task.id) || 0 : task.commentCount || 0;
      const creator = usersByEmail.get(task.createdBy.toLowerCase()) || (task.createdBy ? { email: task.createdBy, displayName: task.createdByName || "Unknown user", role: "member" as const, discipline: "" as const, profileImageKey: task.createdByProfileImageKey || "" } : undefined);
      const employee = usersByEmail.get(task.employeeEmail.toLowerCase()) || usersByName.get(task.employeeName);
      const creatorName = task.createdByName || creator?.displayName || "Unknown user";
      const canEditProgress = canEditTaskCompletion(props.currentUser, task);
      return <tr key={task.id} onClick={() => props.openTask(task)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && props.openTask(task)}><td><div className="task-cell"><div className="task-title-progress"><TaskProgressControl task={task} canEdit={canEditProgress} busy={props.completionSavingTaskId === task.id} onChange={(value) => props.updateCompletion(task.id, value)} /><strong>{task.title}</strong></div><div className="task-tags">{task.originatedByName && <span className="employee-origin-tag">From employee · {task.originatedByName}</span>}{task.visibility === "private" && <span className="private-badge">Private</span>}{subtaskCount > 0 && <span className="subtask-indicator" title={`${completedSubtaskCount}/${subtaskCount} subtasks completed`} aria-label={`${subtaskCount} subtasks`}>☑ <small>{subtaskCount}</small></span>}{noteCount > 0 && <span className="note-indicator" title={`${noteCount} notes`} aria-label={`${noteCount} notes`}>▰ <small>{noteCount}</small></span>}{attachmentCount > 0 && <span className="attachment-count task-attachment-indicator" title={`${attachmentCount} attachments`} aria-label={`${attachmentCount} attachments`}>📎 <small>{attachmentCount}</small></span>}</div><small>{task.expectedOutput}</small></div></td>{props.showEmployeeFilter && <td><div className="employee-cell"><UserAvatar user={employee} name={task.employeeName} /><strong>{task.employeeName}</strong></div></td>}<td><div className="employee-cell creator-person-cell" title={creatorName}><UserAvatar user={creator} name={creatorName} /><strong>{creatorName}</strong></div></td>{props.showDisciplineColumn && <td><span className="task-discipline">{task.employeeDiscipline || employee?.discipline || "—"}</span></td>}<td><span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span></td><td><span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></td><td><span className={`pill priority-${task.priority}`}>{tablePriorityLabel[task.priority]}</span></td><td><strong className={active ? "live-hours" : ""}>{logged ? logged.toFixed(2) : "—"}{active && <i />}</strong><small className="hours-note"> / {task.plannedHours || "—"}h</small></td><td><span className={`pill status-${task.status}`}>{tableStatusLabel[task.status]}</span></td><td><span className={`pill check-${task.managerCheck}`}>{tableCheckLabel[task.managerCheck]}</span></td><td><span className={`flag flag-${flag.key}`}>{flag.label}</span></td><td>{issueLink ? <button type="button" className={`record-link-button ${task.createdAt <= issueLink.createdAt ? "task-first" : "issue-first"}`} onClick={(event) => { event.stopPropagation(); props.openIssue(issueLink); }}>{issueLink.issueNumber}</button> : <span>—</span>}</td></tr>;
    })}</tbody></table></div>
      <div className="mobile-task-list">{props.tasks.map((task) => { const flag = taskFlag(task); const entries = timeEntriesByTaskId.get(task.id) || []; const taskSubtasks = subtasksByTaskId.get(task.id) || []; const detailsLoaded = props.detailsLoadedTaskIds.has(task.id); const subtaskCount = detailsLoaded ? taskSubtasks.length : task.subtaskCount || taskSubtasks.length; const attachmentCount = detailsLoaded ? attachmentsByTaskId.get(task.id)?.length || 0 : task.attachmentCount || 0; const logged = taskLoggedHours(task, entries, props.clock); const creatorName = task.createdByName || usersByEmail.get(task.createdBy.toLowerCase())?.displayName || "Unknown user"; return <button className="mobile-task" key={task.id} onClick={() => props.openTask(task)}><div className="mobile-task-top"><div className="task-tags">{task.originatedByName && <span className="employee-origin-tag">From employee · {task.originatedByName}</span>}{task.visibility === "private" && <span className="private-badge">Private</span>}{subtaskCount > 0 && <span className="subtask-indicator">☑ <small>{subtaskCount}</small></span>}{attachmentCount > 0 && <span className="attachment-count task-attachment-indicator">📎 <small>{attachmentCount}</small></span>}</div><span className={`flag flag-${flag.key}`}>{flag.label}</span></div><strong>{task.title}</strong><small>{props.showEmployeeFilter ? `${task.employeeName} · ` : ""}<span className="mobile-date-label">Created by</span> {creatorName} · <span className="mobile-date-label">Created</span> <span className="due-date" dir="ltr">{formatCreatedDate(task.createdAt)}</span> · <span className="mobile-date-label">Due</span> <span className="due-date" dir="ltr">{formatDueDate(task.taskDate)}</span></small><div className="mobile-task-bottom"><span className={`pill status-${task.status}`}>{tableStatusLabel[task.status]}</span><span>{task.completionPercent}% · {logged.toFixed(2)}/{task.plannedHours}h</span></div></button>; })}</div>
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
  updateCompletion: (taskId: number, completionPercent: number) => void;
  completionSavingTaskId: number | null;
  updateWorkSession: (entryId: number, startedAt: string, endedAt: string) => void;
  deleteWorkSession: (entryId: number) => void;
  savingTimer: boolean;
  submitPrivateTask: () => void;
  subtasks: TaskSubtask[];
  draftSubtasks: DraftSubtask[];
  updateDraftSubtask: (id: string, title: string) => void;
  deleteDraftSubtask: (id: string) => void;
  subtaskDraft: string;
  setSubtaskDraft: (value: string) => void;
  addSubtask: () => void;
  toggleSubtask: (subtask: TaskSubtask) => void;
  updateSubtaskTitle: (subtask: TaskSubtask, title: string) => Promise<boolean>;
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
  issueLink: TaskIssueLink | null;
  onOpenIssue: (link: TaskIssueLink) => void;
  onIssueCreated: (issue: TaskIssueLink) => void;
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
  return <article className={entry.endedAt ? "" : "active"}><div className="session-employee"><strong>{entry.employeeName || entry.employeeEmail}</strong><span>Employee · الموظف</span></div><div><strong>{formatDateTime(entry.startedAt)}</strong><span>Start</span></div><b>→</b><div><strong>{entry.endedAt ? formatDateTime(entry.endedAt) : "Running now"}</strong><span>{formatDuration(entrySeconds(entry, clock))}</span></div>{editable && <div className="session-row-actions"><button type="button" onClick={() => { setStartedAt(toLocalInput(entry.startedAt)); setEndedAt(toLocalInput(entry.endedAt)); setEditing(true); }} disabled={busy} title="Edit work session">✎</button><button type="button" className="session-delete" onClick={() => onDelete(entry.id)} disabled={busy} title="Delete work session">×</button></div>}</article>;
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

function pastedFiles(event: ClipboardEvent<HTMLElement>) {
  const files = Array.from(event.clipboardData.files);
  if (files.length) return files;
  return Array.from(event.clipboardData.items).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => Boolean(file));
}

function EditableSubtaskTitle({ title, canEdit, busy, onSave }: { title: string; canEdit: boolean; busy: boolean; onSave: (title: string) => Promise<boolean> | boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  if (!editing) return <div className="subtask-title-display"><strong dir="auto">{title}</strong>{canEdit && <button type="button" className="subtask-edit" onClick={() => { setDraft(title); setEditing(true); }} disabled={busy} title="Edit subtask" aria-label={`Edit ${title}`}>✎</button>}</div>;
  const save = async () => {
    const nextTitle = draft.trim();
    if (!nextTitle) return;
    if (await onSave(nextTitle)) setEditing(false);
  };
  return <div className="subtask-title-editor"><input dir="auto" maxLength={240} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } if (event.key === "Escape") setEditing(false); }} autoFocus /><button type="button" className="subtask-title-save" onClick={() => void save()} disabled={busy || !draft.trim()} title="Save subtask">✓</button><button type="button" onClick={() => setEditing(false)} disabled={busy} title="Cancel">×</button></div>;
}

function TaskAttachmentTable({ attachments, onUpload, onDelete, busy, compact = false, progress = null, readOnly = false }: { attachments: TaskAttachment[]; onUpload: (file: File) => Promise<void> | void; onDelete: (attachment: TaskAttachment) => void; busy: boolean; compact?: boolean; progress?: AttachmentUploadProgress | null; readOnly?: boolean }) {
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const canPreview = (attachment: TaskAttachment) => attachment.contentType.startsWith("image/") || attachment.contentType === "application/pdf" || Boolean(taskOfficeKind(attachment));
  return <>
    {!readOnly && <div className={`task-attachment-toolbar${compact ? " compact" : ""}`}>
      <label className="task-attachment-add" title="Add attachment"><span>＋</span>{!compact && <strong>Add Attachment</strong>}<input type="file" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} /></label>
      {!compact && <small>Optional · maximum 25 MB per file</small>}
    </div>}
    {!readOnly && !compact && <div className="attachment-paste-zone" contentEditable suppressContentEditableWarning role="textbox" tabIndex={0} onInput={(event) => { event.currentTarget.textContent = ""; }} onPaste={(event) => { const files = pastedFiles(event); if (!files.length) return; event.preventDefault(); void (async () => { for (const file of files.slice(0, 10 - attachments.length)) await onUpload(file); })(); }}><span>Paste attachments here · الصق المرفقات هنا</span></div>}
    {progress && <div className={`attachment-upload-progress${compact ? " compact" : ""}`} role="status" aria-live="polite"><div><strong>{compact ? "Uploading" : progress.fileName}</strong><span>{progress.percent}%</span></div><progress max="100" value={progress.percent} /></div>}
    {compact && attachments.length > 0 && <div className="subtask-attachment-list">{attachments.map((attachment) => <div key={attachment.id}><button type="button" className="subtask-attachment-open" onClick={() => canPreview(attachment) ? setPreview(attachment) : window.open(`/api/task-attachments?id=${attachment.id}&download=1`, "_blank")} title={attachment.fileName}>📎 <span>{attachment.fileName}</span></button>{!readOnly && <button type="button" className="subtask-attachment-remove" onClick={() => onDelete(attachment)} disabled={busy} title="Delete attachment" aria-label={`Delete ${attachment.fileName}`}>×</button>}</div>)}</div>}
    {!compact && attachments.length > 0 && <div className="attachment-table-wrap task-attachments-table-wrap"><table className="attachment-table task-attachments-table"><thead><tr><th>File</th><th>Size</th><th>Uploaded</th>{!readOnly && <th />}</tr></thead><tbody>{attachments.map((attachment) => <tr key={attachment.id} className="clickable-attachment" onClick={() => canPreview(attachment) ? setPreview(attachment) : window.open(`/api/task-attachments?id=${attachment.id}&download=1`, "_blank")}><td><strong>{attachment.fileName}</strong></td><td>{fileSizeLabel(attachment.sizeBytes)}</td><td>{formatCreatedDate(attachment.createdAt)}</td>{!readOnly && <td onClick={(event) => event.stopPropagation()}><button type="button" className="attachment-delete" onClick={() => onDelete(attachment)} disabled={busy} title="Delete attachment" aria-label={`Delete ${attachment.fileName}`}>×</button></td>}</tr>)}</tbody></table></div>}
    {preview && <div className="attachment-preview-layer" role="dialog" aria-modal="true" aria-label={`Preview ${preview.fileName}`}><button type="button" className="attachment-preview-backdrop" onClick={() => setPreview(null)} aria-label="Close preview" /><section className="attachment-preview-dialog"><header><div><strong>{preview.fileName}</strong><span>{fileSizeLabel(preview.sizeBytes)}</span></div><div><a href={`/api/task-attachments?id=${preview.id}&download=1`} download>Download</a><button type="button" onClick={() => setPreview(null)} aria-label="Close preview">×</button></div></header><div className="attachment-preview-content">{preview.contentType.startsWith("image/") ? <img src={`/api/task-attachments?id=${preview.id}`} alt={preview.fileName} /> : preview.contentType === "application/pdf" ? <iframe src={`/api/task-attachments?id=${preview.id}`} title={preview.fileName} /> : <TaskOfficePreview attachment={preview} />}</div></section></div>}
  </>;
}

function TaskDrawer({ selectedId, form, setOpen, saveTask, deleteTask, saving, currentUser, users, projects, lockedProjectCode = "", openProjectSettings, updateForm, comments, commentDraft, setCommentDraft, addComment, updateComment, deleteComment, savingComment, task, timeEntries, clock, updateTimer, updateCompletion, completionSavingTaskId, updateWorkSession, deleteWorkSession, savingTimer, submitPrivateTask, subtasks, draftSubtasks, updateDraftSubtask, deleteDraftSubtask, subtaskDraft, setSubtaskDraft, addSubtask, toggleSubtask, updateSubtaskTitle, deleteSubtask, subtaskBusy, attachments, draftAttachments, addDraftAttachments, deleteDraftAttachment, uploadAttachment, deleteAttachment, attachmentBusy, attachmentProgress, issueLink, onOpenIssue, onIssueCreated }: TaskDrawerProps) {
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [issueDescription, setIssueDescription] = useState(task?.expectedOutput ? `${task.title} — ${task.expectedOutput}` : task?.title || "");
  const [issueDiscipline, setIssueDiscipline] = useState<Discipline | "">(task?.employeeDiscipline && task.employeeDiscipline !== "Manager" ? task.employeeDiscipline : currentUser?.discipline !== "Manager" ? currentUser?.discipline || "Architecture" : "Architecture");
  const [issueCategory, setIssueCategory] = useState("Task Follow-up");
  const [issueDate, setIssueDate] = useState(localToday());
  const [convertingIssue, setConvertingIssue] = useState(false);
  const [convertIssueError, setConvertIssueError] = useState("");
  const selectedProject = projects.find((project) => project.code === form.project);
  const canOpenProjectSettings = Boolean(selectedProject && currentUser && (currentUser.role === "owner" || currentUser.role === "manager"));
  const acceptingEmployeeTask = Boolean(currentUser && (currentUser.role === "owner" || currentUser.role === "manager") && task?.visibility === "private" && task.submittedToManager && task.createdBy !== currentUser.email);
  const managerCreatorReadOnly = Boolean(currentUser?.role === "manager" && task && task.createdBy !== currentUser.email && !acceptingEmployeeTask);
  const privateOwner = Boolean(currentUser && form.visibility === "private" && (!task || (task.createdBy === currentUser.email && !task.submittedToManager)));
  const memberOwnPrivate = currentUser?.role === "member" && task?.visibility === "private" && task.createdBy === currentUser.email && task.employeeEmail === currentUser.email;
  const management = isManagement(currentUser) && !managerCreatorReadOnly;
  const managementPrivateProjectLocked = Boolean(management && form.visibility === "private");
  const employee = users.find((user) => user.email === task?.employeeEmail);
  const projectManager = Boolean(currentUser?.role === "manager" && selectedProject?.projectManagerEmails.includes(currentUser.email) && currentUser.discipline && employee?.discipline === currentUser.discipline);
  const canAuditSessions = Boolean(task && (management || projectManager));
  const canEditDetails = management || privateOwner;
  const canCollaborate = canEditDetails || Boolean(task && currentUser && task.employeeEmail === currentUser.email);
  const canEditSubtaskTitles = Boolean(task && currentUser && (task.visibility === "private"
    ? task.createdBy === currentUser.email
    : currentUser.role === "owner" || (currentUser.role === "manager" && task.createdBy === currentUser.email)));
  const canComment = canCollaborate || projectManager;
  const privateFinishOnly = Boolean(currentUser && task?.visibility === "private" && !task.submittedToManager && task.employeeEmail === currentUser.email);
  const openSubtaskCount = subtasks.filter((subtask) => !subtask.completed).length;
  const activeEntry = timeEntries.find((entry) => !entry.endedAt);
  const assignedToCurrentUser = Boolean(task && currentUser && task.employeeEmail.toLowerCase() === currentUser.email.toLowerCase());
  const canEditProgress = Boolean(task && canEditTaskCompletion(currentUser, task));
  const canPauseEmployeeTimer = Boolean(activeEntry && canAuditSessions && !assignedToCurrentUser);
  const canReassignAfterWork = Boolean(task?.submittedToManager || task?.managerCheck === "pending");
  const assignmentLocked = timeEntries.length > 0 && !canReassignAfterWork;
  const assignmentLockHint = "The employee cannot be changed after work starts until the task is submitted for manager review. · لا يمكن تغيير الموظف بعد بدء المهمة حتى يرسلها الموظف لمراجعة المسؤول";
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
  const convertTaskToIssue = async () => {
    if (!task || !issueDescription.trim() || !issueDiscipline) return;
    setConvertingIssue(true); setConvertIssueError("");
    try {
      const response = await fetch("/api/tasks/convert-to-issue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id, description: issueDescription, discipline: issueDiscipline, category: issueCategory, issueDate }) });
      const data = await response.json() as { issue?: TaskIssueLink; error?: string };
      if (!response.ok || !data.issue) throw new Error(data.error || "Unable to convert task to issue.");
      onIssueCreated(data.issue);
    } catch (error) { setConvertIssueError(error instanceof Error ? error.message : "Unable to convert task to issue."); }
    finally { setConvertingIssue(false); }
  };
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="تفاصيل المهمة">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="إغلاق" />
    <aside className="task-drawer">
      <div className="drawer-head"><div><p>{selectedId ? `TASK #${selectedId}` : form.visibility === "private" ? "NEW PRIVATE TASK" : "NEW TASK"}</p><h2>{selectedId ? "Task Details & Update" : form.visibility === "private" ? "New Private Task" : "New Task"}</h2>{task && issueLink && <span className="drawer-conversion-label">{task.createdAt <= issueLink.createdAt ? "Converted to Issue" : "Converted from Issue"}</span>}{form.visibility === "private" && <span className="drawer-private-label">Private · خاص</span>}</div><button className="close-button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
      <form onSubmit={saveTask} className="task-form" dir="ltr">
        {selectedId && management && task?.visibility === "private" && task.createdBy === currentUser?.email && <div className="private-convert-bar"><button type="button" onClick={() => { updateForm("visibility", "team"); updateForm("project", task.project !== "PERSONAL" ? task.project : projects.find((project) => project.status === "active")?.code || ""); updateForm("employeeEmail", ""); updateForm("employeeName", ""); }}>Convert to Employee Task · تحويل إلى مهمة موظف</button></div>}
        {acceptingEmployeeTask && task && <div className="employee-origin-banner"><strong>Created By · أنشأها الموظف: {task.originatedByName || task.employeeName}</strong><span>Opened by · فُتحت بواسطة: {currentUser?.displayName}</span></div>}
        <div className="form-section"><h3>Task Information <span>معلومات المهمة</span></h3><div className="wide task-title-field"><label htmlFor="task-title-input">Task · اسم المهمة</label><div className="task-title-input-row"><input id="task-title-input" required disabled={!canEditDetails} value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="مثال: تدقيق موديل المنطقة 02" />{selectedId && task && <span className="task-title-drawer-progress"><TaskProgressControl task={task} canEdit={canEditProgress} busy={completionSavingTaskId === task.id} onChange={(value) => updateCompletion(task.id, value)} /></span>}</div></div><label className="wide"><span>Expected Output · المخرج المتوقع</span><textarea disabled={!canEditDetails} value={form.expectedOutput} onChange={(event) => updateForm("expectedOutput", event.target.value)} rows={3} placeholder="ما المطلوب تسليمه عند اكتمال المهمة؟" /></label><div className="form-grid task-project-date-grid"><label><span className="task-project-label"><span>Project · المشروع</span>{canOpenProjectSettings && selectedProject && <button type="button" className="task-project-settings" onClick={() => openProjectSettings(selectedProject)} aria-label="Project settings" title="Project settings">⚙</button>}</span><select required disabled={!canEditDetails || managementPrivateProjectLocked} value={form.project} onChange={(event) => { const code = event.target.value; updateForm("project", code); const project = projects.find((item) => item.code === code); if (management && !project?.memberEmails.includes(form.employeeEmail)) { updateForm("employeeEmail", ""); updateForm("employeeName", ""); } }}><option value="">اختر المشروع</option>{projectOptions.map((project) => <option key={project}>{project}</option>)}</select></label><label><span>Due Date · تاريخ الإنجاز المتوقع</span><input type="date" lang="en-GB" disabled={!canEditDetails} value={form.taskDate} onChange={(event) => updateForm("taskDate", event.target.value)} /></label><label><span>Priority · الأولوية</span><select disabled={!canEditDetails} value={form.priority} onChange={(event) => updateForm("priority", event.target.value as Task["priority"])}>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Status · الحالة</span><select disabled value={form.status}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div></div>
        <div className="form-section assignment-time-section"><h3>Assignment & Time</h3><div className={`assignment-time-grid ${management ? "management" : "member"}`}>{management && (form.visibility !== "private" || acceptingEmployeeTask) && <label className="assignment-employee" title={assignmentLocked ? assignmentLockHint : undefined}><span>Employee</span><select required disabled={assignmentLocked} title={assignmentLocked ? assignmentLockHint : undefined} value={form.employeeEmail} onChange={(event) => { const user = users.find((item) => item.email === event.target.value); updateForm("employeeEmail", event.target.value); if (user) updateForm("employeeName", user.displayName); }}><option value="">{form.project ? "Select a project employee" : "Select a project first"}</option>{assignmentOptions.map((user) => <option key={user.email} value={user.email}>{user.displayName}{user.discipline ? ` · ${user.discipline}` : ""}</option>)}</select></label>}{selectedId && currentUser?.role === "owner" && <label className="assignment-created-by"><span>Created By</span><select required value={form.createdBy} onChange={(event) => updateForm("createdBy", event.target.value)}>{users.map((user) => <option key={user.email} value={user.email}>{user.displayName} · {user.email}</option>)}</select></label>}<label><span>Planned Hours</span><input type="number" disabled={!canEditDetails} min="0" step="0.25" value={form.plannedHours} onChange={(event) => updateForm("plannedHours", Number(event.target.value))} /></label><label><span>Logged Hours</span><input disabled value={formatDuration(loggedSeconds)} /></label></div></div>
        <div className="form-section task-attachments-section"><div className="comments-heading"><h3>Task Attachments <span>مرفقات المهمة</span></h3><span>{selectedId ? attachments.filter((attachment) => attachment.subtaskId === null).length : draftAttachments.length}/10</span></div>{selectedId ? <TaskAttachmentTable attachments={attachments.filter((attachment) => attachment.subtaskId === null)} onUpload={(file) => uploadAttachment(file, null)} onDelete={deleteAttachment} busy={attachmentBusy} progress={attachmentProgress?.subtaskId === null ? attachmentProgress : null} readOnly={!canCollaborate} /> : <><label className="task-attachment-add draft-task-attachment-add"><span>＋</span><strong>Add Attachments</strong><input type="file" multiple disabled={saving || draftAttachments.length >= 10} onChange={(event) => { addDraftAttachments(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /></label><div className="attachment-paste-zone" contentEditable suppressContentEditableWarning role="textbox" tabIndex={0} onInput={(event) => { event.currentTarget.textContent = ""; }} onPaste={(event) => { const files = pastedFiles(event); if (!files.length) return; event.preventDefault(); addDraftAttachments(files); }}><span>Paste attachments here · الصق المرفقات هنا</span></div><small>Optional · maximum 10 files and 25 MB per file</small>{draftAttachments.length > 0 && <div className="pending-files">{draftAttachments.map(({ id, file }) => <span key={id}>{file.name} <small>{fileSizeLabel(file.size)}</small><button type="button" onClick={() => deleteDraftAttachment(id)} aria-label={`Remove ${file.name}`}>×</button></span>)}</div>}</>}</div>
        <div className="form-section subtasks-section">
          <div className="comments-heading"><h3>Subtasks <span>المهام الفرعية</span></h3><span>{selectedId ? `${subtasks.filter((subtask) => subtask.completed).length}/${subtasks.length}` : draftSubtasks.length}</span></div>
          {canCollaborate && <div className="subtask-composer"><input dir="auto" maxLength={240} value={subtaskDraft} onChange={(event) => setSubtaskDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSubtask(); } }} placeholder="Add an optional subtask..." /><button type="button" onClick={addSubtask} disabled={subtaskBusy || !subtaskDraft.trim()} title="Add subtask" aria-label="Add subtask">＋</button></div>}
          {selectedId ? (subtasks.length === 0 ? <div className="comments-empty">No subtasks · لا توجد مهام فرعية</div> : <div className="subtask-table-wrap"><table className="subtask-table"><thead><tr><th>#</th><th>Done</th><th>Subtask</th><th>Attachments</th>{canCollaborate && <th />}</tr></thead><tbody>{subtasks.map((subtask, index) => {
            const rowAttachments = attachments.filter((attachment) => attachment.subtaskId === subtask.id);
            return <tr key={subtask.id} className={subtask.completed ? "completed" : ""}><td className="subtask-number">{index + 1}</td><td><input type="checkbox" checked={subtask.completed} onChange={() => toggleSubtask(subtask)} disabled={subtaskBusy || !canCollaborate} aria-label={`Mark ${subtask.title} ${subtask.completed ? "open" : "complete"}`} /></td><td><EditableSubtaskTitle title={subtask.title} canEdit={canEditSubtaskTitles} busy={subtaskBusy} onSave={(title) => updateSubtaskTitle(subtask, title)} />{subtask.completed && <small>Closed {subtask.completedAt ? formatDateTime(subtask.completedAt) : ""}</small>}</td><td><TaskAttachmentTable compact attachments={rowAttachments} onUpload={(file) => uploadAttachment(file, subtask.id)} onDelete={deleteAttachment} busy={attachmentBusy} progress={attachmentProgress?.subtaskId === subtask.id ? attachmentProgress : null} readOnly={!canCollaborate} /></td>{canCollaborate && <td><button type="button" className="subtask-delete" onClick={() => deleteSubtask(subtask)} disabled={subtaskBusy} title="Delete subtask" aria-label={`Delete ${subtask.title}`}>×</button></td>}</tr>;
          })}</tbody></table></div>) : (draftSubtasks.length === 0 ? <div className="comments-empty">Add subtasks now; they will be saved with the new task.</div> : <div className="subtask-table-wrap"><table className="subtask-table draft-subtask-table"><thead><tr><th>#</th><th>Subtask</th><th>Attachments</th><th /></tr></thead><tbody>{draftSubtasks.map((subtask, index) => <tr key={subtask.id}><td className="subtask-number">{index + 1}</td><td><EditableSubtaskTitle title={subtask.title} canEdit busy={false} onSave={(title) => { updateDraftSubtask(subtask.id, title); return true; }} /></td><td><small className="save-first-note">Available after saving</small></td><td><button type="button" className="subtask-delete" onClick={() => deleteDraftSubtask(subtask.id)} title="Delete subtask" aria-label={`Delete ${subtask.title}`}>×</button></td></tr>)}</tbody></table></div>)}
        </div>
        {selectedId && task && canPauseEmployeeTimer && <div className="form-section timer-section management-timer-section"><div className="timer-head"><div><h3>Employee Work Timer <span>عداد الموظف</span></h3><p>The timer is currently running for {task.employeeName}. Pause it here if the employee forgot to stop it.</p></div><strong className="running" dir="ltr">{formatDuration(loggedSeconds)}</strong></div><div className="timer-actions"><button type="button" className="pause-task-button management-pause-button" onClick={() => updateTimer("pause")} disabled={savingTimer}><ButtonLabel en="Ⅱ Pause Employee Timer" ar="إيقاف عداد الموظف" /></button></div></div>}
        {selectedId && assignedToCurrentUser && <div className="form-section timer-section"><div className="timer-head"><div><h3>Work Timer <span>تسجيل وقت العمل</span></h3><p>يمكنك إيقاف المهمة للبريك أو عند الانتقال لمهمة أخرى، ثم استئنافها في أي يوم لاحق.</p></div><strong className={activeEntry ? "running" : ""} dir="ltr">{formatDuration(loggedSeconds)}</strong></div><div className="timer-actions">{activeEntry ? <button type="button" className="pause-task-button" onClick={() => updateTimer("pause")} disabled={savingTimer}><ButtonLabel en="Ⅱ Pause" ar="إيقاف مؤقت" /></button> : <button type="button" className="start-task-button" onClick={() => updateTimer("start")} disabled={savingTimer || task.managerCheck === "approved"}><ButtonLabel en="▶ Start / Resume" ar="ابدأ / استأنف" /></button>}{task.status !== "done" && <button type="button" className="finish-task-button" onClick={() => updateTimer("finish")} disabled={savingTimer || openSubtaskCount > 0} title={openSubtaskCount ? `Complete ${openSubtaskCount} open subtasks first` : privateFinishOnly ? "Finish private task" : "Finish and submit task"}><ButtonLabel en={privateFinishOnly ? "✓ Finish" : "✓ Finish & Submit"} ar={privateFinishOnly ? "إنهاء المهمة" : "إنهاء وإرسال للمراجعة"} /></button>}</div>{openSubtaskCount > 0 && <div className="subtask-submit-lock">{privateFinishOnly ? "Complete all subtasks before finishing the main task" : "Complete all subtasks before submitting the main task"} · يجب إغلاق جميع المهام الفرعية أولًا ({openSubtaskCount})</div>}{task.managerCheck === "approved" && <div className="timer-lock-note">المهمة معتمدة. يجب على المسؤول إعادة فتح المراجعة قبل استئناف العمل.</div>}</div>}
        {selectedId && timeEntries.length > 0 && <div className="form-section time-history"><div className="comments-heading"><h3>Work Sessions <span>سجل جلسات العمل</span></h3><span>{timeEntries.length}</span></div>{canAuditSessions && <div className="session-audit-note">Management review mode · يمكن للمالك والمسؤول تدقيق الوقت وتعديله أو حذف الجلسة</div>}<div className="time-entry-list">{[...timeEntries].reverse().map((entry) => <WorkSessionRow key={entry.id} entry={entry} clock={clock} editable={canAuditSessions && Boolean(entry.endedAt)} busy={savingTimer} onUpdate={updateWorkSession} onDelete={deleteWorkSession} />)}</div></div>}
        {selectedId && currentUser?.role === "member" && task?.visibility === "private" && task.createdBy === currentUser.email && <div className="form-section private-share-section"><h3>Private Task Sharing <span>مشاركة المهمة</span></h3>{task.submittedToManager ? <div className="private-shared-note">تمت مشاركة المهمة مع المسؤول، ويمكنه الآن رؤيتها أو تفويضها لموظف آخر. ستحتاج إلى إغلاق جميع المهام الفرعية قبل إرسال المهمة للموافقة.</div> : <><p>يمكنك مشاركة المهمة مع المسؤول الآن حتى عند وجود مهام فرعية مفتوحة. لن تُرسل للموافقة إلا بعد إغلاقها جميعًا.</p><button type="button" className="share-task-button" onClick={submitPrivateTask} disabled={saving} title="Share private task with manager"><ButtonLabel en="Share with Manager" ar="مشاركة مع المسؤول" /></button></>}</div>}
        {management && <div className="form-section manager-section"><h3>Manager Review <span>مراجعة المسؤول</span></h3><div className="review-choice">{(["new", "pending", "returned", "approved"] as const).map((value) => <button type="button" key={value} className={form.managerCheck === value ? `selected ${value}` : value} onClick={() => updateForm("managerCheck", value)}>{checkLabel[value]}</button>)}</div></div>}
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
          {canComment && <div className="comment-composer"><label className="wide"><span>{selectedId ? "Add a note · أضف ملاحظة" : "Initial note (optional) · ملاحظة أولية (اختيارية)"}</span><textarea maxLength={2000} rows={3} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="اكتب تحديثًا أو ملاحظة مرتبطة بهذه المهمة..." /></label><div><small>{commentDraft.length}/2000</small>{selectedId && <button type="button" className="comment-button" onClick={addComment} disabled={savingComment || !commentDraft.trim()}><ButtonLabel en={savingComment ? "Posting..." : "Post note"} ar={savingComment ? "جاري الإضافة..." : "إضافة الملاحظة"} /></button>}</div></div>}
        </div>
        {selectedId && task && (issueLink || (isManagement(currentUser) && task.project !== "PERSONAL")) && <div className="form-section task-to-issue-section"><h3>{issueLink ? (task.createdAt <= issueLink.createdAt ? "Converted to Issue" : "Converted from Issue") : "Convert to Issue"} <span>{issueLink ? "سجل مرتبط" : "تحويل المهمة إلى مشكلة"}</span></h3>{issueLink ? <><p>{task.createdAt <= issueLink.createdAt ? "This task was converted to a linked issue." : "This task was created from a linked issue."}</p><button type="button" className={`record-link-button ${task.createdAt <= issueLink.createdAt ? "task-first" : "issue-first"}`} onClick={() => onOpenIssue(issueLink)}>Open {issueLink.issueNumber}</button></> : <><p>Create a project issue from this task. The records will stay linked automatically.</p>{convertIssueError && <div className="inline-form-error">{convertIssueError}</div>}<label className="wide"><span>Description · وصف المشكلة</span><textarea rows={3} maxLength={2000} value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} /></label><div className="form-grid"><label><span>Discipline · التخصص</span><select value={issueDiscipline} disabled={currentUser?.role === "manager" && currentUser.discipline !== "Manager"} onChange={(event) => setIssueDiscipline(event.target.value as Discipline)}>{disciplines.filter((discipline) => discipline !== "Manager").map((discipline) => <option key={discipline}>{discipline}</option>)}</select></label><label><span>Category · التصنيف</span><input maxLength={120} value={issueCategory} onChange={(event) => setIssueCategory(event.target.value)} /></label><label><span>Issue Date · تاريخ المشكلة</span><input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label></div><button type="button" className="convert-issue-button" onClick={() => void convertTaskToIssue()} disabled={convertingIssue || !issueDescription.trim()}>{convertingIssue ? "Creating Issue..." : "Convert and Link Issue"}</button></>}</div>}
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
    if (!owner || !form.memberEmails.includes(email)) return;
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
        <div className="form-section"><div className="comments-heading project-team-heading"><h3>Project Team <span>فريق المشروع</span></h3><div className="project-team-controls"><label className="search-box project-team-search"><span>⌕</span><input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search employee..." aria-label="Search project employees" /></label><select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)} aria-label="Filter project team by discipline"><option value="all">All disciplines · كل التخصصات</option>{availableDisciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}</select><span aria-label={`${form.memberEmails.length} selected project members`}>{form.memberEmails.length}</span></div></div>{teamMembers.length === 0 ? <div className="comments-empty">أضف الموظفين أولاً من بوابة الفريق.</div> : filteredTeamMembers.length === 0 ? <div className="comments-empty">No matching employees · لا يوجد موظفون مطابقون</div> : <div className="member-picker">{filteredTeamMembers.map((user) => { const selected = form.memberEmails.includes(user.email); const projectManager = form.projectManagerEmails.includes(user.email); return <div key={user.email} className={`member-picker-row${selected ? " selected" : ""}${projectManager ? " project-manager" : ""}`}><label className="member-select"><input type="checkbox" disabled={!canEditTeam} checked={selected} onChange={() => toggleMember(user)} /><UserAvatar user={user} name={user.displayName} /><span><strong>{user.displayName} <em className="member-role">({roleLabel(user.role)})</em></strong><small className="project-member-email" dir="ltr">{user.email}</small><small>{user.discipline || "Team member"}</small></span></label>{(owner || (manager && user.role === "member" && user.discipline === currentUser?.discipline)) && <button type="button" className="project-member-settings" onClick={() => onEditUser(user)} aria-label={`Edit ${user.displayName}`} title="Edit employee">⚙</button>}<label className="project-manager-toggle" title={!owner ? "Only the owner can assign project managers" : selected ? "Grant full project visibility" : "Select the employee first"}><input type="checkbox" disabled={!owner || !selected} checked={projectManager} onChange={() => toggleProjectManager(user.email)} /><span>Project Manager</span></label></div>; })}</div>}
          {removalWarning && <div className="member-removal-warning" role="alert"><strong>Employee cannot be removed yet · لا يمكن إزالة هذا الموظف الآن</strong><p>لدى {removalWarning.user.displayName} عدد {removalWarning.taskCount} من المهام على مشروع {projectCode}. يجب تغيير الموظف المسؤول إلى موظف آخر لديه صلاحية على المشروع قبل الإزالة.</p><small>{removalWarning.user.displayName} has {removalWarning.taskCount} assigned task(s) on this project. Reassign them to another authorized project member first.</small><button type="button" onClick={() => onResolveMemberTasks(removalWarning.user, projectCode)}><ButtonLabel en="Open filtered tasks" ar="الذهاب إلى المهام وتغيير الموظف" /></button><em>إذا لم يوجد بديل، أضف موظفًا آخر إلى المشروع واحفظه أولًا. · If no replacement is available, add another member and save the project first.</em></div>}
        </div>
        <div className="drawer-actions">{owner && selectedId && <button type="button" className="delete-button" onClick={deleteProject} disabled={saving}><ButtonLabel en="Delete Project" ar="حذف المشروع" /></button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Close" ar="إغلاق" /></button>{canEditTeam && <button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selectedId ? "Save Changes" : "Add Project"} ar={saving ? "جاري الحفظ..." : selectedId ? "حفظ التعديلات" : "إضافة المشروع"} /></button>}</div>
      </form>
    </aside>
  </div>;
}

function UserDrawer({ selectedEmail, selectedUser, form, setForm, setOpen, saveUser, deleteUser, saving, currentUser, projects, onProjectSettings, onProfileImageChange }: { selectedEmail: string | null; selectedUser: User | null; form: UserForm; setForm: (value: UserForm) => void; setOpen: (value: boolean) => void; saveUser: (event: FormEvent) => void; deleteUser: () => void; saving: boolean; currentUser: User | null; projects: Project[]; onProjectSettings: (project: Project) => void; onProfileImageChange: (email: string, profileImageKey: string) => void; }) {
  const managerLimited = currentUser?.role === "manager";
  const owner = currentUser?.role === "owner";
  const disciplineOptions = managerLimited && currentUser?.discipline ? [currentUser.discipline] : disciplines;
  const assignedProjects = selectedEmail ? projects.filter((project) => project.memberEmails.includes(selectedEmail)) : [];
  const [imageBusy, setImageBusy] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const [imageError, setImageError] = useState("");
  const confirm = useAppConfirm();

  async function changeManagedProfileImage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const image = input.files?.[0];
    if (!image || !selectedEmail || !owner) return;
    setImageBusy(true); setImageUploadProgress(1); setImageError("");
    try {
      const data = await uploadProfileImageFile(image, selectedEmail, setImageUploadProgress);
      onProfileImageChange(selectedEmail, data.profileImageKey);
      await new Promise((resolve) => window.setTimeout(resolve, 280));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Unable to update profile image.");
    } finally {
      input.value = "";
      setImageUploadProgress(0);
      setImageBusy(false);
    }
  }

  async function removeManagedProfileImage() {
    if (!selectedEmail || !owner) return;
    const approved = await confirm({ title: "Delete profile image?", titleAr: "حذف صورة المستخدم؟", message: `The profile image for ${form.displayName} will be removed.`, messageAr: `سيتم حذف صورة المستخدم ${form.displayName}.`, confirmLabel: "Delete image", confirmLabelAr: "حذف الصورة" });
    if (!approved) return;
    setImageBusy(true); setImageError("");
    try {
      const response = await fetch("/api/profile-image?action=remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: selectedEmail }) });
      const data = await profileImageResponse(response, "Unable to remove profile image.");
      onProfileImageChange(selectedEmail, data.profileImageKey || "");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Unable to remove profile image.");
    } finally {
      setImageBusy(false);
    }
  }

  const progressStyle = { "--profile-upload-progress": `${imageUploadProgress * 3.6}deg` } as CSSProperties;
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Employee information">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="Close" />
    <aside className="task-drawer compact-drawer">
      <div className="drawer-head user-drawer-head"><div className="user-drawer-heading"><div className="user-drawer-photo"><UserAvatar user={selectedUser || undefined} name={form.displayName || "New Team"} className="user-drawer-avatar" />{imageBusy && imageUploadProgress > 0 && <div className="user-photo-progress" style={progressStyle} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={imageUploadProgress} aria-label={`Uploading profile image ${imageUploadProgress}%`}><span>{imageUploadProgress}%</span></div>}{owner && selectedEmail && <label className={`user-photo-change${imageBusy ? " disabled" : ""}`} title="Change user image" aria-label="Change user image"><span>✎</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy} onChange={changeManagedProfileImage} /></label>}{owner && selectedEmail && <button type="button" className="user-photo-remove" onClick={removeManagedProfileImage} disabled={imageBusy} aria-label="Remove user image" title="Remove user image">×</button>}</div><div className="user-drawer-title"><p>TEAM MEMBER</p><h2 className="drawer-record-title">{selectedEmail ? <><span>{form.displayName}</span> Edit</> : "New Team"}</h2>{imageError && <small role="alert">{imageError}</small>}</div></div><button className="close-button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
      <form onSubmit={saveUser} className="task-form"><div className="form-section user-fields-section">
        <label className="wide"><span>Name · الاسم</span><input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Employee name · اسم الموظف" /></label>
        <label className="wide"><span>Discipline · التخصص</span><select required disabled={managerLimited} value={form.discipline} onChange={(event) => setForm({ ...form, discipline: event.target.value as Discipline })}><option value="" disabled>Select discipline · اختر التخصص</option>{disciplineOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <label className="wide"><span>Email · البريد</span><input required type="email" disabled={Boolean(selectedEmail)} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@eng-bim.com" /></label>
        <label className="wide"><span>{selectedEmail ? "New Password · كلمة مرور جديدة" : "Temporary Password · كلمة مرور مؤقتة"}</span><PasswordInput required={!selectedEmail} minLength={10} value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} placeholder={selectedEmail ? "Leave blank to keep unchanged · اتركها فارغة دون تغيير" : "At least 10 characters · 10 أحرف على الأقل"} autoComplete="new-password" /></label>
        <label className="wide"><span>Role · الصلاحية داخل النظام</span><select disabled={managerLimited} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as User["role"] })}><option value="member">Member · موظف</option>{!managerLimited && <option value="manager">Manager · مسؤول</option>}{currentUser?.role === "owner" && <option value="owner">Owner · المالك</option>}</select></label>
        {managerLimited && <div className="temporary-note">يمكنك إضافة وإدارة موظفين من تخصصك فقط: {currentUser?.discipline || "غير محدد"}.</div>}{form.role === "owner" && <div className="owner-warning">المالك لديه أعلى صلاحيات النظام، بما فيها إضافة ملاك آخرين واستعادة النسخ الاحتياطية.</div>}<div className="temporary-note">أرسل للمستخدم كلمة المرور المؤقتة بطريقة آمنة. يستطيع تغييرها من حسابه بعد تسجيل الدخول.</div>
      </div>{selectedEmail && <div className="form-section user-projects-section"><div className="comments-heading"><h3>Assigned Projects <span>المشاريع المدرج عليها الموظف</span></h3><span>{assignedProjects.length}</span></div>{assignedProjects.length ? <div className="assigned-project-list">{assignedProjects.map((project) => <div key={project.id}><strong>{project.code}</strong><span>{project.name}</span>{isManagement(currentUser) && <button type="button" className="assigned-project-settings" onClick={() => onProjectSettings(project)} aria-label={`Edit ${project.name}`} title="Project settings">⚙</button>}</div>)}</div> : <div className="comments-empty">No assigned projects · غير مدرج على أي مشروع</div>}</div>}<div className="drawer-actions">{selectedEmail && selectedEmail !== currentUser?.email && <button type="button" className="delete-button" onClick={deleteUser} disabled={saving}><ButtonLabel en="Delete Employee" ar="حذف الموظف" /></button>}<button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Cancel" ar="إلغاء" /></button><button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selectedEmail ? "Save Changes" : "Add Employee"} ar={saving ? "جاري الحفظ..." : selectedEmail ? "حفظ التعديلات" : "إضافة المستخدم"} /></button></div></form>
    </aside>
  </div>;
}

function PasswordDrawer({ form, setForm, setOpen, changePassword, saving }: { form: PasswordForm; setForm: (value: PasswordForm) => void; setOpen: (value: boolean) => void; changePassword: (event: FormEvent) => void; saving: boolean; }) {
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Change password">
    <button className="drawer-backdrop" onClick={() => setOpen(false)} aria-label="Close" />
    <aside className="task-drawer compact-drawer password-drawer" dir="ltr">
      <div className="drawer-head"><div><p>ACCOUNT SECURITY</p><h2>Change password</h2></div><button className="close-button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
      <form onSubmit={changePassword} className="task-form password-form">
        <div className="password-intro"><span>•••</span><div><strong>Keep your account secure</strong><p>Use at least 10 characters. Changing your password signs out your other sessions.</p></div></div>
        <div className="form-section">
          <label className="wide"><span>Current password</span><PasswordInput required value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} autoComplete="current-password" /></label>
          <label className="wide"><span>New password</span><PasswordInput required minLength={10} value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} autoComplete="new-password" /></label>
          <label className="wide"><span>Confirm new password</span><PasswordInput required minLength={10} value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} autoComplete="new-password" /></label>
        </div>
        <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}><ButtonLabel en="Cancel" ar="إلغاء" /></button><button type="submit" className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Updating…" : "Update password"} ar={saving ? "جاري التحديث…" : "تحديث كلمة المرور"} /></button></div>
      </form>
    </aside>
  </div>;
}
