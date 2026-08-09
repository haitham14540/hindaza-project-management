/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useAppConfirm } from "./confirm-dialog";

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
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_SECTION = 10;

function today() {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function normalizedDiscipline(value: string): IssueDiscipline { return disciplines.includes(value as IssueDiscipline) ? value as IssueDiscipline : "Architecture"; }
function blankIssue(projects: IssueProject[], user: IssueUser, lockedProjectCode = ""): IssueForm {
  return { projectCode: lockedProjectCode || projects[0]?.code || "", status: "open", discipline: normalizedDiscipline(user.discipline), description: "", category: "", priority: "medium", raisedByEmail: user.role === "member" ? user.email : "", issueDate: today(), resolvedDate: "", comments: "", clientReply: "" };
}
function dateLabel(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`)).toUpperCase();
}
function bytesLabel(value: number) { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }
function initials(name: string) { return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function ButtonLabel({ en }: { en: string; ar: string }) { return <span className="button-label"><strong>{en}</strong></span>; }

function attachmentDate(value: string) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(normalized));
}

type OfficeKind = "word" | "excel" | "powerpoint";

function officeKind(attachment: Attachment): OfficeKind | null {
  const extension = attachment.fileName.split(".").pop()?.toLowerCase();
  if (extension === "docx" || attachment.contentType.includes("wordprocessingml")) return "word";
  if (["xlsx", "xls"].includes(extension || "") || attachment.contentType.includes("spreadsheet") || attachment.contentType.includes("ms-excel")) return "excel";
  if (extension === "pptx" || attachment.contentType.includes("presentationml")) return "powerpoint";
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function officeDocument(title: string, body: string, wide = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#f4f4f1;color:#222;font:14px/1.55 Arial,sans-serif}main{${wide ? "max-width:1200px" : "max-width:860px"};margin:auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:26px;box-shadow:0 10px 30px rgba(0,0,0,.06)}h1{font-size:18px;margin:0 0 22px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d9d9d4;padding:7px;text-align:left;vertical-align:top}tr:first-child{background:#fff8d6;font-weight:700}.slide{min-height:180px;margin:0 0 22px;padding:24px;border:1px solid #d9d9d4;border-left:5px solid #ffd200;border-radius:9px;background:#fff}.slide h2{font-size:12px;color:#786100;margin:0 0 16px}.slide p{white-space:pre-wrap;font-size:17px;line-height:1.7}img{max-width:100%}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function OfficePreview({ attachment }: { attachment: Attachment }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/issue-attachments?id=${attachment.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load this attachment.");
        const buffer = await response.arrayBuffer();
        const kind = officeKind(attachment);
        if (kind === "word") {
          const mammoth = await import("mammoth/mammoth.browser");
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (active) setHtml(officeDocument(attachment.fileName, result.value || "<p>This document is empty.</p>"));
        } else if (kind === "excel") {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheets = workbook.SheetNames.slice(0, 5).map((name) => `<section><h2>${escapeHtml(name)}</h2>${XLSX.utils.sheet_to_html(workbook.Sheets[name])}</section>`).join("");
          if (active) setHtml(officeDocument(attachment.fileName, sheets || "<p>This workbook is empty.</p>", true));
        } else if (kind === "powerpoint") {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(buffer);
          const names = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
          const slides = await Promise.all(names.map(async (name, index) => {
            const xml = await zip.files[name].async("string");
            const text = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((match) => new DOMParser().parseFromString(`<!doctype html><body>${match[1]}`, "text/html").body.textContent || "").join("\n");
            return `<article class="slide"><h2>SLIDE ${index + 1}</h2><p>${escapeHtml(text || "No extractable text on this slide.")}</p></article>`;
          }));
          if (active) setHtml(officeDocument(attachment.fileName, slides.join("") || "<p>This presentation is empty.</p>", true));
        }
      } catch {
        if (active) setError("This Office file could not be previewed. You can still download it.");
      }
    })();
    return () => { active = false; };
  }, [attachment]);
  if (error) return <div className="attachment-no-preview"><strong>{error}</strong><span>تعذر إنشاء معاينة لهذا الملف، ويمكنك تنزيله كالمعتاد.</span><a href={`/api/issue-attachments?id=${attachment.id}&download=1`} download>Download file · تنزيل الملف</a></div>;
  if (!html) return <div className="office-preview-loading"><div className="spinner" /><strong>Preparing Office preview...</strong><span>جاري تجهيز معاينة الملف داخل التطبيق</span></div>;
  return <iframe className="office-preview-frame" sandbox="" srcDoc={html} title={`Office preview: ${attachment.fileName}`} />;
}

function AttachmentCards({ attachments, onRemove }: { attachments: Attachment[]; onRemove: (attachment: Attachment) => void }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  if (!attachments.length) return null;
  return <><div className="attachment-table-wrap"><table className="attachment-table"><thead><tr><th>File · الملف</th><th>Type · النوع</th><th>Size · الحجم</th><th>Uploaded · الرفع</th><th>Delete · حذف</th></tr></thead><tbody>{attachments.map((attachment) => { const kind = officeKind(attachment); const extension = attachment.fileName.split(".").pop()?.slice(0, 5).toUpperCase() || "FILE"; const type = attachment.contentType.startsWith("image/") ? "IMAGE" : attachment.contentType === "application/pdf" ? "PDF" : kind === "word" ? "DOCX" : kind === "excel" ? "XLSX" : kind === "powerpoint" ? "PPTX" : extension; return <tr key={attachment.id} tabIndex={0} role="button" aria-label={`Preview ${attachment.fileName}`} onClick={() => setPreview(attachment)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPreview(attachment); } }}><td><div className="attachment-file-cell"><span className={`attachment-file-icon${kind ? ` office-${kind}` : attachment.contentType === "application/pdf" ? " pdf" : ""}`}>{type.slice(0, 4)}</span><div><strong title={attachment.fileName}>{attachment.fileName}</strong><small>{attachment.uploadedBy}</small></div></div></td><td><span className="attachment-type-badge">{type}</span></td><td>{bytesLabel(attachment.sizeBytes)}</td><td>{attachmentDate(attachment.createdAt)}</td><td><div className="attachment-row-actions" onClick={(event) => event.stopPropagation()}><button type="button" className="attachment-delete" onClick={() => onRemove(attachment)} aria-label={`Delete ${attachment.fileName}`}>×</button></div></td></tr>; })}</tbody></table></div>{preview && <div className="attachment-preview-layer" role="dialog" aria-modal="true" aria-label={`Preview ${preview.fileName}`}><button type="button" className="attachment-preview-backdrop" onClick={() => setPreview(null)} aria-label="Close preview" /><section className="attachment-preview-dialog"><header><div><strong>{preview.fileName}</strong><span>{bytesLabel(preview.sizeBytes)}</span></div><div><a href={`/api/issue-attachments?id=${preview.id}&download=1`} download>Download · تنزيل</a><button type="button" onClick={() => setPreview(null)} aria-label="Close preview">×</button></div></header><div className="attachment-preview-content">{preview.contentType.startsWith("image/") ? <img src={`/api/issue-attachments?id=${preview.id}`} alt={preview.fileName} /> : preview.contentType === "application/pdf" ? <iframe src={`/api/issue-attachments?id=${preview.id}`} title={preview.fileName} /> : officeKind(preview) ? <OfficePreview key={preview.id} attachment={preview} /> : <div className="attachment-no-preview"><strong>Preview is not available for this file type.</strong><span>المعاينة غير متاحة لهذا النوع من الملفات.</span><a href={`/api/issue-attachments?id=${preview.id}&download=1`} download>Download file · تنزيل الملف</a></div>}</div></section></div>}</>;
}

async function jsonResponse(response: Response) {
  const responseText = await response.text();
  let data;
  try { data = responseText ? JSON.parse(responseText) : {}; }
  catch { data = {}; }
  if (!response.ok) {
    if (response.status === 413 || /payload too large/i.test(responseText)) {
      throw new Error("Attachment is too large. Select files up to 25 MB each. · حجم المرفق كبير، الحد الأقصى 25 MB لكل ملف.");
    }
    const raw = typeof data.error === "string" ? data.error : "";
    const safe = /failed query|select\s+.+from|update\s+.+set/i.test(raw) ? "The request could not be completed. Please try again." : raw;
    throw new Error(safe || "The request could not be completed.");
  }
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
  lockedProjectCode?: string;
}>(function IssuesModule({ currentUser, users, projects, onTaskCreated, onOpenTask, onToast, lockedProjectCode = "" }, ref) {
  const { confirm, confirmDialog } = useAppConfirm();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<IssueForm>(() => blankIssue(projects, currentUser, lockedProjectCode));
  const [files, setFiles] = useState<File[]>([]);
  const [clientFiles, setClientFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Array<{ source: "internal" | "client"; fileName: string; percent: number }>>([]);
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
  const loadInFlightRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const data = await jsonResponse(await fetch("/api/issues", { cache: "no-store" }));
      setIssues(data.issues || []);
      setCategories(data.categories || []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل مشاكل المشاريع");
    } finally { loadInFlightRef.current = false; if (!silent) setLoading(false); }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !drawerOpen && !saving) void load(true);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [load, drawerOpen, saving]);

  const selected = issues.find((issue) => issue.id === selectedId) || null;
  const filtered = useMemo(() => issues.filter((issue) => {
    const term = search.trim().toLowerCase();
    const text = `${issue.issueNumber} ${issue.description} ${issue.category} ${issue.projectCode} ${issue.raisedByName}`.toLowerCase();
    return (!term || text.includes(term)) && (!lockedProjectCode || issue.projectCode === lockedProjectCode) && (lockedProjectCode || projectFilter === "all" || issue.projectCode === projectFilter) && (statusFilter === "all" || issue.status === statusFilter) && (disciplineFilter === "all" || issue.discipline === disciplineFilter) && (priorityFilter === "all" || issue.priority === priorityFilter);
  }).sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.discipline.localeCompare(b.discipline) || a.sequence - b.sequence || a.id - b.id), [issues, search, lockedProjectCode, projectFilter, statusFilter, disciplineFilter, priorityFilter]);
  const scopedIssues = useMemo(() => lockedProjectCode ? issues.filter((issue) => issue.projectCode === lockedProjectCode) : issues, [issues, lockedProjectCode]);
  const stats = useMemo(() => ({ total: scopedIssues.length, open: scopedIssues.filter((issue) => issue.status === "open").length, reopen: scopedIssues.filter((issue) => issue.status === "re_open").length, closed: scopedIssues.filter((issue) => issue.status === "closed").length, critical: scopedIssues.filter((issue) => issue.priority === "critical" && issue.status !== "closed").length }), [scopedIssues]);
  const filtersActive = Boolean(search.trim()) || (!lockedProjectCode && projectFilter !== "all") || disciplineFilter !== "all" || statusFilter !== "all" || priorityFilter !== "all";
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
    setSelectedId(null); setForm(blankIssue(projects, currentUser, lockedProjectCode)); setFiles([]); setClientFiles([]); setConvertEmployee(""); setAddingCategory(false); setNewCategory(""); setDrawerOpen(true);
  }, [projects, currentUser, lockedProjectCode]);
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
  function chooseFiles(event: ChangeEvent<HTMLInputElement>, currentCount: number, update: (files: File[]) => void) {
    const input = event.currentTarget;
    const selectedFiles = Array.from(input.files || []);
    input.value = "";
    if (currentCount + selectedFiles.length > MAX_ATTACHMENTS_PER_SECTION) {
      setError(`A section can contain up to ${MAX_ATTACHMENTS_PER_SECTION} attachments. · الحد الأقصى ${MAX_ATTACHMENTS_PER_SECTION} مرفقات.`);
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`${oversized.name} is larger than 25 MB. Choose a smaller file. · حجم الملف أكبر من الحد المسموح.`);
      return;
    }
    setError("");
    update(selectedFiles);
  }
  async function uploadFiles(issueId: number, source: "internal" | "client", selectedFiles: File[]) {
    if (!selectedFiles.length) return [];
    const uploaded: Attachment[] = [];
    for (const file of selectedFiles) {
      let uploadId = "";
      try {
        setUploadProgress((current) => [...current.filter((item) => item.source !== source || item.fileName !== file.name), { source, fileName: file.name, percent: 0 }]);
        const started = await jsonResponse(await fetch("/api/issue-attachments?action=start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueId, source, fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }),
        }));
        uploadId = started.uploadId as string;
        const chunkBytes = Number(started.chunkBytes);
        const chunkCount = Number(started.chunkCount);
        for (let index = 0; index < chunkCount; index += 3) {
          const indexes = Array.from({ length: Math.min(3, chunkCount - index) }, (_, offset) => index + offset);
          await Promise.all(indexes.map(async (chunkIndex) => {
            const chunk = file.slice(chunkIndex * chunkBytes, Math.min(file.size, (chunkIndex + 1) * chunkBytes));
            await jsonResponse(await fetch(`/api/issue-attachments?action=chunk&uploadId=${encodeURIComponent(uploadId)}&index=${chunkIndex}`, {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: chunk,
            }));
          }));
          const percent = Math.min(95, Math.round((Math.min(index + indexes.length, chunkCount) / chunkCount) * 95));
          setUploadProgress((current) => current.map((item) => item.source === source && item.fileName === file.name ? { ...item, percent } : item));
        }
        const completed = await jsonResponse(await fetch("/api/issue-attachments?action=complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId }),
        }));
        uploaded.push(...completed.attachments as Attachment[]);
        setUploadProgress((current) => current.map((item) => item.source === source && item.fileName === file.name ? { ...item, percent: 100 } : item));
      } catch (uploadError) {
        if (uploadId) void fetch("/api/issue-attachments?action=abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId }),
        });
        throw uploadError;
      }
    }
    return uploaded;
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
      setFiles([]); setClientFiles([]);
      if (!selectedId) setDrawerOpen(false);
      onToast(selectedId ? "Project issue updated · تم تحديث المشكلة" : "Project issue created · تمت إضافة المشكلة");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المشكلة"); }
    finally { saveInFlightRef.current = false; setSaving(false); window.setTimeout(() => setUploadProgress([]), 500); }
  }
  async function removeIssue() {
    if (!selected) return;
    const approved = await confirm({ title: `Delete ${selected.issueNumber}?`, titleAr: "حذف المشكلة؟", message: "The issue and its attachments will be permanently removed, and the issue sequence will be updated.", messageAr: "سيتم حذف المشكلة ومرفقاتها نهائيًا وإعادة ترتيب تسلسل المشاكل." });
    if (!approved) return;
    setSaving(true);
    try {
      const data = await jsonResponse(await fetch(`/api/issues?id=${selected.id}`, { method: "DELETE" }));
      setIssues(data.issues || []); setDrawerOpen(false); onToast("Project issue deleted · تم حذف المشكلة");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف المشكلة"); }
    finally { setSaving(false); }
  }
  async function removeAttachment(attachment: Attachment) {
    const approved = await confirm({ title: "Delete attachment?", titleAr: "حذف المرفق؟", message: attachment.fileName, messageAr: "سيتم حذف هذا الملف نهائيًا من المشكلة.", confirmLabel: "Delete attachment", confirmLabelAr: "حذف المرفق" });
    if (!approved) return;
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
      <div className="issue-filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issue number, description, or category..." />{!lockedProjectCode && <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects · كل المشاريع</option>{projects.map((project) => <option key={project.id} value={project.code}>{project.code} · {project.name}</option>)}</select>}<select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)}><option value="all">All disciplines · كل التخصصات</option>{disciplines.map((discipline) => <option key={discipline} value={discipline}>{disciplineLabel[discipline]}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses · كل الحالات</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities · كل الأولويات</option>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="clear-filters-button" disabled={!filtersActive} onClick={() => { setSearch(""); if (!lockedProjectCode) setProjectFilter("all"); setDisciplineFilter("all"); setStatusFilter("all"); setPriorityFilter("all"); }} aria-label="Clear all project issue filters" title="Clear filters · مسح الفلاتر"><span className="filter-clear-icon" aria-hidden="true" /></button><span className="count-badge filter-count">{filtered.length} Issues</span></div>
      {loading ? <div className="loading-state"><div className="spinner" /><p>Loading project issues...</p></div> : filtered.length === 0 ? <div className="empty-state"><strong>No project issues found</strong><p>لا توجد مشاكل مطابقة. أضف أول مشكلة أو غيّر الفلاتر.</p></div> : <div className="task-table-wrap"><table className="task-table issue-table"><thead><tr><th>Issue Number</th><th>Description</th><th>Project / Discipline</th><th>Status</th><th>Priority</th><th>Raised By</th><th>Issue Date</th><th>Resolved Date</th><th>Task Link</th></tr></thead><tbody>{filtered.map((issue) => { const raisedBy = users.find((user) => user.email === issue.raisedByEmail); const internalCount = issue.attachments.filter((attachment) => attachment.source !== "client").length; const clientCount = issue.attachments.filter((attachment) => attachment.source === "client").length; return <tr key={issue.id} onClick={() => openIssue(issue)}><td><div className="issue-number-cell"><strong className="issue-number" dir="ltr">{issue.issueNumber}</strong><div className="issue-record-meta">{issue.comments.trim() && <span className="note-indicator" title="Notes available · توجد ملاحظات" aria-label="1 note">▰ <small>1</small></span>}<span className={`attachment-count${internalCount ? "" : " empty"}`} title={`${internalCount} attachments`} aria-label={`${internalCount} attachments`}>📎 <small>{internalCount}</small></span></div></div></td><td><div className="issue-description"><strong>{issue.description}</strong><small>{issue.category || "Uncategorized"} · Raised by {issue.raisedByName}</small></div></td><td><span className="project-code">{issue.projectCode}</span><small className="issue-discipline">{disciplineLabel[normalizedDiscipline(issue.discipline)]}</small></td><td><span className={`issue-pill issue-status-${issue.status}`}>{statusLabel[issue.status]}</span></td><td><span className={`issue-pill issue-priority-${issue.priority}`}>{priorityLabel[issue.priority]}</span></td><td>{raisedBy ? <div className="employee-cell"><span className="avatar small">{initials(raisedBy.displayName)}</span><strong>{raisedBy.displayName}</strong></div> : issue.raisedByName || "—"}</td><td dir="ltr">{dateLabel(issue.issueDate)}</td><td><div className="resolved-date-cell"><strong dir="ltr">{dateLabel(issue.resolvedDate)}</strong><div className="client-response-meta">{issue.clientReply.trim() && <span className="client-reply-indicator" title="Client reply received · تم استلام رد العميل">💬</span>}<span className={`client-attachment-indicator${clientCount ? "" : " empty"}`} title={`${clientCount} client attachments`} aria-label={`${clientCount} client attachments`}>📎 <small>{clientCount}</small></span></div></div></td><td>{issue.convertedTaskId ? <button className="linked-task-button" onClick={(event) => { event.stopPropagation(); onOpenTask(issue.convertedTaskId!); }}><ButtonLabel en={`Modified to task · #${issue.convertedTaskId}`} ar="تحولت إلى مهمة" /></button> : "—"}</td></tr>; })}</tbody></table></div>}
    </section>
    {drawerOpen && <div className="drawer-layer" role="dialog" aria-modal="true"><button className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-label="Close" /><aside className="task-drawer issue-drawer"><div className="drawer-head"><div><p>PROJECT ISSUE</p><h2>{selected ? selected.issueNumber : `New ${form.projectCode || "Project"}-${disciplineCode[form.discipline]}-###`}</h2>{selected?.convertedTaskId && <span className="drawer-private-label">Modified to task · تحولت إلى مهمة #{selected.convertedTaskId}</span>}</div><button className="close-button" onClick={() => setDrawerOpen(false)}>×</button></div><form className="task-form" onSubmit={save}>
      <div className="form-section"><h3>Issue Identification <span>بيانات المشكلة</span></h3>{issueClosed && <div className="closed-issue-note">Closed issue fields are locked. Select Re-Open to edit them again.<small>حقول المشكلة المغلقة مقفلة. اختر إعادة الفتح لتعديلها.</small></div>}<div className="form-grid"><label><span>Project · المشروع</span>{lockedProjectCode ? <input value={`${lockedProjectCode} · ${projects.find((project) => project.code === lockedProjectCode)?.name || ""}`} disabled /> : <select required disabled={issueClosed} value={form.projectCode} onChange={(event) => { const projectCode = event.target.value; const project = projects.find((item) => item.code === projectCode); setConvertEmployee(""); setForm((current) => ({ ...current, projectCode, raisedByEmail: project?.memberEmails.includes(current.raisedByEmail) ? current.raisedByEmail : "" })); }}><option value="" disabled>Select project</option>{projects.map((project) => <option key={project.id} value={project.code}>{project.code} · {project.name}</option>)}</select>}</label><label><span>Discipline · التخصص</span><select required disabled={currentUser.role === "member" || issueClosed} value={form.discipline} onChange={(event) => { const discipline = event.target.value as IssueDiscipline; const currentRaisedBy = users.find((user) => user.email === form.raisedByEmail); setConvertEmployee(""); setForm({ ...form, discipline, raisedByEmail: currentRaisedBy?.discipline === discipline && selectedProject?.memberEmails.includes(currentRaisedBy.email) ? form.raisedByEmail : "" }); }}>{disciplineOptions.map((discipline) => <option key={discipline} value={discipline}>{disciplineLabel[discipline]}</option>)}</select></label></div><label className="wide"><span>Description · الوصف</span><textarea required disabled={issueClosed} rows={4} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the project issue clearly..." /></label><div className="form-grid issue-category-priority-grid"><div className="issue-category-field"><label><span>Category · التصنيف</span><select required disabled={issueClosed} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="" disabled>Select category</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><button type="button" className="add-category-button" disabled={issueClosed} onClick={() => { setAddingCategory((value) => !value); setNewCategory(""); }}><ButtonLabel en="＋ Add Category" ar="إضافة تصنيف" /></button>{addingCategory && <div className="new-category-row"><input maxLength={120} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category name" /><button type="button" disabled={!newCategory.trim()} onClick={() => { const value = newCategory.trim(); if (!value) return; setCategories((current) => Array.from(new Set([...current, value])).sort((a, b) => a.localeCompare(b))); setForm({ ...form, category: value }); setAddingCategory(false); setNewCategory(""); }}><ButtonLabel en="Use Category" ar="استخدام التصنيف" /></button></div>}</div><label><span>Priority · الأولوية</span><select disabled={issueClosed} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Issue["priority"] })}>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></div>
      <div className="form-section issue-details-section"><h3>Responsibility & Dates <span>المسؤولية والتواريخ</span></h3><div className="form-grid"><label><span>Status · الحالة</span><select value={form.status} onChange={(event) => changeStatus(event.target.value as Issue["status"])}>{statusOptions.map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></label><label><span>Raised by · بواسطة</span>{currentUser.role === "member" ? <input value={currentUser.displayName} disabled /> : <select required disabled={issueClosed} value={form.raisedByEmail} onChange={(event) => setForm({ ...form, raisedByEmail: event.target.value })}><option value="" disabled>Select project team member</option>{raisedByOptions.map((user) => <option key={user.email} value={user.email}>{user.displayName} · {disciplineLabel[form.discipline]}</option>)}</select>}</label></div><div className="form-grid issue-date-grid"><label><span>Issue Date · تاريخ المشكلة</span><input type="date" required disabled={issueClosed} value={form.issueDate} onChange={(event) => setForm({ ...form, issueDate: event.target.value })} /></label><label><span>Resolved Date · تاريخ الإغلاق</span><input type="date" disabled={!issueClosed} value={form.resolvedDate} onChange={(event) => setForm({ ...form, resolvedDate: event.target.value })} /><small className="automatic-date-note">Set automatically on closing; adjust it when recording a past closure · يُحدد تلقائيًا ويمكن تصحيحه</small></label></div><label className="wide"><span>Notes · الملاحظات</span><textarea rows={4} maxLength={4000} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} placeholder="Add notes, decisions, or follow-up details..." /></label></div>
      <div className="form-section issue-attachments-section"><div className="comments-heading"><h3>Issue Attachments <span>مرفقات المشكلة</span></h3><span>{internalAttachments.length + files.length}/10</span></div><label className="issue-upload"><strong>＋ Add issue attachments</strong><span>Any file type · multiple files · maximum 25 MB each</span><input type="file" multiple onChange={(event) => chooseFiles(event, internalAttachments.length, setFiles)} /></label>{files.length > 0 && <div className="pending-files">{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name} <small>{bytesLabel(file.size)}</small></span>)}</div>}{uploadProgress.filter((item) => item.source === "internal").map((item) => <div className="attachment-upload-progress issue-upload-progress" key={`internal-${item.fileName}`} role="status"><div><strong>{item.fileName}</strong><span>{item.percent}%</span></div><progress max="100" value={item.percent} /></div>)}<AttachmentCards attachments={internalAttachments} onRemove={(attachment) => void removeAttachment(attachment)} /></div>
      {selected && <div className="form-section client-response-section"><div className="comments-heading"><h3>Client Response <span>رد العميل</span></h3><span>{clientAttachments.length + clientFiles.length}</span></div><label className="wide"><span>Client Reply · رد العميل</span><textarea rows={4} maxLength={4000} value={form.clientReply} onChange={(event) => setForm({ ...form, clientReply: event.target.value })} placeholder="Record the reply, decision, or direction received from the client..." /></label><label className="issue-upload client-upload"><strong>＋ Add client attachments</strong><span>Any file type · multiple files · maximum 25 MB each</span><input type="file" multiple onChange={(event) => chooseFiles(event, clientAttachments.length, setClientFiles)} /></label>{clientFiles.length > 0 && <div className="pending-files">{clientFiles.map((file) => <span key={`${file.name}-${file.size}`}>{file.name} <small>{bytesLabel(file.size)}</small></span>)}</div>}{uploadProgress.filter((item) => item.source === "client").map((item) => <div className="attachment-upload-progress issue-upload-progress" key={`client-${item.fileName}`} role="status"><div><strong>{item.fileName}</strong><span>{item.percent}%</span></div><progress max="100" value={item.percent} /></div>)}<AttachmentCards attachments={clientAttachments} onRemove={(attachment) => void removeAttachment(attachment)} /></div>}
      {selected && (currentUser.role === "owner" || currentUser.role === "manager") && <div className="form-section issue-convert"><h3>Convert to Task <span>تحويل المشكلة إلى مهمة</span></h3>{selected.convertedTaskId ? <button type="button" className="linked-task-panel" onClick={() => onOpenTask(selected.convertedTaskId!)}><ButtonLabel en={`Open linked task #${selected.convertedTaskId}`} ar="فتح المهمة المرتبطة" /></button> : <><p>The task will be linked to {selected.issueNumber} and will appear immediately in Task Management.</p><div className="form-grid"><label><span>Project team member · موظف المشروع</span><select required value={convertEmployee} onChange={(event) => setConvertEmployee(event.target.value)}><option value="">Select employee</option>{projectMembers.map((user) => <option key={user.email} value={user.email}>{user.displayName} · {user.discipline}</option>)}</select></label><label><span>Due Date · تاريخ الإنجاز المتوقع</span><input type="date" value={convertDueDate} onChange={(event) => setConvertDueDate(event.target.value)} /></label></div><label className="wide"><span>Planned Hours · الساعات المخططة</span><input type="number" min="0" step="0.25" value={convertHours} onChange={(event) => setConvertHours(Number(event.target.value))} /></label><button type="button" className="convert-task-button" disabled={!convertEmployee || saving} onClick={() => void convertToTask()}><ButtonLabel en="Convert and open Task Management" ar="تحويل وفتح المهام" /></button></>}</div>}
      <div className="drawer-actions">{selected && (currentUser.role === "owner" || (currentUser.role === "manager" && currentUser.discipline === selected.discipline)) && <button type="button" className="delete-button" disabled={saving} onClick={() => void removeIssue()}><ButtonLabel en="Delete Issue" ar="حذف المشكلة" /></button>}<button type="button" className="secondary-button" onClick={() => setDrawerOpen(false)}><ButtonLabel en="Cancel" ar="إلغاء" /></button><button className="primary-button" disabled={saving}><ButtonLabel en={saving ? "Saving..." : selected ? "Save Changes" : "Create Issue"} ar={saving ? "جاري الحفظ..." : selected ? "حفظ التعديلات" : "إنشاء مشكلة"} /></button></div>
    </form></aside></div>}
    {confirmDialog}
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
