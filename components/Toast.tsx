"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  error: "border-rose-400/30 bg-rose-500/10 text-rose-100",
  info: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
};

const TONE_ICONS: Record<ToastTone, string> = {
  success: "check_circle",
  error: "error",
  info: "info",
};

function ToastItem({ item, onDismiss }: { item: Toast; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    const enter = setTimeout(() => setVisible(true), 10);
    const exit = setTimeout(() => setVisible(false), 3600);
    const remove = setTimeout(() => onDismiss(item.id), 4000);
    return () => {
      clearTimeout(enter);
      clearTimeout(exit);
      clearTimeout(remove);
    };
  }, [item.id, onDismiss]);

  return (
    <div
      className={[
        "flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm transition-all duration-300",
        TONE_CLASSES[item.tone],
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      ].join(" ")}
    >
      <span className="material-symbols-outlined shrink-0 text-[18px]">{TONE_ICONS[item.tone]}</span>
      <span>{item.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(item.id)}
        className="ml-1 shrink-0 opacity-50 transition-opacity hover:opacity-100"
      >
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    counterRef.current += 1;
    const id = `toast-${counterRef.current}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, tone }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-[calc(7rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[9500] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 md:bottom-8"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
