import { reactive } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BookInfo } from "../types";

export interface DownloadTask {
  id: string;
  book: BookInfo;
  progress: number;
  status: "queued" | "downloading" | "done" | "error";
  savePath: string;
  errorMsg: string;
  totalBytes: number;
  downloadedBytes: number;
}

const tasks = reactive<DownloadTask[]>([]);
let initialized = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function loadPersisted() {
  try {
    const raw: string = await invoke("load_download_history");
    if (raw) {
      const saved: DownloadTask[] = JSON.parse(raw);
      for (const t of saved) {
        if (t.status === "done" || t.status === "error") {
          tasks.push(t);
        }
      }
    }
  } catch {
    // ignore
  }
}

function persist() {
  // Debounce to avoid excessive writes
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      const toSave = tasks.filter((t) => t.status === "done" || t.status === "error");
      await invoke("save_download_history", { data: JSON.stringify(toSave) });
    } catch {
      // ignore
    }
  }, 500);
}

function init() {
  if (initialized) return;
  initialized = true;

  loadPersisted();

  listen<{
    type: string;
    download_id: string;
    downloaded?: number;
    total?: number;
  }>("download-progress", (event) => {
    const { type, download_id, downloaded, total } = event.payload;
    const task = tasks.find((t) => t.id === download_id);
    if (!task) return;

    if (type === "start") {
      task.status = "downloading";
      task.totalBytes = total || 0;
      task.progress = 0;
    } else if (type === "progress" && downloaded != null && total) {
      task.downloadedBytes = downloaded;
      task.totalBytes = total;
      task.progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
    } else if (type === "finish") {
      task.progress = 100;
      task.status = "done";
    }
  });
}

let idSeq = 0;
function nextId(): string {
  return `dl_${Date.now()}_${++idSeq}`;
}

export async function addDownload(book: BookInfo): Promise<void> {
  const id = nextId();
  const task: DownloadTask = {
    id,
    book,
    progress: 0,
    status: "queued",
    savePath: "",
    errorMsg: "",
    totalBytes: 0,
    downloadedBytes: 0,
  };
  tasks.push(task);

  try {
    task.status = "downloading";
    const result = await invoke<string>("download_book", {
      book,
      downloadId: id,
    });
    task.savePath = result;
    task.status = "done";
    task.progress = 100;
    persist();
  } catch (e: any) {
    task.status = "error";
    task.errorMsg = typeof e === "string" ? e : e?.message || "未知错误";
    persist();
  }
}

export function removeTask(id: string) {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx !== -1) tasks.splice(idx, 1);
}

export function clearDoneTasks() {
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].status === "done" || tasks[i].status === "error") {
      tasks.splice(i, 1);
    }
  }
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + " GB";
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

export { tasks, init as initDownloadStore };

init();
