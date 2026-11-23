import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";
import { Badge, Button, Dialog, ErrorState, Icon, IconButton, Input, Kbd, Skeleton, cx } from "@/ui";

export interface FolderBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the absolute path to open. May throw; the error is shown in the dialog. */
  onOpen: (path: string) => Promise<void>;
  /** "parent": choosing the folder that holds several sites (Add sites from a folder) — the folder being shown is the choice. */
  purpose?: "site" | "parent";
}

interface Row {
  name: string;
  path: string;
  isSite: boolean;
  up?: boolean;
}

/** "/Users/you/Sites" → [["/", "/"], ["Users", "/Users"], …]. Handles Windows drive roots too. */
function segments(path: string): Array<{ label: string; path: string }> {
  const windows = /^[A-Za-z]:[\\/]/.test(path);
  const sep = windows ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  const out: Array<{ label: string; path: string }> = [];
  let acc = "";
  parts.forEach((part, index) => {
    acc = windows ? (index === 0 ? `${part}${sep}` : `${acc.replace(/[\\/]$/, "")}${sep}${part}`) : `${acc}/${part}`;
    out.push({ label: part, path: acc });
  });
  return windows ? out : [{ label: "/", path: "/" }, ...out];
}

/** The server's disk, folder by folder (the browser can't see it). Folders that look like sites are flagged. */
export function FolderBrowserDialog({ open, onClose, onOpen, purpose = "site" }: FolderBrowserDialogProps) {
  const [path, setPath] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(0);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<unknown>(null);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setOpenError(null);
      setActive(0);
    }
  }, [open]);

  const listing = useQuery(keys.fsList(path ?? ""), () => api("GET /api/fs/list", { query: path ? { path } : {} }), { enabled: open });
  const data = listing.data;

  useEffect(() => {
    if (data) setTyped(data.path);
  }, [data]);

  const rows: Row[] = data ? [...(data.parent ? [{ name: "Up one folder", path: data.parent, isSite: false, up: true }] : []), ...data.entries] : [];
  const selected = rows[active];
  const target = purpose === "site" && selected && !selected.up && selected.isSite ? selected : null;
  const openPath = target?.path ?? data?.path;
  const openName = target?.name ?? (data ? (segments(data.path).at(-1)?.label ?? data.path) : "");

  const go = (next: string) => {
    setPath(next);
    setActive(0);
    setOpenError(null);
    list.current?.focus();
  };

  const submit = async (pathToOpen: string | undefined) => {
    if (!pathToOpen) return;
    setOpening(true);
    setOpenError(null);
    try {
      await onOpen(pathToOpen);
    } catch (error) {
      setOpenError(error);
    } finally {
      setOpening(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown") setActive((index) => Math.min(rows.length - 1, index + 1));
    else if (event.key === "ArrowUp") setActive((index) => Math.max(0, index - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(rows.length - 1);
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(openPath);
    else if (event.key === "Enter" || event.key === "ArrowRight") {
      if (selected) go(selected.path);
    } else if ((event.key === "Backspace" || event.key === "ArrowLeft") && data?.parent) go(data.parent);
    else return;
    event.preventDefault();
  };

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={purpose === "parent" ? "Add sites from a folder" : "Open a site"}
      description={
        purpose === "parent"
          ? "Go to the folder that holds the sites you look after. The sites in it are listed before anything is added."
          : "Choose the folder your site lives in. Nothing changes until you publish."
      }
      size="lg"
      dismissible={!opening}
      footer={
        <>
          <span className="app-dialog__hint">
            <Kbd keys={["enter"]} /> opens a folder · <Kbd keys={["mod", "enter"]} /> {purpose === "parent" ? "looks in this one" : "opens the site"}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={opening}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!openPath} busy={opening} busyLabel={purpose === "parent" ? "Looking" : "Opening"} onClick={() => void submit(openPath)}>
            {purpose === "parent" ? (openName ? `Look in “${openName}”` : "Look here") : openName ? `Open “${openName}”` : "Open"}
          </Button>
        </>
      }
    >
      <form
        className="app-folder__path"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim()) go(typed.trim());
        }}
      >
        <Input aria-label="Folder path" mono size="sm" value={typed} onChange={(event) => setTyped(event.target.value)} spellCheck={false} />
        <IconButton icon="arrow-up" className="app-rotate-90" label="Go to this path" type="submit" variant="secondary" />
      </form>

      {data ? (
        <nav className="app-folder__crumbs" aria-label="Folder path">
          {segments(data.path).map((segment, index, all) => (
            <span key={segment.path} className="app-folder__crumb">
              {index > 0 ? <span className="g-crumbs__sep" aria-hidden="true">›</span> : null}
              {index === all.length - 1 ? (
                <span aria-current="location">{segment.label}</span>
              ) : (
                <button type="button" className="app-link-button" onClick={() => go(segment.path)}>
                  {segment.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      <div
        ref={list}
        className="app-folder__list"
        role="listbox"
        aria-label="Folders"
        tabIndex={0}
        aria-activedescendant={selected ? `${listId}-${active}` : undefined}
        aria-busy={listing.loading}
        onKeyDown={onKeyDown}
      >
        {listing.loading ? (
          Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="app-folder__row" aria-hidden="true">
              <Skeleton width={16} height={16} />
              <Skeleton width={120 + ((index * 37) % 90)} height={12} />
            </div>
          ))
        ) : listing.status === "error" && !data ? (
          <ErrorState compact title="Couldn’t read this folder" error={listing.error} onRetry={() => void listing.refetch()} />
        ) : rows.length === 0 ? (
          <p className="app-folder__empty">No folders inside this one.</p>
        ) : (
          rows.map((row, index) => (
            <div
              key={row.path + (row.up ? "-up" : "")}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cx("app-folder__row", row.isSite && "app-folder__row--site")}
              onClick={() => setActive(index)}
              onDoubleClick={() => go(row.path)}
            >
              <Icon name={row.up ? "arrow-up" : row.isSite ? "folder-site" : "folder"} />
              <span className="app-folder__name">{row.name}</span>
              {row.isSite ? (
                <Badge tone="accent" mark="reg">
                  Looks like a site
                </Badge>
              ) : null}
              {!row.up ? <Icon name="chevron-right" className="app-folder__enter" /> : null}
            </div>
          ))
        )}
      </div>
      {openError ? <ErrorState compact title="Couldn’t open this folder" error={openError} /> : null}
    </Dialog>
  );
}
