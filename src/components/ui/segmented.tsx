"use client";

import { cn } from "@/lib/utils";

/** A small row of toggle buttons for picking one option (e.g. Skip | Add as new). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: string; tone?: "default" | "positive" | "warning" }[];
  onChange: (value: T) => void;
  size?: "sm" | "xs";
}) {
  return (
    <div className="inline-flex rounded-full bg-black/[0.05] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full px-2.5 font-medium transition-colors",
              size === "sm" ? "py-1 text-xs" : "py-0.5 text-[11px]",
              active
                ? o.tone === "positive"
                  ? "bg-primary text-white"
                  : o.tone === "warning"
                    ? "bg-amber-500 text-white"
                    : "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
