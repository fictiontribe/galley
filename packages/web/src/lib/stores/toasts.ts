import { create } from "zustand";
import { session } from "../session";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  tone: ToastTone;
  /** No full stop: "Published", "Couldn't publish". */
  title: string;
  /** A sentence or two, with full stops. */
  body?: string;
  action?: ToastAction;
  /** Technical detail behind an error, shown on request. */
  detail?: string;
  /** ms; 0 keeps it until dismissed. Defaults: 6 s, or sticky when there's an action or it's an error. */
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push(toast) {
    const id = nextId++;
    // While the session is lost every request fails the same way; the sign-in screen says it once.
    if (session.isLost) return id;
    set({ toasts: [...get().toasts.slice(-3), { ...toast, id }] });
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
}));

/** Show a toast from anywhere. */
export const notify = (toast: Omit<Toast, "id">): number => useToasts.getState().push(toast);
