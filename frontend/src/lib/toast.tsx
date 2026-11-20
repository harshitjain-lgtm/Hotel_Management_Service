import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "./api";
import { cn } from "./utils";

export type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function publish() {
  for (const l of listeners) l(items);
}

function push(variant: ToastVariant, title: string, description?: string, ttl = 5000) {
  const id = nextId++;
  items = [...items, { id, title, description, variant }];
  publish();
  setTimeout(() => dismiss(id), ttl);
}

export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  publish();
}

export const toast = {
  success: (title: string, description?: string) => push("success", title, description),
  info: (title: string, description?: string) => push("info", title, description),
  warning: (title: string, description?: string) => push("warning", title, description, 7000),
  error: (title: string, description?: string) => push("error", title, description, 8000),
  fromError: (err: unknown) => {
    const { title, description } = describeError(err);
    push("error", title, description, 8000);
  },
};

const STYLES: Record<ToastVariant, { box: string; icon: JSX.Element }> = {
  success: { box: "border-emerald-200 bg-white", icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" /> },
  info: { box: "border-indigo-200 bg-white", icon: <Info className="h-5 w-5 text-indigo-600" /> },
  warning: { box: "border-amber-300 bg-amber-50", icon: <AlertTriangle className="h-5 w-5 text-amber-600" /> },
  error: { box: "border-red-300 bg-red-50", icon: <ShieldAlert className="h-5 w-5 text-red-600" /> },
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "animate-toast-in pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-lg",
            STYLES[t.variant].box,
          )}
        >
          <div className="mt-0.5 shrink-0">{STYLES[t.variant].icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{t.title}</p>
            {t.description && <p className="mt-0.5 break-words text-sm text-slate-600">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
