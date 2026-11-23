import { useEffect, useRef, useState, type DragEvent } from "react";
import { bytes } from "@/lib/format";
import { IconButton, ProofMark, Spinner } from "@/ui";
import { mediaFiles, type UploadTask } from "./useUploads";

/** One line per file being added: what's happening, or the engine's reason it wasn't. */
export function UploadList({ tasks, onDismiss }: { tasks: UploadTask[]; onDismiss: (id: number) => void }) {
  if (tasks.length === 0) return null;
  return (
    <ul className="app-uploads" aria-label="Uploads">
      {tasks.map((task) => (
        <li key={task.id} className={`app-upload app-upload--${task.state}`}>
          {task.state === "done" ? <ProofMark kind="reg" className="app-upload__mark" /> : task.state === "error" ? <ProofMark kind="bang" className="app-upload__mark" /> : <Spinner label="Uploading" />}
          <span className="app-upload__name">{task.name}</span>
          <span className="app-upload__state" role={task.state === "error" ? "alert" : "status"}>
            {task.state === "reading"
              ? "Reading…"
              : task.state === "uploading"
                ? task.progress !== undefined
                  ? `Adding ${bytes(task.size)}… ${Math.round(task.progress * 100)}%`
                  : `Adding ${bytes(task.size)}…`
                : task.state === "done"
                  ? "Added"
                  : task.error}
          </span>
          {task.state === "done" || task.state === "error" ? <IconButton icon="close" label={`Dismiss ${task.name}`} onClick={() => onDismiss(task.id)} tooltip={false} /> : null}
          {task.state === "reading" || task.state === "uploading" ? (
            <span className="app-progress app-upload__bar" role="progressbar" aria-label={`Adding ${task.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress !== undefined ? Math.round(task.progress * 100) : undefined}>
              {task.state === "uploading" && task.progress !== undefined ? (
                <span className="app-progress__bar" style={{ inlineSize: `${Math.max(2, Math.round(task.progress * 100))}%` }} />
              ) : (
                <span className="app-progress__bar app-progress__bar--indeterminate" />
              )}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Drop handlers for a region that accepts media files (plus paste anywhere), and whether a drag is over it. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const latest = useRef(onFiles);
  latest.current = onFiles;
  // A drag that leaves the window never fires drop; reset when it ends anywhere.
  // Pasting an image anywhere on the screen adds it (text pastes are left alone).
  useEffect(() => {
    const reset = () => setOver(false);
    const paste = (event: globalThis.ClipboardEvent) => {
      const files = mediaFiles(event.clipboardData?.items);
      if (files.length === 0) return;
      event.preventDefault();
      latest.current(files);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    document.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      document.removeEventListener("paste", paste);
    };
  }, []);
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent) => {
        const files = mediaFiles(event.dataTransfer.files);
        if (files.length === 0) return;
        event.preventDefault();
        setOver(false);
        onFiles(files);
      },
    },
  };
}
