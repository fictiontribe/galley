import type { BlockType } from "@galley/core/types";
import { PaletteList } from "@/features/builder/PaletteList";
import { Button, Dialog } from "@/ui";
import { useForm } from "../form/context";

export interface SectionPaletteProps {
  open: boolean;
  onClose: () => void;
  blocks: readonly BlockType[];
  /** Where the section will go, in words: "at the end", "after Hero". */
  position: string;
  onPick: (block: BlockType) => void;
}

/** "Add section": the site's section types — the same palette the Arrange panel shows beside the page. */
export function SectionPalette({ open, onClose, blocks, position, onPick }: SectionPaletteProps) {
  const { siteId } = useForm();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a section"
      description={`It goes ${position}. Its layout comes from one already on the site; the words start empty.`}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Keep editing
        </Button>
      }
    >
      {open ? <PaletteList siteId={siteId} blocks={blocks} layout="grid" onPick={onPick} autoFocus /> : null}
    </Dialog>
  );
}
