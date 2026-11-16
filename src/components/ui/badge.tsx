import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small coloured pill. Pass `color` (a hex from the stages/interviewers tables)
 * to get a soft tinted background with readable text, e.g. stage badges.
 */
export function Badge({
  className,
  color,
  style,
  ...props
}: React.ComponentProps<"span"> & { color?: string | null }) {
  const tint = color
    ? { backgroundColor: `${color}1f`, color, borderColor: `${color}55`, ...style }
    : style;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        !color && "bg-secondary text-secondary-foreground",
        className,
      )}
      style={tint}
      {...props}
    />
  );
}
