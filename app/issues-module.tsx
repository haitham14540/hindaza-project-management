/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

export type IssueDiscipline = "Architecture" | "ID" | "Structure" | "Mechanical" | "Electrical" | "Infrastructure";
export type IssueUser = { email: string; displayName: string; role: "owner" | "manager" | "member"; discipline: IssueDiscipline | "Manager" | "" };
export type IssueProject = { id: number; code: string; name: string; memberEmails: string[] };
export type IssueLinkedTask = { id: number; [key: string]: unknown };
type Attachment = { id: number; issueId: number; fileName: string; contentType: string; sizeBytes: number; uploadedBy: string; source: "internal" | "client"; createdAt: string };
type Issue = {
  id: number;
  issueNumber: string;
  sequence: number;
  projectCode: string;
  status: "open" | "re_open" | "closed";
  discipline: IssueDiscipline;
  description: string;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  assigneeEmail: string;
  raisedByEmail: string;
  raisedByName: string;
  issueDate: string;
  resolvedDate: string;
  comments: string;
  clientReply: string;
  convertedTaskId: number | null;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
};
type IssueForm = Pick<Issue, "projectCode" | "status" | "discipline" | "description" | "category" | "priority" | "raisedByEmail" | "issueDate" | "resolvedDate" | "comments" | "clientReply">;

const disciplines: IssueDiscipline[] = ["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"];
const disciplineCode: Record<IssueDiscipline, string> = { Architecture: "ARC", ID: "ID", Structure: "STR", Mechanical: "MECH", Electrical: "ELEC", Infrastructure: "INF" };
const disciplineLabel: Record<IssueDiscipline, string> = { Architecture: "Architecture (ARC)", ID: "Interior Design (ID)", Structure: "Structure (STR)", Mechanical: "Mechanical (MECH)", Electrical: "Electrical (ELEC)", Infrastructure: "Infrastructure (INF)" };
const statusLabel = { open: "Open · مفتوحة", re_open: "Re-Open · أعيد فتحها", closed: "Closed · مغلقة" } as const;
const priorityLabel = { low: "Low · منخفضة", medium: "Medium · متوسطة", high: "High · عالية", critical: "Critical · حرجة" } as const;

function today() {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function normalizedDiscipline(value: string): IssueDiscipline { return disciplines.includes(value as IssueDiscipline) ? value as IssueDiscipline : "Architecture"; }
function blankIssue(projects: IssueProject[], user: IssueUser): IssueForm {
  return { projectCode: projects[0]?.code || "", status: "open", discipline: normalizedDiscipline(user.discipline), description: "", category: "", priority: "medium", raisedByEmail: user.role === "member" ? user.email : "", issueDate: today(), resolvedDate: "", comments: "", clientReply: "" };
}
function dateLabel(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`)).toUpperCase();
}
function bytesLabel(value: number) { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }
function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function ButtonLabel({ en, ar }: { en: string; ar: string }) { return <span className="button-label"><strong>{en}</strong><small dir="rtl">{ar}</small></span>; }

function AttachmentCards({ attachments, onRemove }: { attachments: Attachment[]; onRemove: (attachment: Attachment) => void }) {
  if (!attachments.length) return null;
  return <div className="attachment-grid">{attachments.map((attachment) => <article key={attachment.id}>{attachment.contentType.startsWith("image/") ? <img src={`/api/issue-attachments?id=${attachment.id}`} alt={attachment.fileName} /> : attachment.contentType === "application/pdf" ? <div className="pdf-preview">PDF</div> : <div className="file-preview">{attachment.fileName.split(".").pop()?.slice(0, 5).toUpperCase() || "FILE"}</div>}<div><strong title={attachment.fileName}>{attachment.fileName}</strong><small>{bytesLabel(attachment.sizeBytes)}</small></div><div className="attachment-actions"><a href={`/api/issue-attachments?id=${attachment.id}`} target="_blank" rel="noreferrer">View</a><a href={`/api/issue-attachments?id=${attachment.id}&download=1`}>Download</a><button type="button" onClick={() => onRemove(attachment)}>×</button></div></article>)}</div>;
}

async function jsonResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

export type IssuesModuleHandle = { openNew: () => void; openIssue: (id: number) => void };

export const IssuesModule = forwardRef<IssuesModuleHandle, {
  currentUser: IssueUser;
  users: IssueUser[];
  projects: IssueProject[];
  onTaskCreated: (task: IssueLinkedTask) => void;
  onOpenTask: (id: number) => void;
  onToast: (message: string) => void;
}>(function IssuesModule({ currentUser, users, projects, onTaskCreated, onOpenTask, onToast }, ref) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<IssueForm>(() => blankIssue(projects, currentUser));
  const [files, setFiles] = useState<File[]>([]);
  const [clientFiles, setClientFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [convertEmployee, setConvertEmployee] = useState("");
  const [convertDueDate, setConvertDueDate] = useState(today());
  const [convertHours, setConvertHours] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await jsonResponse(await fetch("/api/issues", { cache: "no-store" }));
      setIssues(data.issues || []);
      setCategories(data.categories || []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل مشاكل المشاريع");
    } finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 5_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const selected = issues.find((issue) => issue.id === selectedId) || null;
  const filtered = useMemo(() => issues.filter((issue) => {
    const term = search.trim().toLowerCase();
    const text = `${issue.issueNumber} ${issue.description} ${issue.category} ${issue.projectCode} ${issue.raisedByName}`.toLowerCase();
    return (!term || text.includes(term)) && (projectFilter === "all" || issue.projectCode === projectFilter) && (statusFilter === "all" || issue.status === statusFilter) && (disciplineFilter === "all" || issue.discipline === disciplineFilter) && (priorityFilter === "all" || issue.priority === priorityFilter);
  }).sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.discipline.localeCompare(b.discipline) || a.sequence - b.sequence || a.id - b.id), [issues, search, projectFilter, statusFilter, disciplineFilter, priorityFilter]);
  const stats = useMemo(() => ({ total: issues.length, open: issues.filter((issue) => issue.status === "open").length, reopen: issues.filter((issue) => issue.status === "re_open").length, closed: issues.filter((issue) => issue.status === "closed").length, critical: issues.filter((issue) => issue.priority === "critical" && issue.status !== "closed").length }), [issues]);
  const filtersActive = Boolean(search.trim()) || projectFilter !== "all" || disciplineFilter !== "all" || statusFilter !== "all" || priorityFilter !== "all";
  const selectedProject = useMemo(() => projects.find((item) => item.code === form.projectCode), [projects, form.projectCode]);
  const conversionProject = useMemo(() => projects.find((item) => item.code === selected?.projectCode), [projects, selected]);
  const projectMembers = useMemo(() => {
    return users.filter((user) => (user.role === "member" || user.role === "manager") && conversionProject?.memberEmails.includes(user.email) && user.discipline === selected?.discipline);
  }, [users, conversionProject, selected]);
  const disciplineOptions = currentUser.role === "member" ? [normalizedDiscipline(currentUser.discipline)] : disciplines;
  const raisedByOptions = useMemo(() => users.filter((user) => selectedProject?.memberEmails.includes(user.email) && user.discipline === form.discipline), [users, selectedProject, form.discipline]);
  const issueClosed = form.status === "closed";
  const internalAttachments = selected?.attachments.filter((attachment) => attachment.source !== "client") || [];
  const clientAttachments = selected?.attachments.filter((attachment) => attachment.source === "client") || [];
  const statusOptions = useMemo(() => {
    if (!selected) return ["open"] as Array<Issue["status"]>;
    if (selected.status === "closed" || selected.status === "re_open" || form.status === "re_open") return ["re_open", "closed"] as Array<Issue["status"]>;
    return ["open", "closed"] as Array<Issue["status"]>;
  }, [selected, form.status]);

  function changeStatus(status: Issue["status"]) {
    setForm((current) => ({ ...current, status, resolvedDate: status === "closed" ? today() : "" }));
  }

  const openIssue = useCallback((issue: Issue) => {
    setSelectedId(issue.id);
    const discipline = normalizedDiscipline(issue.discipline);
    const project = projects.find((item) => item.code === issue.projectCode);
    const raisedByEmail = users.find((user) => user.email === issue.raisedByEmail && user.discipline === discipline && project?.memberEmails.includes(user.email))?.email || (currentUser.role === "member" ? currentUser.email : "");
    setForm({ projectCode: issue.projectCode, status: issue.status, discipline, description: issue.description, category: issue.category, priority: issue.priority, raisedByEmail, issueDate: issue.issueDate, resolvedDate: issue.resolvedDate, comments: issue.comments, clientReply: issue.clientReply || "" });
    setFiles([]); setClientFiles([]); setConvertEmployee(""); setConvertDueDate(today()); setConvertHours(0); setAddingCategory(false); setNewCategory(""); setDrawerOpen(true);
  }, [currentUser, users, projects]);
  const openNew = useCallback(() => {
    setSelectedId(null); setForm(blankIssue(projects, currentUser)); setFiles([]); setClientFiles([]); setConvertEmployee(""); setAddingCategory(false); setNewCategory(""); setDrawerOpen(true);
  }, [projects, currentUser]);
  const openIssueById = useCallback((id: number) => {
    const issue = issues.find((item) => item.id === id);
    if (issue) openIssue(issue);
    else void fetch("/api/issues", { cache: "no-store" }).then(jsonResponse).then((data) => {
      const rows = (data.issues || []) as Issue[];
      setIssues(rows); setCategories(data.categories || []);
      const row = rows.find((item) => item.id === id);
      if (row) openIssue(row);
    }).catch((openError) => setError(openError instanceof Error ? openError.message : "Unable to open the issue."));
  }, [issues, openIssue]);
  useImperativeHandle(ref, () => ({ openNew, openIssue: openIssueById }), [openNew, openIssueById]);
  async function uploadFiles(issueId: number, source: "internal" | "client", selectedFiles: File[]) {
    if (!selectedFiles.length) return [];
    const body = new FormData(); body.append("issueId", String(issueId)); body.append("source", source); selectedFiles.forEach((file) => body.append("files", file));
    const data = await jsonResponse(await fetch("/api/issue-attachments", { method: "POST", body }));
    return data.attachments as Attachment[];
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true; setSaving(true); setError("");
    try {
      const data = await jsonResponse(await fetch("/api/issues", { method: selectedId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selectedId ? { ...form, id: selectedId } : form) }));
      const [uploaded, uploadedClient] = await Promise.all([uploadFiles(data.issue.id, "internal", files), uploadFiles(data.issue.id, "client", clientFiles)]);
      const issue = { ...data.issue, attachments: [...(data.issue.attachments || []), ...uploaded, ...uploadedClient] } as Issue;
      setIssues((current) => selectedId ? current.map((item) => item.id === selectedId ? issue : item) : [issue, ...current.filter((item) => item.id !== issue.id)]);
      setFiles([]); setClientFiles([]); setDrawerOpen(false);
      onToast(selectedId ? "Project issue updated · تم تحديث المشكلة" : "Project issue created · تمت إضافة المشكلة");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المشكلة"); }
    finally { saveInFlightRef.current = false; setSaving(false); }
  }
  async function removeIssue() {
    if (!selected || !window.confirm(`Delete ${selected.issueNumber}?\nهل تريد حذف هذه المشكلة وإعادة ترقيم المجموعة؟`)) return;
    setSaving(true);
    try {
      const data = await jsonResponse(await fetch(`/api/issues?id=${selected.id}`, { method: "DELETE" }));
      setIssues(data.issues || []); setDrawerOpen(false); onToast("Project issue deleted · تم حذف المشكلة");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف المشكلة"); }
    finally { setSaving(false); }
  }
  async function removeAttachment(attachment: Attachment) {
    if (!window.confirm(`Delete ${attachment.fileName}?`)) return;
    try {
      await jsonResponse(await fetch(`/api/issue-attachments?id=${attachment.id}`, { method: "DELETE" }));
      setIssues((current) => current.map((issue) => issue.id === attachment.issueId ? { ...issue, attachments: issue.attachments.filter((item) => item.id !== attachment.id) } : issue));
      onToast("Attachment deleted · تم حذف المرفق");
    } catch (attachmentError) { setError(attachmentError instanceof Error ? attachmentError.message : "تعذر حذف المرفق"); }
  }
  async function convertToTask() {
    if (!selected || !convertEmployee) return;
    setSaving(true); setError("");
    try {
      const data = await jsonResponse(await fetch("/api/issues/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueId: selected.id, employeeEmail: convertEmployee, dueDate: convertDueDate, plannedHours: convertHours }) }));
      setIssues((current) => current.map((issue) => issue.id === selected.id ? { ...issue, ...data.issue } : issue));
      onTaskCreated(data.task); setDrawerOpen(false); onToast("Issue converted to task · تم تحويل المشكلة إلى مهمة"); onOpenTask(data.task.id);
    } catch (convertError) { setError(convertError instanceof Error ? convertError.message : "تعذر تحويل المشكلة إلى مهمة"); }
    finally { setSaving(false); }
  }

  return <>
    {error && <div className="error-banner issue-error"><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
    <section className="issue-stats" aria-label="Project issue summary">
      <article><span>Total Issues · إجمالي المشاكل</span><strong>{stats.total}</strong></article><article className="issue-open"><span>Open · مفتوحة</span><strong>{stats.open}</strong></article><article className="issue-reopen"><span>Re-Open · أعيد فتحها</span><strong>{stats.reopen}</strong></article><article className="issue-closed"><span>Closed · مغلقة</span><strong>{stats.closed}</strong></article><article className="issue-critical"><span>Critical · حرجة</span><strong>{stats.critical}</strong></article>
    </section>
    <section className="panel issues-panel">
      <div className="issue-filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issue number, description, or category..." /><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects · كل المشاريع</option>{projects.map((project) => <option key={project.id} value={project.code}>{project.code} · {project.name}</option>)}</select><select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)}><option value="all">All disciplines · كل التخصصات</option>{disciplines.map((discipline) => <option key={discipline} value={discipline}>{disciplineLabel[discipline]}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses · كل الحالات</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities · كل الأولويات</option>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="clear-filters-button" disabled={!filtersActive} onClick={() => { setSearch(""); setProjectFilter("all"); setDisciplineFilter("all"); setStatusFilter("all"); setPriorityFilter("all"); }} aria-label="Clear all project issue filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count">{filtered.length} Issues</span></div>
      {loading ? <div className="loading-state"><div className="spinner" /><p>Loading project issues...</p></div> : filtered.length === 0 ? <div className="empty-state"><strong>No project issues found</strong><p>لا توجد مشاكل مطابقة. أضف أول مشكلة أو غيّر الفلاتر.</p></div> : <div className="task-table-wrap"><table className="task-table issue-table"><thead><tr><th>Issue Number</th><th>Description</th><th>Project / Discipline</th><th>Status</th><th>Priority</th><th>Raised By</th><th>Issue Date</th><th>Resolved Date</th><th>Task Link</th></tr></thead><tbody>{filtered.map((issue) => { const raisedBy = users.find((user) => user.email === issue.raisedByEmail); const internalCount = issue.attachments.filter((attachment) => attachment.source !== "client").length; const clientCount = issue.attachments.filter((attachment) => attachment.source === "client").length; return <tr key={issue.id} onClick={() => openIssue(issue)}><td><div className="issue-number-cell"><strong className="issue-number" dir="ltr">{issue.issueNumber}</strong><div className="issue-record-meta">{issue.comments.trim() && <span className="note-indicator" title="Notes available · توجد ملاحظات" aria-label="1 note">▰ <small>1</small></span>}<span className={`attachment-count${internalCount ? "" : " empty"}`} title={`${internalCount} attachments`} aria-label={`${internalCount} attachments`}>📎 <small>{internalCount}</small></span></div></div></td><td><div className="issue-description"><strong>{issue.description}</strong><small>{issue.category || "Uncategorized"} · Raised by {issue.raisedByName}</small></div></td><td><span className="project-code">{issue.projectCode}</span><small className="issue-discipline">{disciplineLabel[normalizedDiscipline(issue.discipline)]}</small></td><td><span className={`issue-pill issue-status-${issue.status}`}>{statusLabel[issue.status]}</span></td><td><span className={`issue-pill issue-priority-${issue.priority}`}>{priorityLabel[issue.priority]}</span></td><td>{raisedBy ? <div className="employee-cell"><span className="avatar small">{initials(raisedBy.displayName)}</span><strong>{raisedBy.displayName}</strong></div> : issue.raisedByName || "—"}</td><td dir="ltr">{dateLabel(issue.issueDate)}</td><td><div className="resolved-date-cell"><strong dir="ltr">{dateLabel(issue.resolvedDate)}</strong><div className="client-response-meta">{issue.clientReply.trim() && <span className="client-reply-indicator" title="Client reply received · تم استلام رد العميل">💬</span>}<span className={`client-attachment-indicator${clientCount ? "" : " empty"}`} title={`${clientCount} client attachments`} aria-label={`${clientCount} client attachments`}>📎 <small>{clientCount}</small></span></div></div></td><td>{issue.convertedTaskId ? <button className="linked-task-button" onClick={(event) => { event.stopPropagation(); onOpenTask(issue.convertedTaskId!); }}><ButtonLabel en={`Modified to task · #${issue.convertedTaskId}`} ar="تحولت إلى مهمة" /></button> : "—"}</td></tr>; })}</tbody></table></div>}
    </section>
    {drawerOpen && <div className="drawer-layer" role="dialog" aria-modal="true"><button className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-label="Close" /><aside className="task-drawer issue-drawer"><div className="drawer-head"><div><p>PROJECT ISSUE</p><h2>{selected ? selected.issueNumber : `New ${form.projectCode || "Project"}-${disciplineCode[form.discipline]}-###`}</h2>{selected?.convertedTaskId && <span className="drawer-private-label">Modified to task · تحولت إلى مهمة #{selected.convertedTaskId}</span>}</div><button className="close-button" onClick={() => setDrawerOpen(false)}>×</button></div><form className="task-form" onSubmit={save}>
      <div className="form-section"><h3>Issue Identification <span>بيانات المشكلة</span></h3>{issueClosed && <div className="closed-issue-note">Closed issue fields are locked. Select Re-Open to edit them again.<small>حقول المشكلة المغلقة مقفلة. اختر إعادة الفتح لتعديلها.</small></div>}<div className="form-grid"><label><span>Project · المشروع</span><select required disabled={issueClosed} value={form.projectCode} onChange={(event) => { const projectCode = event.target.value; const project = projects.find((item) => item.code === projectCode); setConvertEmployee(""); setForm((current) => ({ ...current, projectCode, raisedByEmail: project?.memberEmails.includes(current.raisedByEmail) ? current.raisedByEmail : "" })); }}><option value="" disabled>Select project</option>{projects.map((project) => <option key={project.id} value={project.code}>{project.code} · {project.name}</option>)}</select></label><label><span>Discipline · التخصص</span><select required disabled={currentUser.role === "member" || issueClosed} value={form.discipline} onChange={(event) => { const discipline = event.target.value as IssueDiscipline; const currentRaisedBy = users.find((user) => user.email === form.raisedByEmail); setConvertEmployee(""); setForm({ ...form, discipline, raisedByEmail: currentRaisedBy?.discipline === discipline && selectedProject?.memberEmails.includes(currentRaisedBy.email) ? form.raisedByEmail : "" }); }}>{disciplineOptions.map((discipline) => <option key={discipline} value={discipline}>{disciplineLabel[discipline]}</option>)}</select></label></div><label className="wide"><span>Description · الوصف</span><textarea required disabled={issueClosed} rows={4} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the project issue clearly..." /></label><div className="form-grid issue-category-priority-grid"><div className="issue-category-field"><label><span>Category · التصنيف</span><select required disabled={issueClosed} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="" disabled>Select category</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><button type="button" className="add-category-button" disabled={issueClosed} onClick={() => { setAddingCategory((value) => !value); setNewCategory(""); }}><ButtonLabel en="＋ Add Category" ar="إضافة تصنيف" /></button>{addingCategory && <div className="new-category-row"><input maxLength={120} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category name" /><button type="button" disabled={!newCategory.trim()} onClick={() => { const value = newCategory.trim(); if (!value) return; setCategories((current) => Array.from(new Set([...current, value])).sort((a, b) => a.localeCompare(b))); setForm({ ...form, category: value }); setAddingCategory(false); setNewCategory(""); }}><ButtonLabel en="Use Category" ar="استخدام التصنيف" /></button></div>}</div><label><span>Priority · الأولوية</span><select disabled={issueClosed} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Issue["priority"] })}>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></div>
      <div className="form-section issue-details-section"><h3>Responsibility & Dates <span>المسؤولية والتواريخ</span></h3><div className="form-grid"><label><span>Status · الحالة</span><select value={form.status} onChange={(event) => changeStatus(event.target.value as Issue["status"])}>{statusOptions.map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></label><label><span>Raised by · بواسطة</span>{currentUser.role === "member" ? <input value={currentUser.displayName} disabled /> : <select required disabled={issueClosed} value={form.raisedByEmail} onChange={(event) => setForm({ ...form, raisedByEmail: event.target.value })}><option value="" disabled>Select project team member</option>{raisedByOptions.map((user) => <option key={user.email} value={user.email}>{user.displayName} · {disciplineLabel[form.discipline]}</option>)}</select>}</label></div><div className="form-grid"><label><span>Issue Date · تاريخ المشكلة</span><input type="date" required disabled={issueClosed} value={form.issueDate} onChange={(event) => setForm({ ...form, issueDate: event.target.value })} /></label><label><span>Resolved Date · تاريخ الإغلاق</span><input type="date" disabled={!issueClosed} value={form.resolvedDate} onChange={(event) => setForm({ ...form, resolvedDate: event.target.value })} /><small className="automatic-date-note">Set automatically on closing; adjust it when recording a past closure · يُحدد تلقائيًا ويمكن تصحيحه</small></label></div><label className="wide"><span>Notes · الملاحظات</span><textarea rows={4} maxLength={4000} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} placeholder="Add notes, decisions, or follow-up details..." /></label></div>
      <div className="form-section issue-attachments-section"><div className="comments-heading"><h3>Issue Attachments <span>مرفقات المشكلة</span></h3><span>{internalAttachments.length + files.length}/10</span></div><label className="issue-upload"><strong>＋ Add issue attachments</strong><span>Any file type · multiple files · maximum 10 MB each</span><input type="file" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files || []))} /></label>{files.length > 0 && <div className="pending-files">{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name} <small>{bytesLabel(file.size)}</small></span>)}</div>}<AttachmentCards attachments={internalAttachments} onRemove={(attachment) => void removeAttachment(attachment)} /></div>
      {selected && <div className="form-section client-response-section"><div className="comments-heading"><h3>Client Response <span>رد العميل</span></h3><span>{clientAttachments.length + clientFiles.length}</span></div><label className="wide"><span>Client Reply · رد العميل</span><textarea rows={4} maxLength={4000} value={form.clientReply} onChange={(event) => setForm({ ...form, clientReply: event.target.value })} placeholder="Record the reply, decision, or direction received from the client..." /></label><label className="issue-upload client-upload"><strong>＋ Add client attachments</strong><span>Any file type · multiple files · maximum 10 MB each</span><input type="file" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => setClientFiles(Array.from(event.target.files || []))} /></label>{clientFiles.length > 0 && <div className="pending-files">{clientFiles.map((file) => <span key={`${file.name}-${file.size}`}>{file.name} <small>{bytesLabel(file.size)}</small></span>)}</div>}<AttachmentCards attachments={clientAttachments} onRemove={(attachment) => void removeAttachment(attachment)} /></div>}
      {selected && (currentUser.role === "owner" || currentUser.role === "manager") && <div className="form-section issue-convert"><h3>Convert to Task <span>تحويل المشكلة إلى مهمة</span></h3>{selected.convertedTaskId ? <button type="button" className="linked-task-panel" onClick={() => onOpenTask(selected.convertedTaskId!)}><ButtonLabel en={`Open linked task #${selected.convertedTaskId}`} ar="فتح المهمة المرتبطة" /></button> : <><p>The task will be linked to {selected.issueNumber} and will appear immediately in Task Management.</p><div className="form-grid"><label><span>Project team member · موظف المشروع</span><select value={convertEmployee} onChange={(event) => setConvertEmployee(event.target.value)}><option value="">Select employee</option>{projectMembers.map((user) => <option key={user.email} value={user.email}>{user.displayName} · {user.discipline}</option>)}</select></label><label><span>Due Date · تاريخ الإنجاز المتوقع</span><input type="date" value={convertDueDate} onChange={(event) => setConvertDueDate(event.target.value)} /></label></div><label className="wide"><span>Planned Hours · الساعات المخططة</span><input type="number" min="0" step="0.25" value={convertHours} onChange={(event) => setConvertHours(Number(event.target.value))} /></label><button type="button" className="convert-task-button" disabled={!convertEmployee || saving} onClick={() => void convertToTask()}><ButtonLabel en="Convert and open Task Management" ar="تحويل وفتح المهام" /></button></>}</div>}
      <div className="drawer-actions">{selected && (currentUser.role === "owner" || (currentUser.role === "manager" && currentUser.discipline === selected.discipline)) && <button type="button" className="delete-button" disabled={saving} onClick={() => void removeIssue()}><ButtonLabel en="Delete Issue" ar="حذف المشكلة" /></button>}<button type="button" className="secondary-button" onClick={() => setDrawerOpen(false)}><ButtonLabel en="Cancel" ar="إلغاء" /></button><button className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selected ? "Save Changes" : "Create Issue"} ar={saving ? "جاري الحفظ..." : selected ? "حفظ التعديلات" : "إنشاء مشكلة"} /></button></div>
    </form></aside></div>}
  </>;
});

export function IssueReportPanel({ projects }: { projects: IssueProject[] }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [project, setProject] = useState("all");
  useEffect(() => { void fetch("/api/issues", { cache: "no-store" }).then(jsonResponse).then((data) => setIssues(data.issues || [])).catch(() => setIssues([])); }, []);
  const rows = issues.filter((issue) => project === "all" || issue.projectCode === project);
  const byProject = projects.map((item) => ({ code: item.code, total: rows.filter((issue) => issue.projectCode === item.code).length, open: rows.filter((issue) => issue.projectCode === item.code && issue.status !== "closed").length, closed: rows.filter((issue) => issue.projectCode === item.code && issue.status === "closed").length })).filter((row) => row.total > 0);
  return <section className="issue-report"><div className="panel report-controls"><div className="panel-heading"><div><h2>Project Issues Report</h2><p>تقرير أولي لمشاكل المشاريع</p></div></div><div className="report-filter-grid"><label><span>Project · المشروع</span><select value={project} onChange={(event) => setProject(event.target.value)}><option value="all">All projects</option>{projects.map((item) => <option key={item.id} value={item.code}>{item.code} · {item.name}</option>)}</select></label></div></div><div className="report-content"><section className="report-stats"><article><span>Total Issues</span><strong>{rows.length}</strong></article><article><span>Open / Re-Open</span><strong>{rows.filter((issue) => issue.status !== "closed").length}</strong></article><article><span>Closed</span><strong>{rows.filter((issue) => issue.status === "closed").length}</strong></article><article><span>Attachments</span><strong>{rows.reduce((sum, issue) => sum + issue.attachments.length, 0)}</strong></article></section><section className="panel"><div className="panel-heading"><div><h2>Issues by Project</h2><p>المشاكل حسب المشروع</p></div></div>{byProject.length ? <div className="task-table-wrap"><table className="task-table report-table"><thead><tr><th>Project</th><th>Total</th><th>Open / Re-Open</th><th>Closed</th></tr></thead><tbody>{byProject.map((row) => <tr key={row.code}><td><strong>{row.code}</strong></td><td>{row.total}</td><td>{row.open}</td><td>{row.closed}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No issue data</strong><p>لا توجد بيانات مشاكل للمشروع المختار.</p></div>}</section></div></section>;
}
