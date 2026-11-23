import { useEffect, useState } from "react";
import type { MediaItem } from "@galley/core/types";
import "@/styles/media.css";
import { Button, Dialog, TabPanel, Tabs } from "@/ui";
import { GeneratePanel } from "./GeneratePanel";
import { MediaLibraryPane } from "./MediaLibraryPane";

export interface MediaPickerProps {
  siteId: string;
  open: boolean;
  onClose: () => void;
  /** Called with the chosen image's site URL, e.g. "/images/team/ana.webp". */
  onPick: (url: string) => void;
}

const TABS = [
  { id: "library", label: "From media" },
  { id: "generate", label: "Generate" },
];

/** Choose an image for a field: from media (search, upload, drop, paste) or generate one. */
export function MediaPicker({ siteId, open, onClose, onPick }: MediaPickerProps) {
  const [tab, setTab] = useState("library");
  const [selected, setSelected] = useState<MediaItem | null>(null);

  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  const use = (item: MediaItem | null) => {
    if (!item) return;
    onPick(item.url);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose an image"
      size="xl"
      className="app-picker"
      footer={
        <>
          {selected && tab === "library" ? (
            <span className="app-dialog__hint g-mono" title={selected.path}>
              {selected.url}
            </span>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Keep editing
          </Button>
          {tab === "library" ? (
            <Button variant="primary" disabled={!selected} onClick={() => use(selected)}>
              Use image
            </Button>
          ) : null}
        </>
      }
    >
      <Tabs label="Where the image comes from" idBase="picker" items={TABS} value={tab} onChange={setTab} />
      <TabPanel idBase="picker" id="library" value={tab}>
        <MediaLibraryPane siteId={siteId} kind="image" selected={selected?.path ?? null} onSelect={setSelected} onActivate={use} onGenerate={() => setTab("generate")} className="app-picker__library" />
      </TabPanel>
      <TabPanel idBase="picker" id="generate" value={tab}>
        {tab === "generate" ? <GeneratePanel siteId={siteId} onSaved={(item) => use(item)} /> : null}
      </TabPanel>
    </Dialog>
  );
}
