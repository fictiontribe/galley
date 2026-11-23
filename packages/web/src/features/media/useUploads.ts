import { useCallback, useState } from "react";
import type { MediaItem } from "@galley/core/types";
import { errorShape } from "@/lib/api";
import { apiWithProgress } from "@/lib/upload";
import { invalidate } from "@/lib/query";
import { keys } from "@/lib/sync";

export type UploadState = "reading" | "uploading" | "done" | "error";

export interface UploadTask {
  id: number;
  name: string;
  size: number;
  state: UploadState;
  /** 0–1 while uploading, when the browser can measure it. */
  progress?: number;
  item?: MediaItem;
  error?: string;
  detail?: string;
}

/** A file as a data: URL, the form the upload route takes. */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn’t be read."));
    reader.readAsDataURL(file);
  });
}

/** Upload one file into media. The engine names it safely and refuses anything that isn't media. */
export async function uploadFile(siteId: string, file: File, directory?: string, onProgress: (fraction: number | null) => void = () => undefined): Promise<MediaItem> {
  const data = await readAsDataUrl(file);
  const name = file.name || `pasted-image.${(file.type.split("/")[1] ?? "png").replace("jpeg", "jpg").replace(/\+.*$/, "")}`;
  return apiWithProgress("POST /api/sites/:siteId/media", { params: { siteId }, body: { filename: name, data, ...(directory ? { directory } : {}) } }, onProgress);
}

/** Files from a drop or paste that look like media, skipping folders and text. */
export function mediaFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = entry instanceof File ? entry : entry.kind === "file" ? entry.getAsFile() : null;
    if (file) files.push(file);
  }
  return files;
}

let nextId = 1;

/** Uploads with a visible state per file: reading → uploading → done, or the engine's reason. */
export function useUploads(siteId: string) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);

  const patch = (id: number, update: Partial<UploadTask>) => setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...update } : task)));

  const upload = useCallback(
    async (files: File[], directory?: string): Promise<MediaItem[]> => {
      const created = files.map((file) => ({ id: nextId++, name: file.name || "Pasted image", size: file.size, state: "reading" as UploadState }));
      setTasks((current) => [...current.filter((task) => task.state !== "done"), ...created]);
      const done: MediaItem[] = [];
      await Promise.all(
        files.map(async (file, index) => {
          const task = created[index];
          if (!task) return;
          try {
            patch(task.id, { state: "uploading" });
            const item = await uploadFile(siteId, file, directory, (fraction) => patch(task.id, { progress: fraction ?? undefined }));
            patch(task.id, { state: "done", item, name: item.name });
            done.push(item);
          } catch (error) {
            const shape = errorShape(error);
            patch(task.id, { state: "error", error: shape.message, detail: shape.detail });
          }
        }),
      );
      if (done.length > 0) invalidate(keys.media(siteId));
      return done;
    },
    [siteId],
  );

  const dismiss = useCallback((id: number) => setTasks((current) => current.filter((task) => task.id !== id)), []);
  const clearFinished = useCallback(() => setTasks((current) => current.filter((task) => task.state === "reading" || task.state === "uploading")), []);

  return { tasks, upload, dismiss, clearFinished };
}
