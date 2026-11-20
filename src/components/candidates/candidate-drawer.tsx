"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, CalendarClock, Download, ExternalLink, Loader2, Tag as TagIcon, Trash2, Upload, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { RESCHEDULED_COLOR } from "@/lib/candidates/rescheduled";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatDateTime } from "@/lib/dates";
import { describeEvent, type HistoryEvent } from "@/lib/candidates/history";
import type { CandidateRow, Interviewer, Stage } from "@/lib/candidates/types";
import { ROLE_COLORS } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { DeleteDialog } from "./delete-dialog";
import { InterviewerDialog, MoveDialog } from "./move-dialog";
import type { Viewer } from "@/lib/viewer";

type Detail = CandidateRow & {
  raw: Record<string, string | null>;
  doctorate: { degree: string | null; specialization: string | null; institute: string | null } | null;
  naukri_pipeline_stage: string | null;
  upload_file_name: string | null;
  created_by_name: string | null;
};

/** Side panel for one candidate: every detail, quick actions, and the full history timeline. */
export function CandidateDrawer({
  candidateId,
  onClose,
  stages,
  interviewers,
  viewer,
  onChanged,
}: {
  candidateId: string | null;
  onClose: () => void;
  stages: Stage[];
  interviewers: Interviewer[];
  viewer?: Viewer;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [interviewerOpen, setInterviewerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    if (!candidateId) return;
    const [c, h] = await Promise.all([
      supabase.rpc("get_candidate", { p_id: candidateId }),
      supabase.rpc("candidate_history", { p_id: candidateId }),
    ]);
    if (c.error || h.error) return setError((c.error ?? h.error)!.message);
    setError(null);
    setDetail(c.data as Detail);
    setHistory(h.data as HistoryEvent[]);
  }, [supabase, candidateId]);

  useEffect(() => {
    setDetail(null);
    setHistory(null);
    load();
  }, [load]);

  const [reschedSaving, setReschedSaving] = useState(false);
  async function toggleRescheduled() {
    if (!detail) return;
    setReschedSaving(true);
    const { error } = await supabase.rpc("set_rescheduled", { p_ids: [detail.id], p_value: !detail.rescheduled });
    setReschedSaving(false);
    if (error) return toast.error("Couldn't save", { description: error.message });
    toast.success(detail.rescheduled ? "Rescheduled removed" : "Marked Rescheduled");
    afterChange();
  }

  const afterChange = () => {
    load();
    onChanged();
  };

  return (
    <Dialog open={!!candidateId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-2xl">
        {!detail && !error && (
          <div className="flex flex-1 items-center justify-center">
            <DialogTitle className="sr-only">Loading candidate</DialogTitle>
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="p-6 text-sm text-red-700">
            <DialogTitle>Couldn&apos;t load this candidate</DialogTitle>
            {error}
          </div>
        )}
        {detail && (
          <>
            <div className="border-b px-6 py-4">
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="text-xl">{detail.name}</DialogTitle>
                <Badge color={ROLE_COLORS[detail.role]}>{detail.role}</Badge>
              </div>
              <DialogDescription className="mt-1">
                {[detail.designation, detail.current_company].filter(Boolean).join(" at ") || detail.resume_headline || "—"}
              </DialogDescription>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge color={detail.stage_color} className="px-2.5 py-1 text-sm">{detail.stage_name}</Badge>
                {detail.tag_name && <Badge color={detail.tag_color} className="px-2.5 py-1 text-sm">Tag {detail.tag_name}</Badge>}
                {detail.source === "test_file" && (
                  <Badge color="#64748b" className="px-2.5 py-1 text-sm" title="Added from a test-results file. The next Naukri upload with this mobile fills in the other details.">From test file</Badge>
                )}
                {detail.rescheduled && <Badge color={RESCHEDULED_COLOR} className="px-2.5 py-1 text-sm">Rescheduled</Badge>}
                {detail.interviewer_name && <Badge color={detail.interviewer_color} className="px-2.5 py-1 text-sm">{detail.interviewer_name}</Badge>}
                <span className="text-xs text-muted-foreground">in this stage since {formatDate(detail.stage_changed_at)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setMoveOpen(true)}><ArrowRightLeft /> Move stage…</Button>
                {!viewer?.interviewerOnly && (
                  <Button size="sm" variant="outline" onClick={() => setInterviewerOpen(true)}><Users /> Interviewer…</Button>
                )}
                {stages.find((st) => st.id === detail.stage_id)?.requires_interviewer && (
                  <Button size="sm" variant="outline" disabled={reschedSaving} onClick={toggleRescheduled}>
                    {reschedSaving ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                    {detail.rescheduled ? "Remove Rescheduled" : "Mark Rescheduled"}
                  </Button>
                )}
                {detail.profile_url && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={detail.profile_url} target="_blank" rel="noopener noreferrer"><ExternalLink /> Naukri profile</a>
                  </Button>
                )}
                {viewer?.isAdmin && (
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete…
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <Fields
                title="Contact"
                rows={[
                  ["Mobile", detail.primary_phone ?? <span className="text-red-600">no valid mobile — skipped in exports</span>],
                  ["Other phone", detail.alternate_phone],
                  ["Email", detail.email],
                  ["Other email", detail.alternate_email],
                ]}
              />
              <Fields
                title="Work"
                rows={[
                  ["Experience", detail.total_exp_text],
                  ["Annual salary", detail.salary_text],
                  ["Notice period", detail.notice_period],
                  ["Company", detail.current_company],
                  ["Designation", detail.designation],
                  ["Headline", detail.resume_headline],
                ]}
              />
              <Fields
                title="Location & personal"
                rows={[
                  ["Current location", detail.current_location],
                  ["Preferred locations", detail.preferred_locations],
                  ["Home town", detail.home_town],
                  ["Gender", detail.gender],
                  ["Date of birth", detail.dob ? formatDate(detail.dob) : null],
                ]}
              />
              <Fields
                title="Education"
                rows={[
                  ["UG", [detail.ug_degree, detail.ug_specialization, detail.ug_institute].filter(Boolean).join(" · ") || null],
                  ["PG", [detail.pg_degree, detail.pg_specialization, detail.pg_institute].filter(Boolean).join(" · ") || null],
                  ["Doctorate", detail.doctorate ? [detail.doctorate.degree, detail.doctorate.specialization, detail.doctorate.institute].filter(Boolean).join(" · ") : null],
                ]}
              />
              {Object.keys(detail.screening ?? {}).length > 0 && (
                <Fields title="Screening answers" rows={Object.entries(detail.screening).map(([q, a]) => [q, a.t])} wideLabel />
              )}
              <Fields
                title="From Naukri"
                rows={[
                  ["Job title", detail.job_title],
                  ["Date of application", detail.applied_on ? formatDate(detail.applied_on) : null],
                  ["Naukri pipeline stage", detail.naukri_pipeline_stage],
                  ["Upload", detail.upload_file_name],
                  ["Added", `${formatDateTime(detail.created_at)}${detail.created_by_name ? ` by ${detail.created_by_name}` : ""}`],
                ]}
              />

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h3>
                {!history ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <ol className="relative space-y-4 border-l pl-5">
                    {history.map((e, i) => {
                      const { title, note } = describeEvent(e);
                      const Icon = e.kind === "added" ? Upload : e.kind === "export" ? Download : e.kind === "interviewer_change" ? UserRound : e.kind === "tag_change" ? TagIcon : e.kind === "reschedule" ? CalendarClock : ArrowRightLeft;
                      return (
                        <li key={i} className="relative">
                          <span
                            className={cn(
                              "absolute -left-[31px] flex size-5 items-center justify-center rounded-full border bg-card",
                              e.kind === "stage_change" && "border-primary text-primary",
                              e.kind === "export" && "border-emerald-500 text-emerald-600",
                            )}
                          >
                            <Icon className="size-3" />
                          </span>
                          <p className="text-sm font-medium">{title}</p>
                          {note && <p className="text-xs text-muted-foreground">{note}</p>}
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(e.at)} · {e.user_name ?? "system"}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Original Naukri row
                </summary>
                <dl className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1 text-xs">
                  {Object.entries(detail.raw ?? {}).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-muted-foreground" title={k}>{k}</dt>
                      <dd className="break-words">{v ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>

            <MoveDialog
              open={moveOpen}
              onOpenChange={setMoveOpen}
              ids={[detail.id]}
              stages={stages}
              interviewers={interviewers}
              heading={`Move ${detail.name}`}
              viewer={viewer}
              onMoved={afterChange}
            />
            <InterviewerDialog open={interviewerOpen} onOpenChange={setInterviewerOpen} ids={[detail.id]} interviewers={interviewers} onChanged={afterChange} />
            <DeleteDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              ids={[detail.id]}
              onDeleted={() => {
                onChanged();
                onClose();
              }}
            />
          </>
        )}
      </SheetContent>
    </Dialog>
  );
}

function Fields({ title, rows, wideLabel }: { title: string; rows: [string, React.ReactNode][]; wideLabel?: boolean }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className={cn("grid gap-x-4 gap-y-1.5 text-sm", wideLabel ? "grid-cols-[minmax(0,3fr)_minmax(0,1fr)]" : "grid-cols-[9rem_minmax(0,1fr)]")}>
        {shown.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
