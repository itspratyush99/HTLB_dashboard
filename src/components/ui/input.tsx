import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-black/10 bg-white/80 px-3 py-1 text-base shadow-[inset_0_1px_1px_rgba(0,0,0,0.03)] transition-colors placeholder:text-muted-foreground focus-visible:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm [@media(pointer:coarse)]:h-10",
        className,
      )}
      {...props}
    />
  );
}
