"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ToastKind = "info" | "success" | "error";
type ToastMsg = { id: string; kind: ToastKind; text: string };

type ToastAPI = {
  info: (text: string) => void;
  success: (text: string) => void;
  error: (text: string) => void;
};

const ToastContext = createContext<ToastAPI | null>(null);

export function useToasts(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used within <ToastProvider />");
  return ctx;
}

export default function ToastProvider({ children }: { children?: React.ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setItems((prev) => [...prev, { id, kind, text }]);
    // auto-dismiss
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const api: ToastAPI = useMemo(() => ({
    info: (t: string) => push("info", t),
    success: (t: string) => push("success", t),
    error: (t: string) => push("error", t),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Floating toasts container */}
      <div className="fixed bottom-4 right-4 z-[9999] flex w-[320px] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              "rounded border px-3 py-2 text-sm shadow transition-opacity " +
              (t.kind === "success" ? "border-green-600 text-green-700 bg-green-50" : t.kind === "error" ? "border-red-600 text-red-700 bg-red-50" : "border-slate-300 text-slate-800 bg-white")
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}


