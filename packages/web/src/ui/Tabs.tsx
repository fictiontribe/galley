import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Count } from "./Tag";

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
  /** Quiet count pill (sunken) instead of the accent. */
  quietCount?: boolean;
}

export interface TabsProps {
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab/panel ids; pair with <TabPanel idBase>. */
  idBase: string;
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

/** Tab list with roving focus; arrow keys move and select, Home/End jump. */
export function Tabs({ label, idBase, items, value, onChange, className }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    list.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${idBase}-tab-${item.id}`)}`)?.focus();
  };

  return (
    <div ref={list} role="tablist" aria-label={label} className={className ? `g-tabs ${className}` : "g-tabs"} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={`${idBase}-tab-${item.id}`}
            type="button"
            role="tab"
            className="g-tab"
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.count !== undefined ? <Count value={item.count} quiet={item.quietCount} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idBase: string;
  id: string;
  /** The selected tab id; the panel renders only when it matches. */
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ idBase, id, value, children, className }: TabPanelProps) {
  if (id !== value) return null;
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
