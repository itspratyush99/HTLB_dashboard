"use client";

import { Toaster as Sonner } from "sonner";

/** App-wide toast container. Use `toast.success(...)` / `toast.error(...)` from "sonner". */
export function Toaster() {
  return <Sonner position="top-right" richColors closeButton theme="light" />;
}
