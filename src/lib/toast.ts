/**
 * Minimal toast pub/sub (Connectivity Layer 1).
 *
 * A dependency-free notification channel so connectivity failures are SEEN
 * instead of failing silently. The QueryClient's mutationCache.onError pushes
 * here; <Toaster> subscribes and renders. Deliberately tiny — not a general
 * design-system toast, just enough to surface "couldn't save".
 */

export type ToastTone = "error" | "info";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function showToast(message: string, tone: ToastTone = "error"): number {
  const id = nextId++;
  // Collapse duplicate consecutive messages (a flurry of failed writes on a
  // dead connection shouldn't stack identical toasts).
  if (toasts.some((t) => t.message === message)) return id;
  toasts = [...toasts, { id, message, tone }];
  emit();
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
