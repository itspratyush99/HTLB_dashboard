"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Tag } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { ShortlistTag } from "@/lib/candidates/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Info = { id: string; stage_id: number; tag_id: number | null; tag_name: string | null };

/**
 * Change the Shortlisted tag (No tag / 72h / 48h / 24h / Hold) of many candidates at once.
 * `suggested` pre-selects a tag (e.g. the next one after an export). Candidates outside Shortlisted are skipped.
 */
export function TagDialog({
  open,
  onOpenChange,
  ids,
  tags,
  shortlistedStageId,
  suggested,
  heading = "Change tag",
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  tags: ShortlistTag[];
  shortlistedStageId: number | null;
  suggested?: number | "none" | null;
  heading?: string;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [info, setInfo] = useState<Info[] | null>(null);
  const [choice, setChoice] = useState<number | "none" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setChoice(suggested ?? null);
    let cancelled = false;
    supabase.rpc("candidates_for_export", { p_ids: ids }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast.error(error.message);
      setInfo((data ?? []) as Info[]);
    });
    return () => {
      cancelled = true;
    };
    // The ids are read when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supabase]);

  const inShortlisted = info?.filter((c) => c.stage_id === shortlistedStageId) ?? [];
  const outside = (info?.length ?? 0) - inShortlisted.length;
  const now = new Map<string, number>();
  inShortlisted.forEach((c) => now.set(c.tag_name ?? "No tag", (now.get(c.tag_name ?? "No tag") ?? 0) + 1));
  const chosenName = choice === "none" ? "No tag" : tags.find((t) => t.id === choice)?.name;

  async function save() {
    if (choice === null) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("set_shortlist_tag", { p_ids: inShortlisted.map((c) => c.id), p_tag_id: choice === "none" ? null : choice });
    setSaving(false);
    if (error) return toast.error("Couldn't change the tag", { description: error.message });
    const changed = (data as { changed: number }).changed;
    toast.success(changed ? `${changed} candidate${changed === 1 ? "" : "s"} now tagged ${chosenName}` : `Nothing to change: already ${chosenName}`);
    onChanged();
    onOpenChange(false);
  }

  const options: { value: number | "none"; name: string; color?: string }[] = [{ value: "none", name: "No tag" }, ...tags.map((t) => ({ value: t.id, name: t.name, color: t.color }))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="size-5" /> {heading}</DialogTitle>
          <DialogDescription>
            {info ? (
              <>
                {inShortlisted.length} in Shortlisted · now: {[...now.entries()].map(([t, n]) => `${t} ${n}`).join(", ") || "—"}
                {outside > 0 && <> · {outside} not in Shortlisted (skipped, tags only exist there)</>}
              </>
            ) : (
              "Loading…"
            )}
          </DialogDescription>
        </DialogHeader>
        {!info ? (
          <Loader2 className="mx-auto my-4 size-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {options.map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => setChoice(o.value)}
                  className={cn("rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-colors", choice === o.value ? "text-white" : "bg-white/70 hover:bg-white")}
                  style={
                    choice === o.value
                      ? { backgroundColor: o.color ?? "#1d1d1f", borderColor: o.color ?? "#1d1d1f" }
                      : { borderColor: `${o.color ?? "#1d1d1f"}55`, color: o.color ?? "#1d1d1f" }
                  }
                >
                  {o.name}
                </button>
              ))}
            </div>
            {choice !== null && inShortlisted.length > 0 && (
              <p className="rounded-xl border border-black/[0.06] bg-white/70 p-3 text-sm">
                Tag <b>{inShortlisted.length}</b> candidate{inShortlisted.length === 1 ? "" : "s"} as{" "}
                {choice === "none" ? <b>No tag</b> : <Badge color={tags.find((t) => t.id === choice)?.color}>{chosenName}</Badge>}?
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={save} disabled={choice === null || saving || !inShortlisted.length}>
                {saving && <Loader2 className="animate-spin" />} Save tag
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The tag after `current` in the cycle (No tag → first tag → … → last). null = there is no next tag. */
export function nextTag(tags: ShortlistTag[], current: number | null): ShortlistTag | null {
  const sorted = [...tags].sort((a, b) => a.position - b.position);
  if (current === null) return sorted[0] ?? null;
  const i = sorted.findIndex((t) => t.id === current);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
}
