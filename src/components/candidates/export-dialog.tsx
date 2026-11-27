"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Filters } from "@/lib/candidates/filters";
import { roleParam, type RoleScope, type ShortlistTag, type Stage } from "@/lib/candidates/types";
import { nextTag } from "./tag-dialog";
import {
  buildBulkSenderCsv,
  bulkSenderFileName,
  type BulkSenderExport,
  type ExportCandidate,
  type TagMode,
} from "@/lib/export/bulk-sender";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Loaded = { candidates: (ExportCandidate & { stage_id: number; tag_id: number | null; tag_name: string | null })[] };
type Done = { fileName: string; result: BulkSenderExport };

/** "Export for Bulk Sender": choose Tags, download the CSV, then see who was skipped. */
export function ExportDialog({
  open,
  onOpenChange,
  role,
  selectedIds,
  filters,
  stages,
  tags = [],
  shortlistedStageId = null,
  canTag = false,
  onTagExported,
  onMoveExported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleScope;
  selectedIds: string[];
  filters: Filters;
  stages: Stage[];
  tags?: ShortlistTag[];
  shortlistedStageId?: number | null;
  canTag?: boolean;
  onTagExported?: (ids: string[], suggested: number | null, heading: string) => void;
  onMoveExported: (ids: string[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagMode, setTagMode] = useState<TagMode>("none");
  const [customText, setCustomText] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  // Fetch the selected candidates' names, mobiles, stage and interviewer when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setLoaded(null);
    setLoadError(null);
    setDone(null);
    let cancelled = false;
    supabase.rpc("candidates_for_export", { p_ids: selectedIds }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else setLoaded({ candidates: (data ?? []) as Loaded["candidates"] });
    });
    return () => {
      cancelled = true;
    };
    // selectedIds is a fresh array each render; the dialog only needs the ids at the moment it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supabase]);

  const preview = useMemo(
    () => (loaded ? buildBulkSenderCsv(loaded.candidates, { mode: tagMode, customText }) : null),
    [loaded, tagMode, customText],
  );
  const fileName = loaded
    ? bulkSenderFileName(
        role === "ALL" ? "All" : role,
        loaded.candidates.map((c) => c.stage_name),
        new Date(),
        loaded.candidates.map((c) => (c.stage_id === shortlistedStageId ? c.tag_name ?? "No tag" : null)),
      )
    : "";
  const invalid = preview?.skipped.filter((s) => s.reason === "invalid phone") ?? [];
  const duplicates = preview?.skipped.filter((s) => s.reason === "duplicate mobile") ?? [];

  async function download() {
    if (!preview || !loaded) return;
    if (tagMode === "custom" && !customText.trim()) return toast.error("Type the custom tag text, or choose another Tags option.");
    setSaving(true);

    // The string already starts with the BOM; Blob writes it as UTF-8 (EF BB BF ...).
    const blob = new Blob([preview.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    // Record the export in the Activity Log (who/when is filled in by the database).
    const stageFilter = (filters.stage_ids ?? []).map((id) => stages.find((s) => s.id === id)?.name).filter(Boolean);
    const { error } = await supabase.from("activity_log").insert({
      action: "export",
      role: roleParam(role),
      details: {
        file_name: fileName,
        exported: preview.includedIds.length,
        selected: loaded.candidates.length,
        skipped_invalid_phone: invalid.length,
        skipped_duplicate_mobile: duplicates.length,
        stage_filter: stageFilter,
        stages_in_file: [...new Set(loaded.candidates.filter((c) => preview.includedIds.includes(c.id)).map((c) => c.stage_name))],
        tags: tagMode === "custom" ? `custom: ${customText.trim()}` : tagMode,
        candidate_ids: preview.includedIds,
      },
    });
    setSaving(false);
    if (error) toast.warning("File downloaded, but the export couldn't be added to the Activity Log", { description: error.message });
    else toast.success(`${fileName} downloaded`);
    setDone({ fileName, result: preview });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Export for Bulk Sender</DialogTitle>
          <DialogDescription>
            {selectedIds.length.toLocaleString("en-IN")} selected {role === "ALL" ? "" : `${role} `}candidate{selectedIds.length === 1 ? "" : "s"}. Format: Name, Mobile
            Number (91 + 10 digits), Source = ORGANIC, Tags, booking_at.
          </DialogDescription>
        </DialogHeader>

        {loadError && <p className="text-sm text-red-700">Couldn&apos;t load the selected candidates: {loadError}</p>}
        {!loaded && !loadError && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Preparing…
          </div>
        )}

        {loaded && preview && !done && (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Tags column</legend>
              {(
                [
                  ["none", "Empty (default)"],
                  ["stage", "Stage name"],
                  ["interviewer", "Interviewer name"],
                  ["custom", "Custom text"],
                ] as [TagMode, string][]
              ).map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="tags" className="accent-[var(--primary)]" checked={tagMode === value} onChange={() => setTagMode(value)} />
                  {label}
                  {value === "custom" && tagMode === "custom" && (
                    <Input autoFocus className="ml-2 h-8 max-w-56" placeholder="e.g. ZBM-FAQ-14Nov" value={customText} onChange={(e) => setCustomText(e.target.value)} />
                  )}
                </label>
              ))}
            </fieldset>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  File: <b className="font-mono text-xs">{fileName}</b>
                </span>
                <span>
                  <b className="text-emerald-700">{preview.includedIds.length}</b> row{preview.includedIds.length === 1 ? "" : "s"}
                </span>
              </div>
              <pre className="mt-2 overflow-x-auto rounded bg-card p-2 font-mono text-[11px] leading-relaxed">
                {preview.csv.replace(/^﻿/, "").split("\n").slice(0, 4).join("\n")}
                {preview.includedIds.length > 3 ? "\n…" : ""}
              </pre>
            </div>

            <SkippedList invalid={invalid} duplicates={duplicates} />

            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="size-4 shrink-0" />
              <p>
                Upload this file to the bulk sender <b>as it is</b>. Don&apos;t open and save it in Excel first: Excel turns mobile numbers into
                things like 9.19963E+11 and the messages will fail.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={download} disabled={saving || preview.includedIds.length === 0}>
                {saving ? <Loader2 className="animate-spin" /> : <Download />}
                Download CSV ({preview.includedIds.length})
              </Button>
            </DialogFooter>
          </>
        )}

        {done && (
          <>
            <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium">{done.fileName} downloaded</p>
                <p className="text-muted-foreground">
                  {done.result.includedIds.length} candidate{done.result.includedIds.length === 1 ? "" : "s"} exported
                  {done.result.skipped.length > 0 && ` · ${done.result.skipped.length} skipped`}.
                </p>
              </div>
            </div>
            <SkippedList
              invalid={done.result.skipped.filter((s) => s.reason === "invalid phone")}
              duplicates={done.result.skipped.filter((s) => s.reason === "duplicate mobile")}
            />
            <p className="text-sm text-muted-foreground">
              Your selection is kept. Once the messages are sent, move the exported candidates on. Candidates who were skipped stay where they are.
            </p>
            <AfterExport
              loaded={loaded!}
              includedIds={done.result.includedIds}
              tags={tags}
              shortlistedStageId={shortlistedStageId}
              canTag={canTag}
              onTagExported={onTagExported}
              onMoveExported={onMoveExported}
              onClose={() => onOpenChange(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SkippedList({ invalid, duplicates }: { invalid: { id: string; name: string; detail: string }[]; duplicates: { id: string; name: string; detail: string }[] }) {
  if (!invalid.length && !duplicates.length) return null;
  return (
    <div className="space-y-2 text-sm">
      {invalid.length > 0 && <Group tone="red" title={`${invalid.length} candidate${invalid.length === 1 ? "" : "s"} skipped – invalid phone`} items={invalid} />}
      {duplicates.length > 0 && <Group tone="amber" title={`${duplicates.length} skipped – duplicate mobile number`} items={duplicates} />}
    </div>
  );
}

function Group({ tone, title, items }: { tone: "red" | "amber"; title: string; items: { id: string; name: string; detail: string }[] }) {
  return (
    <details className={cn("rounded-md border p-2", tone === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50")} open={items.length <= 5}>
      <summary className={cn("cursor-pointer font-medium", tone === "red" ? "text-red-800" : "text-amber-800")}>{title}</summary>
      <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pl-4 text-xs">
        {items.map((s) => (
          <li key={s.id}>
            {s.name} <span className="text-muted-foreground">({s.detail})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Buttons after a download. For one Shortlisted tag group the main button moves exactly the exported
 * candidates to the next tag (No tag → 72h → 48h → 24h → Hold), so nobody is double-moved.
 */
function AfterExport({
  loaded,
  includedIds,
  tags,
  shortlistedStageId,
  canTag,
  onTagExported,
  onMoveExported,
  onClose,
}: {
  loaded: Loaded;
  includedIds: string[];
  tags: ShortlistTag[];
  shortlistedStageId: number | null;
  canTag: boolean;
  onTagExported?: (ids: string[], suggested: number | null, heading: string) => void;
  onMoveExported: (ids: string[]) => void;
  onClose: () => void;
}) {
  const included = new Set(includedIds);
  const shortlisted = loaded.candidates.filter((c) => included.has(c.id) && c.stage_id === shortlistedStageId);
  const tagIds = new Set(shortlisted.map((c) => c.tag_id));
  const single = tagIds.size === 1 ? [...tagIds][0] : undefined;
  const next = single !== undefined ? nextTag(tags, single) : null;
  const currentName = single === null ? "No tag" : tags.find((t) => t.id === single)?.name;
  const ids = shortlisted.map((c) => c.id);

  return (
    <DialogFooter>
      <Button variant="ghost" onClick={onClose}>Done</Button>
      <Button variant={canTag && shortlisted.length ? "outline" : "default"} onClick={() => onMoveExported(includedIds)} disabled={!includedIds.length}>
        <ArrowRightLeft /> Move to stage…
      </Button>
      {canTag && onTagExported && shortlisted.length > 0 && (
        next ? (
          <Button onClick={() => onTagExported(ids, next.id, `Tag the ${ids.length} exported candidates`)}>
            Move these {ids.length} from {currentName} to {next.name}
          </Button>
        ) : single === undefined ? (
          <Button onClick={() => onTagExported(ids, null, `Tag the ${ids.length} exported candidates`)}>Change tag of these {ids.length}…</Button>
        ) : (
          <span className="self-center text-xs text-muted-foreground">{currentName} is the last tag.</span>
        )
      )}
    </DialogFooter>
  );
}
