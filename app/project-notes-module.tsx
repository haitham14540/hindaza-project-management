"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

type NotesProject = { id: number; code: string; name: string; status: string };
type NotesUser = { email: string; role: "owner" | "manager" | "member" };
type NoteSummary = {
  id: number;
  projectCode: string;
  title: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};
type ProjectNote = NoteSummary & { contentHtml: string };
type MindBranch = { title: string; items: string[] };
type TableSelectionMode = "none" | "cell" | "column" | "row";
type TableResizeState = { axis: "column" | "row"; start: number; startSize: number; table: HTMLTableElement; row: HTMLTableRowElement; columnIndex: number };
type TableHandlePosition = { columnLeft: number; columnTop: number; rowLeft: number; rowTop: number };

const tableCellColors = [
  { label: "No fill", value: "transparent" },
  { label: "White", value: "#ffffff" },
  { label: "Light gray", value: "#e7e6e6" },
  { label: "Gray", value: "#b4b4b4" },
  { label: "Black", value: "#171717" },
  { label: "Yellow", value: "#fff2a8" },
  { label: "Gold", value: "#ffd200" },
  { label: "Orange", value: "#f4b183" },
  { label: "Red", value: "#f4cccc" },
  { label: "Dark red", value: "#c00000" },
  { label: "Green", value: "#c6e0b4" },
  { label: "Dark green", value: "#70ad47" },
  { label: "Blue", value: "#bdd7ee" },
  { label: "Dark blue", value: "#4472c4" },
  { label: "Purple", value: "#d9c2e9" },
  { label: "Rose", value: "#f4b6c2" },
];

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to complete the note request.");
  return data;
}

function noteDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

const pastedNoteTags = new Set(["P", "DIV", "BR", "H1", "H2", "H3", "H4", "B", "STRONG", "I", "EM", "U", "S", "UL", "OL", "LI", "BLOCKQUOTE", "SPAN", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "IMG"]);
const pastedNoteStyles = new Set(["color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "line-height", "width", "height", "min-width", "max-width", "margin-left", "margin-right", "display"]);

function safePastedStyle(value: string) {
  return value.split(";").map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return "";
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const styleValue = declaration.slice(separator + 1).trim();
    if (!pastedNoteStyles.has(property) || !styleValue || styleValue.length > 80) return "";
    if (!/^[a-z0-9#(),.%\s"'\-]+$/i.test(styleValue) || /url|expression|javascript/i.test(styleValue)) return "";
    return `${property}:${styleValue}`;
  }).filter(Boolean).join(";");
}

function plainTextNoteHtml(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>").join("");
}

function sanitizePastedNoteHtml(html: string, plainText: string) {
  if (!html || typeof DOMParser === "undefined") return plainTextNoteHtml(plainText);
  const document = new DOMParser().parseFromString(html, "text/html");
  document.body.querySelectorAll("style,script,link,meta,iframe,object,embed,form,input,button,textarea,select").forEach((element) => element.remove());
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (!pastedNoteTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    const style = safePastedStyle(element.getAttribute("style") || "");
    const direction = /^(rtl|ltr)$/i.test(element.getAttribute("dir") || "") ? element.getAttribute("dir")!.toLowerCase() : "";
    const imageSource = element.tagName === "IMG" ? element.getAttribute("src") || "" : "";
    const imageAlt = element.tagName === "IMG" ? (element.getAttribute("alt") || "Project note image").slice(0, 160) : "";
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
    if (element.tagName === "IMG") {
      if (!/^\/api\/project-note-images\?key=[a-z0-9%._~/-]+$/i.test(imageSource)) { element.remove(); continue; }
      element.setAttribute("src", imageSource);
      element.setAttribute("alt", imageAlt);
    }
    if (direction) element.setAttribute("dir", direction);
    if (style) element.setAttribute("style", style);
  }
  return document.body.innerHTML || plainTextNoteHtml(plainText);
}

function mindMapFromHtml(title: string, html: string): MindBranch[] {
  if (typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(html, "text/html");
  const branches: MindBranch[] = [];
  let current: MindBranch | null = null;
  const addBranch = (branchTitle: string) => {
    current = { title: branchTitle.slice(0, 100), items: [] };
    branches.push(current);
  };
  for (const element of Array.from(document.body.querySelectorAll("h1,h2,h3,h4,p,li"))) {
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/^H[1-4]$/.test(element.tagName)) {
      addBranch(text);
    } else {
      if (!current) addBranch("Key Notes");
      if (current && current.items.length < 10 && !current.items.includes(text)) current.items.push(text.slice(0, 180));
    }
    if (branches.length >= 14) break;
  }
  return branches.length ? branches : [{ title: title || "Note", items: ["Add headings and paragraphs to generate the mind map."] }];
}

export default function ProjectNotesModule({
  projects,
  projectCode,
  currentUser,
  onToast,
}: {
  projects: NotesProject[];
  projectCode: string;
  currentUser: NotesUser;
  onSelectProject: (projectCode: string) => void;
  onToast: (message: string) => void;
}) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<ProjectNote | null>(null);
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingNote, setLoadingNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"write" | "mindmap">("write");
  const [pageCount, setPageCount] = useState(1);
  const [tableSelectionMode, setTableSelectionMode] = useState<TableSelectionMode>("none");
  const [tableSelectionCount, setTableSelectionCount] = useState(0);
  const [tableHandlePosition, setTableHandlePosition] = useState<TableHandlePosition | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const [selectedImageWidth, setSelectedImageWidth] = useState<number | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorSelectionRef = useRef<Range | null>(null);
  const tableMenuRef = useRef<HTMLDetailsElement | null>(null);
  const tableResizeRef = useRef<TableResizeState | null>(null);
  const ignoreTableClickRef = useRef(false);
  const tableHandleCellRef = useRef<HTMLTableCellElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const selectedImageRef = useRef<HTMLImageElement | null>(null);
  const editRevisionRef = useRef(0);
  const saveRequestRef = useRef(0);
  const saveNoteRef = useRef<(silent?: boolean) => Promise<boolean>>(async () => false);
  const latestDraftRef = useRef<{ id: number; title: string; contentHtml: string; revision: number; dirty: boolean } | null>(null);
  const noteSessionKey = `hindaza-project-notes:${currentUser.email.toLowerCase()}:${projectCode}`;

  const selectedProject = projects.find((project) => project.code === projectCode);
  const mindBranches = useMemo(() => mindMapFromHtml(title, contentHtml), [title, contentHtml]);
  const canDelete = Boolean(selectedNote && (currentUser.role === "owner" || selectedNote.createdBy.toLowerCase() === currentUser.email.toLowerCase()));

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadingList(true);
      setSelectedId(null);
      setSelectedNote(null);
      setError("");
    });
    void fetch(`/api/project-notes?project=${encodeURIComponent(projectCode)}`, { cache: "no-store" })
      .then(responseJson)
      .then((data) => {
        if (cancelled) return;
        const next = (data.notes || []) as NoteSummary[];
        setNotes(next);
        let restoredId = 0;
        try {
          const saved = JSON.parse(window.sessionStorage.getItem(noteSessionKey) || "{}") as { selectedId?: unknown; mode?: unknown };
          restoredId = typeof saved.selectedId === "number" && next.some((note) => note.id === saved.selectedId) ? saved.selectedId : 0;
          if (saved.mode === "write" || saved.mode === "mindmap") setMode(saved.mode);
        } catch {
          window.sessionStorage.removeItem(noteSessionKey);
        }
        setSelectedId(restoredId || next[0]?.id || null);
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load project notes."); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [projectCode, noteSessionKey]);

  useEffect(() => {
    if (!selectedId) return;
    window.sessionStorage.setItem(noteSessionKey, JSON.stringify({ selectedId, mode }));
  }, [selectedId, mode, noteSessionKey]);

  useEffect(() => {
    if (!selectedId) {
      queueMicrotask(() => {
        setSelectedNote(null);
        setTitle("");
        setContentHtml("");
        if (editorRef.current) editorRef.current.innerHTML = "";
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadingNote(true);
      setError("");
    });
    void fetch(`/api/project-notes?id=${selectedId}`, { cache: "no-store" })
      .then(responseJson)
      .then((data) => {
        if (cancelled) return;
        const note = data.note as ProjectNote;
        setSelectedNote(note);
        setTitle(note.title);
        setContentHtml(note.contentHtml);
        setDirty(false);
        editRevisionRef.current = 0;
        latestDraftRef.current = { id: note.id, title: note.title, contentHtml: note.contentHtml, revision: 0, dirty: false };
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load this note."); })
      .finally(() => { if (!cancelled) setLoadingNote(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    if (mode !== "write" || !selectedNote || !editorRef.current) return;
    const editor = editorRef.current;
    const noteMarker = String(selectedNote.id);
    if (editor.dataset.noteId === noteMarker) return;
    editor.innerHTML = selectedNote.contentHtml;
    editor.dataset.noteId = noteMarker;
    window.requestAnimationFrame(updatePageCount);
  }, [mode, selectedNote]);

  useEffect(() => {
    function closeTableMenuOutside(event: PointerEvent) {
      const menu = tableMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(".notes-table-edge-handle")) return;
      if (target && editorRef.current?.contains(target) && target.closest("table")) return;
      tableHandleCellRef.current = null;
      setTableHandlePosition(null);
    }
    document.addEventListener("pointerdown", closeTableMenuOutside);
    return () => document.removeEventListener("pointerdown", closeTableMenuOutside);
  }, []);

  useEffect(() => {
    if (!dirty || !selectedNote || !title.trim()) return;
    const timer = window.setTimeout(() => { void saveNoteRef.current(true); }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, title, contentHtml, selectedNote]);

  useEffect(() => {
    const flushDraft = () => {
      const draft = latestDraftRef.current;
      if (!draft?.dirty || !draft.title.trim()) return;
      void fetch("/api/project-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, title: draft.title, contentHtml: draft.contentHtml }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", flushDraft);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      flushDraft();
    };
  }, []);

  function updatePageCount() {
    const editor = editorRef.current;
    if (!editor) return;
    const contentBottom = Array.from(editor.children).reduce((bottom, child) => Math.max(bottom, (child as HTMLElement).offsetTop + (child as HTMLElement).offsetHeight), 0);
    setPageCount(Math.max(1, Math.ceil((contentBottom + 110) / 1123)));
  }

  function updateEditorState() {
    const nextContent = editorRef.current?.innerHTML || "";
    const revision = editRevisionRef.current + 1;
    editRevisionRef.current = revision;
    setContentHtml(nextContent);
    setDirty(true);
    if (selectedNote) latestDraftRef.current = { id: selectedNote.id, title, contentHtml: nextContent, revision, dirty: true };
    rememberEditorSelection();
    window.requestAnimationFrame(updatePageCount);
  }

  function rememberEditorSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current.contains(range.commonAncestorContainer)) editorSelectionRef.current = range.cloneRange();
  }

  function restoreEditorSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = editorSelectionRef.current;
    if (!range || !editor.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function pasteIntoEditor(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = sanitizePastedNoteHtml(event.clipboardData.getData("text/html"), event.clipboardData.getData("text/plain"));
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    updateEditorState();
  }

  async function uploadNoteImage(file: File) {
    if (imageUploading) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]).has(file.type)) {
      setError("Choose a JPG, PNG, WEBP, or GIF image.");
      return;
    }
    if (!file.size || file.size > 8 * 1024 * 1024) {
      setError("Images must not exceed 8 MB.");
      return;
    }
    setImageUploading(true);
    setImageUploadProgress(0);
    setError("");
    try {
      const started = await responseJson(await fetch("/api/project-note-images?action=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCode, fileName: file.name, contentType: file.type, sizeBytes: file.size }),
      })) as { uploadId: string; chunkBytes: number; chunkCount: number };
      for (let index = 0; index < started.chunkCount; index += 1) {
        const chunk = file.slice(index * started.chunkBytes, Math.min(file.size, (index + 1) * started.chunkBytes));
        await responseJson(await fetch(`/api/project-note-images?action=chunk&uploadId=${encodeURIComponent(started.uploadId)}&index=${index}`, { method: "POST", body: chunk }));
        setImageUploadProgress(Math.round(((index + 1) / (started.chunkCount + 1)) * 100));
      }
      const completed = await responseJson(await fetch("/api/project-note-images?action=complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: started.uploadId }),
      })) as { url: string };
      restoreEditorSelection();
      document.execCommand("insertHTML", false, `<p><img src="${escapeHtml(completed.url)}" alt="${escapeHtml(file.name)}" style="width:70%;max-width:100%;height:auto"></p><p><br></p>`);
      setImageUploadProgress(100);
      updateEditorState();
      onToast("Image added to note · تمت إضافة الصورة إلى الملاحظة");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload the image.");
    } finally {
      setImageUploading(false);
      window.setTimeout(() => setImageUploadProgress(0), 500);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function resizeSelectedImage(width: number) {
    const image = selectedImageRef.current;
    if (!image || !editorRef.current?.contains(image)) return;
    image.style.width = `${width}%`;
    image.style.maxWidth = "100%";
    image.style.height = "auto";
    setSelectedImageWidth(width);
    updateEditorState();
  }

  function alignSelectedImage(alignment: "left" | "center" | "right") {
    const image = selectedImageRef.current;
    if (!image || !editorRef.current?.contains(image)) return;
    image.style.display = "block";
    image.style.marginLeft = alignment === "left" ? "0" : "auto";
    image.style.marginRight = alignment === "right" ? "0" : "auto";
    updateEditorState();
  }

  function setEditorDirection(direction: "rtl" | "ltr") {
    restoreEditorSelection();
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor?.parentElement;
    const block = element?.closest("p,div,h1,h2,h3,h4,blockquote,li,td,th") as HTMLElement | null;
    if (block && editorRef.current?.contains(block)) {
      block.dir = direction;
      block.style.textAlign = direction === "rtl" ? "right" : "left";
    } else if (editorRef.current) {
      document.execCommand("formatBlock", false, "p");
      const nextAnchor = window.getSelection()?.anchorNode;
      const nextElement = nextAnchor?.nodeType === Node.ELEMENT_NODE ? nextAnchor as Element : nextAnchor?.parentElement;
      const nextBlock = nextElement?.closest("p") as HTMLElement | null;
      if (nextBlock) { nextBlock.dir = direction; nextBlock.style.textAlign = direction === "rtl" ? "right" : "left"; }
    }
    updateEditorState();
  }

  function editorCommand(command: string, value?: string) {
    if (!editorRef.current) return;
    restoreEditorSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    updateEditorState();
  }

  function editorKeyboardShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const command = key === "b" ? "bold" : key === "i" ? "italic" : key === "u" ? "underline" : event.shiftKey && event.code === "Digit7" ? "insertOrderedList" : event.shiftKey && event.code === "Digit8" ? "insertUnorderedList" : "";
    if (!command) return;
    event.preventDefault();
    editorCommand(command);
  }

  function selectedTableCell() {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor?.parentElement;
    const cell = element?.closest("td,th") as HTMLTableCellElement | null;
    return cell && editorRef.current?.contains(cell) ? cell : null;
  }

  function clearTableSelection() {
    editorRef.current?.querySelectorAll<HTMLElement>("[data-table-selected]").forEach((cell) => cell.removeAttribute("data-table-selected"));
    setTableSelectionCount(0);
  }

  function beginTableSelection(nextMode: Exclude<TableSelectionMode, "none">) {
    clearTableSelection();
    setTableSelectionMode(nextMode);
    closeTableMenu();
  }

  function countTableSelection(kind: Exclude<TableSelectionMode, "none">) {
    const editor = editorRef.current;
    if (!editor) return 0;
    const selected = Array.from(editor.querySelectorAll<HTMLTableCellElement>(`[data-table-selected="${kind}"]`));
    if (kind === "cell") return selected.length;
    const tables = Array.from(editor.querySelectorAll("table"));
    const groups = new Set(selected.map((cell) => {
      const table = cell.closest("table") as HTMLTableElement;
      const row = cell.parentElement as HTMLTableRowElement;
      return kind === "row" ? `${tables.indexOf(table)}:${row.rowIndex}` : `${tables.indexOf(table)}:${Array.from(row.cells).indexOf(cell)}`;
    }));
    return groups.size;
  }

  function showTableHandles(cell: HTMLTableCellElement) {
    const row = cell.parentElement as HTMLTableRowElement;
    const table = cell.closest("table") as HTMLTableElement | null;
    if (!table) return;
    const cellRect = cell.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    tableHandleCellRef.current = cell;
    setTableHandlePosition({
      columnLeft: cellRect.left + cellRect.width / 2,
      columnTop: tableRect.top - 9,
      rowLeft: rowRect.left - 9,
      rowTop: rowRect.top + rowRect.height / 2,
    });
  }

  function selectTableGroup(kind: "column" | "row") {
    const cell = tableHandleCellRef.current;
    if (!cell || !editorRef.current?.contains(cell)) return;
    if (tableSelectionMode !== kind) clearTableSelection();
    const row = cell.parentElement as HTMLTableRowElement;
    const table = cell.closest("table") as HTMLTableElement;
    const targets = kind === "row"
      ? Array.from(row.cells)
      : Array.from(table.rows).map((tableRow) => tableRow.cells[Array.from(row.cells).indexOf(cell)]).filter(Boolean);
    const alreadySelected = targets.every((target) => target.getAttribute("data-table-selected") === kind);
    targets.forEach((target) => alreadySelected ? target.removeAttribute("data-table-selected") : target.setAttribute("data-table-selected", kind));
    setTableSelectionMode(kind);
    setTableSelectionCount(countTableSelection(kind));
  }

  function handleTableSelection(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "IMG") {
      const image = target as HTMLImageElement;
      selectedImageRef.current = image;
      setSelectedImageWidth(Math.max(20, Math.min(100, Math.round(image.getBoundingClientRect().width / (editorRef.current?.clientWidth || image.getBoundingClientRect().width) * 100))));
      return;
    }
    selectedImageRef.current = null;
    setSelectedImageWidth(null);
    const cell = target.closest("td,th") as HTMLTableCellElement | null;
    if (cell && editorRef.current?.contains(cell)) showTableHandles(cell);
    else { tableHandleCellRef.current = null; setTableHandlePosition(null); }
    if (tableSelectionMode === "none") return;
    if (ignoreTableClickRef.current) {
      ignoreTableClickRef.current = false;
      return;
    }
    if (!cell || !editorRef.current?.contains(cell)) return;
    event.preventDefault();
    const selected = cell.getAttribute("data-table-selected") === tableSelectionMode;
    if (tableSelectionMode === "cell") {
      if (selected) cell.removeAttribute("data-table-selected"); else cell.setAttribute("data-table-selected", "cell");
      setTableSelectionCount(countTableSelection("cell"));
      return;
    }
    const row = cell.parentElement as HTMLTableRowElement;
    if (tableSelectionMode === "row") {
      const rowSelected = Array.from(row.cells).every((item) => item.getAttribute("data-table-selected") === "row");
      Array.from(row.cells).forEach((item) => rowSelected ? item.removeAttribute("data-table-selected") : item.setAttribute("data-table-selected", "row"));
      setTableSelectionCount(countTableSelection("row"));
      return;
    }
    const table = cell.closest("table") as HTMLTableElement;
    const columnIndex = Array.from(row.cells).indexOf(cell);
    const columnCells = Array.from(table.rows).map((tableRow) => tableRow.cells[columnIndex]).filter(Boolean);
    const columnSelected = columnCells.every((item) => item.getAttribute("data-table-selected") === "column");
    columnCells.forEach((item) => columnSelected ? item.removeAttribute("data-table-selected") : item.setAttribute("data-table-selected", "column"));
    setTableSelectionCount(countTableSelection("column"));
  }

  function tableFormattingTargets() {
    const marked = Array.from(editorRef.current?.querySelectorAll<HTMLTableCellElement>("[data-table-selected]") || []);
    const current = selectedTableCell();
    return marked.length ? marked : current ? [current] : [];
  }

  function formatSelectedTableBackground(color: string) {
    const targets = tableFormattingTargets();
    if (!targets.length) {
      setError("Select cells, columns, or rows first.");
      return;
    }
    targets.forEach((cell) => { cell.style.backgroundColor = color; });
    updateEditorState();
  }

  function tableCellAt(target: EventTarget | null) {
    const element = target instanceof HTMLElement ? target : null;
    const cell = element?.closest("td,th") as HTMLTableCellElement | null;
    return cell && editorRef.current?.contains(cell) ? cell : null;
  }

  function tableResizeAxis(cell: HTMLTableCellElement, clientX: number, clientY: number) {
    const rect = cell.getBoundingClientRect();
    if (Math.abs(rect.right - clientX) <= 7) return "column" as const;
    if (Math.abs(rect.bottom - clientY) <= 7) return "row" as const;
    return null;
  }

  function handleTableResizeHover(event: ReactMouseEvent<HTMLDivElement>) {
    if (tableResizeRef.current) return;
    const cell = tableCellAt(event.target);
    const axis = cell ? tableResizeAxis(cell, event.clientX, event.clientY) : null;
    if (cell && !axis) showTableHandles(cell);
    event.currentTarget.style.cursor = axis === "column" ? "col-resize" : axis === "row" ? "row-resize" : "text";
  }

  function handleTableResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    const cell = tableCellAt(event.target);
    if (!cell) return;
    const axis = tableResizeAxis(cell, event.clientX, event.clientY);
    if (!axis) return;
    event.preventDefault();
    event.stopPropagation();
    const row = cell.parentElement as HTMLTableRowElement;
    const table = cell.closest("table") as HTMLTableElement;
    table.style.tableLayout = "fixed";
    tableResizeRef.current = {
      axis,
      start: axis === "column" ? event.clientX : event.clientY,
      startSize: axis === "column" ? cell.getBoundingClientRect().width : row.getBoundingClientRect().height,
      table,
      row,
      columnIndex: Array.from(row.cells).indexOf(cell),
    };
    event.currentTarget.style.cursor = axis === "column" ? "col-resize" : "row-resize";

    const resize = (moveEvent: PointerEvent) => {
      const active = tableResizeRef.current;
      if (!active) return;
      const pointer = active.axis === "column" ? moveEvent.clientX : moveEvent.clientY;
      const size = Math.max(active.axis === "column" ? 48 : 28, Math.round(active.startSize + pointer - active.start));
      if (active.axis === "column") {
        Array.from(active.table.rows).forEach((currentRow) => {
          const currentCell = currentRow.cells[active.columnIndex];
          if (currentCell) {
            currentCell.style.width = `${size}px`;
            currentCell.style.minWidth = `${size}px`;
          }
        });
      } else {
        active.row.style.height = `${size}px`;
        Array.from(active.row.cells).forEach((currentCell) => { currentCell.style.height = `${size}px`; });
      }
    };
    const finish = () => {
      document.removeEventListener("pointermove", resize);
      tableResizeRef.current = null;
      ignoreTableClickRef.current = true;
      if (editorRef.current) editorRef.current.style.cursor = "text";
      updateEditorState();
    };
    document.addEventListener("pointermove", resize);
    document.addEventListener("pointerup", finish, { once: true });
  }

  function closeTableMenu() {
    if (tableMenuRef.current) tableMenuRef.current.open = false;
  }

  function insertTable() {
    insertTableSize(3, 3);
  }

  function insertTableSize(rows: number, columns: number) {
    if (!editorRef.current) return;
    restoreEditorSelection();
    const cells = Array.from({ length: columns }, () => "<td><br></td>").join("");
    document.execCommand("insertHTML", false, `<table><tbody>${Array.from({ length: rows }, () => `<tr>${cells}</tr>`).join("")}</tbody></table><p><br></p>`);
    closeTableMenu();
    updateEditorState();
  }

  function editSelectedTable(action: "add-row" | "add-column" | "delete-row" | "delete-column" | "delete-table") {
    restoreEditorSelection();
    const cell = selectedTableCell();
    if (!cell) {
      setError("Place the cursor inside a table cell first.");
      return;
    }
    const row = cell.parentElement as HTMLTableRowElement;
    const table = cell.closest("table") as HTMLTableElement;
    const columnIndex = Array.from(row.cells).indexOf(cell);
    if (action === "add-row") {
      const nextRow = table.insertRow(row.rowIndex + 1);
      for (let index = 0; index < row.cells.length; index += 1) nextRow.insertCell().innerHTML = "<br>";
    } else if (action === "add-column") {
      for (const currentRow of Array.from(table.rows)) currentRow.insertCell(Math.min(columnIndex + 1, currentRow.cells.length)).innerHTML = "<br>";
    } else if (action === "delete-row") {
      table.deleteRow(row.rowIndex);
      if (table.rows.length === 0) table.remove();
    } else if (action === "delete-column") {
      for (const currentRow of Array.from(table.rows)) if (columnIndex < currentRow.cells.length) currentRow.deleteCell(columnIndex);
      if (!table.rows[0]?.cells.length) table.remove();
    } else {
      table.remove();
    }
    closeTableMenu();
    updateEditorState();
  }

  async function saveNote(silent = false) {
    if (!selectedNote || !title.trim()) return false;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    const revision = editRevisionRef.current;
    const noteId = selectedNote.id;
    const draftTitle = title.trim();
    const draftContent = editorRef.current?.innerHTML || contentHtml;
    latestDraftRef.current = { id: noteId, title: draftTitle, contentHtml: draftContent, revision, dirty: true };
    setSaving(true);
    setError("");
    try {
      const data = await responseJson(await fetch("/api/project-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: noteId, title: draftTitle, contentHtml: draftContent }),
      }));
      const saved = data.note as ProjectNote;
      setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
      setSelectedNote((current) => current?.id === saved.id ? { ...saved, contentHtml: editRevisionRef.current === revision ? saved.contentHtml : current.contentHtml } : current);
      if (editRevisionRef.current === revision && selectedId === noteId) {
        setContentHtml(saved.contentHtml);
        setDirty(false);
        latestDraftRef.current = { id: noteId, title: saved.title, contentHtml: saved.contentHtml, revision, dirty: false };
      }
      if (!silent) onToast("Project note saved · تم حفظ ملاحظة المشروع");
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the note.");
      return false;
    } finally {
      if (saveRequestRef.current === requestId) setSaving(false);
    }
  }
  saveNoteRef.current = saveNote;

  async function createNote() {
    if (creating) return;
    if (dirty) await saveNote(true);
    setCreating(true);
    setError("");
    try {
      const data = await responseJson(await fetch("/api/project-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectCode, title: "Untitled Section", contentHtml: "<h2>New Section</h2><p>Start writing here...</p>" }),
      }));
      const note = data.note as ProjectNote;
      setNotes((current) => [note, ...current]);
      setSelectedId(note.id);
      setMode("write");
      onToast("New section created · تم إنشاء قسم جديد");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create the note.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteNote() {
    if (!selectedNote || !canDelete || deleting || !window.confirm(`Delete “${selectedNote.title}”?`)) return;
    setDeleting(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/project-notes?id=${selectedNote.id}`, { method: "DELETE" }));
      const next = notes.filter((note) => note.id !== selectedNote.id);
      setNotes(next);
      setSelectedId(next[0]?.id || null);
      onToast("Project note deleted · تم حذف ملاحظة المشروع");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the note.");
    } finally {
      setDeleting(false);
    }
  }

  async function selectNote(id: number) {
    if (id === selectedId) return;
    if (dirty) await saveNote(true);
    setSelectedId(id);
    setMode("write");
  }

  function printMindMap() {
    if (!selectedNote) return;
    const popup = window.open("", "_blank", "width=1200,height=850");
    if (!popup) {
      setError("Allow pop-ups to export the mind map as PDF.");
      return;
    }
    popup.opener = null;
    const branches = mindBranches.map((branch) => `<section><h2>${escapeHtml(branch.title)}</h2>${branch.items.length ? `<ul>${branch.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}</section>`).join("");
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} Mind Map</title><style>*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;padding:28px;font-family:Arial,Tahoma,sans-serif;color:#171717}.head{display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid #ffd200;padding-bottom:14px}.head img{width:170px;max-height:60px;object-fit:contain}.head div{text-align:right}.head h1{margin:0;font-size:23px}.head p{margin:5px 0 0;color:#68737a;font-size:11px}.map{display:grid;grid-template-columns:240px 1fr;gap:42px;align-items:center;margin-top:36px}.root{position:relative;border:3px solid #171717;border-radius:16px;background:#ffd200;padding:22px;text-align:center;font-size:20px;font-weight:900}.root:after{content:"";position:absolute;top:50%;right:-43px;width:40px;border-top:3px solid #171717}.branches{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:18px}.branches section{position:relative;min-height:95px;border:1px solid #cfd6d8;border-left:5px solid #ffd200;border-radius:12px;padding:14px;background:#f8f9f7}.branches section:before{content:"";position:absolute;left:-25px;top:28px;width:20px;border-top:2px solid #8f999e}.branches h2{margin:0 0 8px;font-size:15px}.branches ul{margin:0;padding-left:18px;color:#39474e;font-size:11px;line-height:1.55}.footer{margin-top:28px;color:#7c878d;font-size:9px}@media print{@page{size:A4 landscape;margin:12mm}body{padding:0}.branches{gap:10px}.branches section{break-inside:avoid}}</style></head><body><header class="head"><img src="/report-logo.png" alt="HINDAZA"><div><h1>Project Notes Mind Map</h1><p>${escapeHtml(selectedProject?.name || projectCode)} · ${escapeHtml(projectCode)} · ${escapeHtml(noteDate(selectedNote.createdAt))}</p></div></header><main class="map"><div class="root">${escapeHtml(title)}</div><div class="branches">${branches}</div></main><div class="footer">Generated from HINDAZA Project Management</div><script>window.onload=()=>window.print();</script></body></html>`);
    popup.document.close();
  }

  function printNote() {
    if (!selectedNote) return;
    const popup = window.open("", "_blank", "width=900,height=900");
    if (!popup) {
      setError("Allow pop-ups to print this note as PDF.");
      return;
    }
    popup.opener = null;
    const printableContent = sanitizePastedNoteHtml(editorRef.current?.innerHTML || contentHtml, "");
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} - HINDAZA</title><style>@page{size:A4 portrait;margin:16mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;font-family:Arial,Tahoma,sans-serif;color:#20282c;background:#fff}.print-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:13px;border-bottom:4px solid #ffd200}.print-head img{width:150px;max-height:56px;object-fit:contain;object-position:left top}.print-meta{text-align:right}.print-meta p{margin:0 0 5px;color:#8b6c00;font-size:8pt;font-weight:800;letter-spacing:.1em}.print-meta h1{max-width:430px;margin:0;font-size:18pt;line-height:1.25}.print-meta span{display:block;margin-top:6px;color:#68767c;font-size:8pt}.note-content{padding-top:20px;font-size:10.5pt;line-height:1.6;overflow-wrap:anywhere}.note-content h1,.note-content h2,.note-content h3,.note-content h4{break-after:avoid;color:#171717}.note-content h1{font-size:22pt}.note-content h2{font-size:17pt}.note-content h3{font-size:14pt}.note-content blockquote{margin:12px 0;padding:9px 13px;border-left:4px solid #ffd200;background:#fffbed}.note-content table{width:100%;margin:13px 0;border-collapse:collapse;table-layout:fixed}.note-content th,.note-content td{min-height:24px;padding:7px;border:1px solid #aeb7ba;text-align:left;vertical-align:top;overflow-wrap:anywhere}.note-content th{background:#f1f2ef;font-weight:800}.note-content tr{break-inside:avoid}.print-footer{margin-top:24px;padding-top:8px;border-top:1px solid #dfe3e4;color:#7c878d;font-size:7.5pt}@media print{body{min-height:auto}.print-head{break-after:avoid}.note-content{padding-top:16px}}</style></head><body><header class="print-head"><img src="/report-logo.png" alt="HINDAZA"><div class="print-meta"><p>PROJECT NOTE</p><h1>${escapeHtml(title)}</h1><span>${escapeHtml(selectedProject?.name || projectCode)} · ${escapeHtml(projectCode)}<br>Created ${escapeHtml(noteDate(selectedNote.createdAt))} · Updated ${escapeHtml(noteDate(selectedNote.updatedAt))}</span></div></header><main class="note-content">${printableContent}</main><footer class="print-footer">Generated from HINDAZA Project Management</footer><script>window.onload=()=>window.print()</script></body></html>`);
    popup.document.close();
  }

  return <section className="project-notes-app" aria-label="Project Notes" dir="ltr">
    <aside className="notes-pages-column">
      <header><div><strong><span className="notes-notebook-name">{selectedProject?.name || projectCode} Notebook</span><span className="notes-notebook-code">({projectCode})</span></strong><small>Sections · {notes.length} {notes.length === 1 ? "section" : "sections"}</small></div><button type="button" className="notes-add-page" onClick={() => void createNote()} disabled={creating} aria-label="Add section" title="Add section">{creating ? "…" : "+"}</button></header>
      <div className="notes-page-list">{loadingList ? <div className="notes-column-state">Loading sections...</div> : notes.length === 0 ? <div className="notes-column-state"><strong>No sections yet</strong><span>Use + to create the first section.</span></div> : notes.map((note) => <button type="button" key={note.id} className={note.id === selectedId ? "active" : ""} onClick={() => void selectNote(note.id)}><span className="notes-page-sheet" /><span><strong>{note.title}</strong><small>Created {noteDate(note.createdAt)}</small></span></button>)}</div>
    </aside>

    <main className="notes-workspace">
      {error && <div className="notes-error"><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}
      {!selectedId ? <div className="notes-empty-workspace"><span>N</span><h2>Select or create a section</h2><p>Project sections will appear here as a focused writing workspace.</p><button type="button" onClick={() => void createNote()} disabled={creating}>+ New Section</button></div> : loadingNote || !selectedNote ? <div className="notes-loading"><span /><p>Opening section...</p></div> : <>
        <header className="notes-document-head">
          <div className="notes-title-block"><input value={title} maxLength={180} onChange={(event) => { const nextTitle = event.target.value; const revision = editRevisionRef.current + 1; editRevisionRef.current = revision; setTitle(nextTitle); setDirty(true); latestDraftRef.current = { id: selectedNote.id, title: nextTitle, contentHtml: editorRef.current?.innerHTML || contentHtml, revision, dirty: true }; }} aria-label="Note title" /><small>Created {noteDate(selectedNote.createdAt)} · Updated {noteDate(selectedNote.updatedAt)}</small></div>
          <div className="notes-head-actions"><div className="notes-mode-switch" role="tablist"><button type="button" className={mode === "write" ? "active" : ""} onClick={() => setMode("write")}>Write</button><button type="button" className={mode === "mindmap" ? "active" : ""} onClick={() => { setContentHtml(editorRef.current?.innerHTML || contentHtml); setMode("mindmap"); }}>Mind Map</button></div>{mode === "mindmap" && <button type="button" className="notes-pdf-button" onClick={printMindMap} title="Export mind map as PDF">PDF</button>}<button type="button" className="notes-print-button" onClick={printNote} title="Print note as PDF" aria-label="Print note as PDF"><svg className="notes-print-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 13h10v8H7z" /><path d="M17.5 11h.01" /></svg></button><span className="notes-autosave-status" role="status">{saving ? "Saving…" : dirty ? "Auto-save pending" : "Saved automatically"}</span>{canDelete && <button type="button" className="notes-delete-button" onClick={() => void deleteNote()} disabled={deleting} title="Delete page" aria-label="Delete note page"><span className="notes-trash-icon" aria-hidden="true" /></button>}</div>
        </header>

        {mode === "write" ? <div className="notes-editor-shell">
          <div className="notes-editor-toolbar" role="toolbar" aria-label="Text formatting" onMouseDown={rememberEditorSelection}>
            <select defaultValue="p" onChange={(event) => editorCommand("formatBlock", event.target.value)} aria-label="Text style"><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select>
            <select defaultValue="Arial" onChange={(event) => editorCommand("fontName", event.target.value)} aria-label="Font family"><option>Arial</option><option>Tahoma</option><option>Georgia</option><option>Times New Roman</option><option>Courier New</option></select>
            <select defaultValue="3" onChange={(event) => editorCommand("fontSize", event.target.value)} aria-label="Font size"><option value="2">12</option><option value="3">14</option><option value="4">18</option><option value="5">24</option><option value="6">32</option></select>
            <span className="notes-tool-separator" />
            <button type="button" onClick={() => editorCommand("bold")} title="Bold"><b>B</b></button><button type="button" onClick={() => editorCommand("italic")} title="Italic"><i>I</i></button><button type="button" onClick={() => editorCommand("underline")} title="Underline"><u>U</u></button><button type="button" onClick={() => editorCommand("strikeThrough")} title="Strikethrough"><s>S</s></button>
            <label className="notes-color-tool" title="Text color"><span>A</span><input type="color" defaultValue="#171717" onChange={(event) => editorCommand("foreColor", event.target.value)} /></label><label className="notes-color-tool highlight" title="Highlight color"><span>H</span><input type="color" defaultValue="#fff19c" onChange={(event) => editorCommand("hiliteColor", event.target.value)} /></label>
            <span className="notes-tool-separator" />
            <button type="button" onClick={() => editorCommand("justifyLeft")} title="Align left">≡</button><button type="button" onClick={() => editorCommand("justifyCenter")} title="Align center">≣</button><button type="button" onClick={() => editorCommand("justifyRight")} title="Align right">≡</button><button type="button" className="notes-direction-tool" onClick={() => setEditorDirection("ltr")} title="Left-to-right text" aria-label="Left-to-right text">LTR</button><button type="button" className="notes-direction-tool" onClick={() => setEditorDirection("rtl")} title="Right-to-left Arabic text" aria-label="Right-to-left Arabic text">RTL</button><button type="button" className="notes-list-tool" onClick={() => editorCommand("insertUnorderedList")} title="Bulleted list (Ctrl+Shift+8)" aria-label="Bulleted list">• ≡</button><button type="button" className="notes-list-tool" onClick={() => editorCommand("insertOrderedList")} title="Numbered list (Ctrl+Shift+7)" aria-label="Numbered list">1. ≡</button>
            <span className="notes-tool-separator" />
            <button type="button" onClick={() => editorCommand("undo")} title="Undo">↶</button><button type="button" onClick={() => editorCommand("redo")} title="Redo">↷</button><button type="button" onClick={() => editorCommand("removeFormat")} title="Clear formatting">Tx</button>
            <span className="notes-tool-separator" />
            <button type="button" className="notes-image-tool" onClick={() => imageInputRef.current?.click()} disabled={imageUploading} title="Insert image">▧ Image</button><input ref={imageInputRef} className="notes-image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadNoteImage(file); }} />
            <details ref={tableMenuRef} className="notes-table-menu"><summary className="notes-table-tool" title="Table options">▦ Table <span>⌄</span></summary><div className="notes-table-popover"><strong>Insert table</strong><div className="notes-table-size-grid"><button type="button" onClick={() => insertTableSize(2, 2)}>2 × 2</button><button type="button" onClick={insertTable} title="Insert 3 × 3 table">3 × 3</button><button type="button" onClick={() => insertTableSize(4, 4)}>4 × 4</button></div><strong>Select cells</strong><div className="notes-table-selection-options"><button type="button" onClick={() => beginTableSelection("cell")}>Select individual cells</button></div><strong>Cell fill</strong><div className="notes-table-color-palette">{tableCellColors.map((color) => <button type="button" key={color.value} style={{ backgroundColor: color.value }} className={color.value === "transparent" ? "no-fill" : ""} onClick={() => formatSelectedTableBackground(color.value)} title={color.label} aria-label={color.label} />)}</div><small className="notes-table-resize-help">Click a cell to reveal Word-style column and row selectors. Drag its right or bottom edge to resize.</small><strong>Edit table structure</strong><button type="button" onClick={() => editSelectedTable("add-row")}>Add row below</button><button type="button" onClick={() => editSelectedTable("add-column")}>Add column right</button><button type="button" onClick={() => editSelectedTable("delete-row")}>Delete row</button><button type="button" onClick={() => editSelectedTable("delete-column")}>Delete column</button><button type="button" className="notes-table-delete-tool" onClick={() => editSelectedTable("delete-table")}>Delete table</button></div></details>{tableSelectionMode !== "none" && <span className={`notes-table-selection-status ${tableSelectionMode}`}>{tableSelectionCount ? `${tableSelectionCount} ${tableSelectionMode}${tableSelectionCount === 1 ? "" : "s"} selected` : `Select ${tableSelectionMode === "column" ? "columns from the top handle" : tableSelectionMode === "row" ? "rows from the left handle" : "cells"}`}<button type="button" onClick={() => { clearTableSelection(); setTableSelectionMode("none"); }}>Done</button></span>}
            {imageUploading && <span className="notes-image-upload-progress">Uploading image {imageUploadProgress}%<i style={{ width: `${imageUploadProgress}%` }} /></span>}
            {selectedImageWidth !== null && <div className="notes-image-controls"><label className="notes-image-size">Image size <input type="range" min="20" max="100" step="5" value={selectedImageWidth} onChange={(event) => resizeSelectedImage(Number(event.target.value))} /><b>{selectedImageWidth}%</b></label><div className="notes-image-align" role="group" aria-label="Image alignment"><button type="button" onClick={() => alignSelectedImage("left")} title="Align image left">⇤</button><button type="button" onClick={() => alignSelectedImage("center")} title="Center image">↔</button><button type="button" onClick={() => alignSelectedImage("right")} title="Align image right">⇥</button></div></div>}
          </div>
          {tableHandlePosition && <><button type="button" className="notes-table-edge-handle column" style={{ left: tableHandlePosition.columnLeft, top: tableHandlePosition.columnTop }} onMouseDown={(event) => event.preventDefault()} onClick={() => selectTableGroup("column")} title="Select this column" aria-label="Select this table column">▼</button><button type="button" className="notes-table-edge-handle row" style={{ left: tableHandlePosition.rowLeft, top: tableHandlePosition.rowTop }} onMouseDown={(event) => event.preventDefault()} onClick={() => selectTableGroup("row")} title="Select this row" aria-label="Select this table row">▶</button></>}
          <div ref={editorRef} className={`notes-rich-editor table-selecting-${tableSelectionMode}`} style={{ minHeight: `${pageCount * 1123}px` }} contentEditable suppressContentEditableWarning onInput={updateEditorState} onPaste={pasteIntoEditor} onClick={handleTableSelection} onPointerDown={handleTableResizeStart} onMouseMove={handleTableResizeHover} onMouseLeave={(event) => { if (!tableResizeRef.current) event.currentTarget.style.cursor = "text"; }} onMouseUp={rememberEditorSelection} onKeyUp={rememberEditorSelection} onKeyDown={editorKeyboardShortcut} role="textbox" aria-multiline="true" aria-label="Project note content" />
        </div> : <div className="notes-mindmap-shell">
          <div className="notes-mindmap-live">Live from the current note · headings become branches</div><div className="notes-mindmap-canvas"><div className="notes-mindmap-root"><span>PROJECT NOTE</span><strong>{title}</strong><small>{selectedProject?.name || projectCode}</small></div><div className="notes-mindmap-branches">{mindBranches.map((branch, index) => <article key={`${branch.title}-${index}`}><strong>{branch.title}</strong>{branch.items.length > 0 && <ul>{branch.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul>}</article>)}</div></div>
        </div>}
      </>}
    </main>
  </section>;
}
