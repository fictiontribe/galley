import { useState } from "react";
import type { MediaItem } from "@galley/core/types";
import "@/styles/media.css";
import { MediaLibraryPane } from "@/features/media/MediaLibraryPane";
import { Button, Dialog } from "@/ui";

export interface FilePickerProps {
  siteId: string;
  open: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
}

/** Choose any file from media (a guide, a price list) for "Offer a download". */
export function FilePicker({ siteId, open, onClose, onPick }: FilePickerProps) {
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const use = (item: MediaItem | null) => {
    if (!item) return;
    onPick(item.url);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose a file to offer"
      size="xl"
      className="app-picker"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep editing
          </Button>
          <Button variant="primary" disabled={!selected} onClick={() => use(selected)}>
            Use this file
          </Button>
        </>
      }
    >
      {open ? <MediaLibraryPane siteId={siteId} kind="all" selected={selected?.path ?? null} onSelect={setSelected} onActivate={use} className="app-picker__library" /> : null}
    </Dialog>
  );
}
