import type { ReactNode } from "react";
import { Menu, type MenuItem, type MenuTriggerProps } from "@/ui";
import { PALETTE, type PaletteKind } from "../logic/fieldTypes";

export interface InsertMenuProps {
  label: string;
  onPick: (kind: PaletteKind) => void;
  trigger: (props: MenuTriggerProps) => ReactNode;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
}

/** The palette as a menu, for the ＋ between fields (keyboard and pointer alike). */
export function InsertMenu({ label, onPick, trigger, placement = "bottom-start" }: InsertMenuProps) {
  const items: MenuItem[] = [
    { kind: "heading", id: "h-fields", label: "Fields" },
    ...PALETTE.filter((item) => item.group === "fields").map<MenuItem>((item) => ({ id: item.kind, label: item.label, hint: item.glyph, onSelect: () => onPick(item.kind) })),
    { kind: "heading", id: "h-layout", label: "Layout" },
    ...PALETTE.filter((item) => item.group === "layout").map<MenuItem>((item) => ({ id: `layout-${item.kind}`, label: item.label, hint: item.glyph, onSelect: () => onPick(item.kind) })),
  ];
  return <Menu label={label} items={items} placement={placement} trigger={trigger} />;
}
