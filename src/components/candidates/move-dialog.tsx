"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Interviewer, Stage } from "@/lib/candidates/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface SelectedInfo {
  id: string;
  stage_id: number;
  stage_name: string;
  interviewer_name: string | null;
}

export interface MoveResult {
  bulk_action_id: string;
  changed: number;
  unchanged: number;
}

const plural = (n: number, word = "candidate") => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;

/** Fetches the current stage/interviewer of the given candidates (for the confirmation text). */
function useSelectedInfo(open: boolean, ids: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const [info, setInfo] = useState<SelectedInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setError(null);
    let cancelled = false;
    supabase.rpc("candidates_for_export", { p_ids: ids }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message);
      else setInfo((data ?? []) as SelectedInfo[]);
    });
    return () => {
      cancelled = true;
    };
    // The ids are read when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supabase]);
  return { info, error, supabase };
}

/** "FAQ Invited" or "3 stages (FAQ Invited 20, Shortlisted 10, LOI Sent 5)". */
function fromStagesText(info: SelectedInfo[]): string {
  const counts = new Map<string, number>();
  info.forEach((c) => counts.set(c.stage_name, (counts.get(c.stage_name) ?? 0) + 1));
  if (counts.size === 1) return [...counts.keys()][0];
  return `${counts.size} stages (${[...counts.entries()].map(([s, n]) => `${s} ${n}`).join(", ")})`;
}

/**
 * "Move to Stage": pick any stage (and an interviewer when the stage asks for one, e.g. 1:1 Aligned),
 * confirm "Move 35 candidates from FAQ Invited to 1:1 Aligned?", then move them in one go.
 */
export function MoveDialog({
  open,
  onOpenChange,
  ids,
  stages,
  interviewers,
  heading = "Move to stage",
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  stages: Stage[];
  interviewers: Interviewer[];
  heading?: string;
  onMoved: (result: MoveResult) => void;
}) {
  const { info, error, supabase } = useSelectedInfo(open, ids);
  const [stageId, setStageId] = useState<number | null>(null);
  const [interviewerId, setInterviewerId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setStageId(null);
      setInterviewerId(null);
      setConfirming(false);
    }
  }, [open]);

  const stage = stages.find((s) => s.id === stageId) ?? null;
  const interviewer = interviewers.find((i) => i.id === interviewerId) ?? null;
  const needsInterviewer = stage?.requires_interviewer ?? false;
  const canContinue = !!stage && (!needsInterviewer || !!interviewer);
  const activeInterviewers = interviewers.filter((i) => i.is_active);

  const alreadyThere = info && stage ? info.filter((c) => c.stage_id === stage.id).length : 0;
  const toMove = info ? info.length - alreadyThere : 0;

  async function move() {
    if (!stage) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("move_candidates", {
      p_ids: ids,
      p_stage_id: stage.id,
      p_interviewer_id: needsInterviewer ? interviewerId : null,
    });
    setSaving(false);
    if (error) return toast.error("Couldn't move the candidates", { description: error.message });
    const result = data as MoveResult;
    toast.success(
      result.changed
        ? `Moved ${plural(result.changed)} to ${stage.name}${interviewer && needsInterviewer ? ` · ${interviewer.name}` : ""}`
        : `Nothing to change: already in ${stage.name}`,
    );
    onMoved(result);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            {info ? <>{plural(info.length)} · currently in {fromStagesText(info)}</> : "Loading the selected candidates…"}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {!info && !error && <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" />}

        {info && !confirming && (
          <>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Move to</p>
              {stages.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
                    stageId === s.id ? "border-primary bg-primary/5" : "hover:bg-accent/50",
                  )}
                >
                  <input type="radio" name="stage" className="accent-[var(--primary)]" checked={stageId === s.id} onChange={() => setStageId(s.id)} />
                  <span className="w-5 text-right text-xs text-muted-foreground">{s.position}.</span>
                  <Badge color={s.color}>{s.name}</Badge>
                  {s.requires_interviewer && <span className="ml-auto text-xs text-muted-foreground">asks for interviewer</span>}
                </label>
              ))}
            </div>

            {needsInterviewer && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Interviewer for {stage?.name} <span className="text-red-600">*</span></p>
                <InterviewerPicker interviewers={activeInterviewers} value={interviewerId} onChange={(v) => setInterviewerId(typeof v === "number" ? v : null)} />
                <p className="text-xs text-muted-foreground">All {plural(info.length)} get this interviewer. You can change it per candidate later.</p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!canContinue} onClick={() => setConfirming(true)}>Continue</Button>
            </DialogFooter>
          </>
        )}

        {info && confirming && stage && (
          <>
            <div className="rounded-md border bg-muted/40 p-4 text-sm">
              <p className="text-base font-medium">
                Move {plural(toMove)} from {fromStagesText(info.filter((c) => c.stage_id !== stage.id)) || "—"} to {stage.name}?
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">→</span>
                <Badge color={stage.color}>{stage.name}</Badge>
                {needsInterviewer && interviewer && (
                  <>
                    <span className="text-muted-foreground">with</span>
                    <Badge color={interviewer.color}>{interviewer.name}</Badge>
                  </>
                )}
              </div>
              {alreadyThere > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {plural(alreadyThere)} {alreadyThere === 1 ? "is" : "are"} already in {stage.name}
                  {needsInterviewer ? ` and will only get ${interviewer?.name} as interviewer` : " and won't change"}.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Every move is saved in the Activity Log with your name and the time.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
              <Button onClick={move} disabled={saving || (toMove === 0 && !needsInterviewer)}>
                {saving ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                Yes, move {plural(toMove || info.length)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Assign / Change Interviewer" for one or many candidates (or remove it). */
export function InterviewerDialog({
  open,
  onOpenChange,
  ids,
  interviewers,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  interviewers: Interviewer[];
  onChanged: () => void;
}) {
  const { info, error, supabase } = useSelectedInfo(open, ids);
  const [choice, setChoice] = useState<number | "none" | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setChoice(null);
  }, [open]);

  const chosen = typeof choice === "number" ? interviewers.find((i) => i.id === choice) : null;
  const current = new Map<string, number>();
  info?.forEach((c) => current.set(c.interviewer_name ?? "No interviewer", (current.get(c.interviewer_name ?? "No interviewer") ?? 0) + 1));

  async function save() {
    if (choice === null) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("set_interviewer", { p_ids: ids, p_interviewer_id: choice === "none" ? null : choice });
    setSaving(false);
    if (error) return toast.error("Couldn't change the interviewer", { description: error.message });
    const changed = (data as MoveResult).changed;
    toast.success(changed ? `${chosen ? `${chosen.name} assigned to` : "Interviewer removed from"} ${plural(changed)}` : "Nothing to change");
    onChanged();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign / change interviewer</DialogTitle>
          <DialogDescription>
            {info
              ? <>{plural(info.length)} · now: {[...current.entries()].map(([n, c]) => `${n} ${c}`).join(", ")}</>
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {info && (
          <>
            <InterviewerPicker interviewers={interviewers.filter((i) => i.is_active)} value={choice} onChange={setChoice} allowNone />
            {choice !== null && (
              <p className="rounded-md border bg-muted/40 p-3 text-sm">
                {chosen ? <>Assign <b>{chosen.name}</b> to {plural(info.length)}?</> : <>Remove the interviewer from {plural(info.length)}?</>}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={choice === null || saving} onClick={save}>
                {saving && <Loader2 className="animate-spin" />} Save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InterviewerPicker({
  interviewers,
  value,
  onChange,
  allowNone,
}: {
  interviewers: Interviewer[];
  value: number | "none" | null;
  onChange: (v: number | "none") => void;
  allowNone?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {interviewers.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => onChange(i.id)}
          className={cn(
            "rounded-full border-2 px-3 py-1 text-sm font-medium transition-colors",
            value === i.id ? "text-white" : "bg-card hover:bg-accent",
          )}
          style={value === i.id ? { backgroundColor: i.color, borderColor: i.color } : { borderColor: `${i.color}66`, color: i.color }}
        >
          {i.name}
        </button>
      ))}
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange("none")}
          className={cn(
            "rounded-full border-2 px-3 py-1 text-sm transition-colors",
            value === "none" ? "border-foreground bg-foreground text-white" : "border-dashed text-muted-foreground hover:bg-accent",
          )}
        >
          No interviewer
        </button>
      )}
      {!interviewers.length && <p className="text-sm text-muted-foreground">No active interviewers. Add one in Settings.</p>}
    </div>
  );
}
