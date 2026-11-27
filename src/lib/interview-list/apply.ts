/**
 * Saves an interviewer-list upload (runs in the browser as the logged-in user):
 * move people to 1:1 Aligned with the interviewer, add people not in the tracker, save booking
 * times, optionally mark changed times as Rescheduled, and record it in Upload History + Activity Log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/naukri/types";
import type { NewPeoplePlan } from "@/lib/test-results/parse";
import { toNewInterviewCandidate, type FoundPerson, type ListFile, type ListPlan, type ListRow } from "./parse";

const CHUNK = 1000;

export async function findPeopleByPhones(supabase: SupabaseClient, phones: string[]): Promise<FoundPerson[]> {
  const unique = [...new Set(phones)];
  const out: FoundPerson[] = [];
  for (let i = 0; i < Math.max(unique.length, 1); i += CHUNK) {
    const { data, error } = await supabase.rpc("find_candidates_by_phone", { p_phones: unique.slice(i, i + CHUNK) });
    if (error) throw new Error(`Couldn't look up candidates: ${error.message}`);
    out.push(...((data ?? []) as FoundPerson[]));
  }
  return out;
}

export interface ListApplyResult {
  uploadId: string;
  assigned: number;
  added: number;
  timesSaved: number;
  rescheduled: number;
}

export async function applyInterviewList(
  supabase: SupabaseClient,
  args: {
    fileName: string;
    fileSize: number;
    file: ListFile;
    plan: ListPlan;
    interviewer: { id: number; name: string };
    oneToOne: { id: number; name: string };
    reassign: boolean; // move people who are with another interviewer
    markRescheduled: boolean; // booking time changed → mark Rescheduled
    add: { role: Role; people: NewPeoplePlan<ListRow> } | null;
  },
): Promise<ListApplyResult> {
  const { plan, file, interviewer, oneToOne, add } = args;
  const movePairs = [...plan.toAssign, ...(args.reassign ? plan.otherInterviewer : [])];

  const { data: upload, error } = await supabase
    .from("uploads")
    .insert({
      kind: "interviewer_list",
      file_name: args.fileName,
      file_size_bytes: args.fileSize,
      status: "processing",
      total_rows: file.rows.length + file.errors.length + file.duplicatesInFile,
      error_count: file.errors.length,
      errors: file.errors.map((e) => ({ row: e.rowNumber, name: e.name, message: e.message })),
    })
    .select("id")
    .single();
  if (error || !upload) throw new Error(`Couldn't start the upload: ${error?.message ?? "unknown error"}. Nothing was changed.`);

  let assigned = 0, added = 0, timesSaved = 0, rescheduled = 0;
  let failed: string | null = null;
  try {
    // 1. Move to 1:1 Aligned with this interviewer.
    const ids = movePairs.map((p) => p.candidate.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.rpc("move_candidates", { p_ids: ids.slice(i, i + CHUNK), p_stage_id: oneToOne.id, p_interviewer_id: interviewer.id });
      if (error) throw new Error(`Moving stopped after ${assigned}: ${error.message}`);
      assigned += (data as { changed: number }).changed;
    }
    // 2. Add people not in the tracker.
    if (add && add.people.toAdd.length) {
      const rows = add.people.toAdd.map(toNewInterviewCandidate);
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { data, error } = await supabase.rpc("add_interview_candidates", {
          p_upload_id: upload.id, p_role: add.role, p_stage_id: oneToOne.id, p_interviewer_id: interviewer.id, p_rows: rows.slice(i, i + CHUNK),
        });
        if (error) throw new Error(`Adding new people stopped after ${added}: ${error.message}`);
        added += (data as { added: number }).added;
      }
    }
    // 3. Mark changed booking times as Rescheduled (before saving the new time).
    if (args.markRescheduled && plan.timeChanged.length) {
      const changedIds = plan.timeChanged.filter((p) => args.reassign || p.candidate.interviewer_id === interviewer.id).map((p) => p.candidate.id);
      if (changedIds.length) {
        const { data, error } = await supabase.rpc("set_rescheduled", { p_ids: changedIds, p_value: true });
        if (error) throw new Error(`Marking Rescheduled failed: ${error.message}`);
        rescheduled = (data as { changed: number }).changed;
      }
    }
    // 4. Save booking times for everyone this upload touched (and those already with this interviewer).
    const timed = [...movePairs, ...plan.already].filter((p) => p.row.when).map((p) => ({ id: p.candidate.id, interview_at: p.row.when }));
    for (let i = 0; i < timed.length; i += CHUNK) {
      const { data, error } = await supabase.rpc("set_interview_times", { p_rows: timed.slice(i, i + CHUNK) });
      if (error) throw new Error(`Saving 1:1 times failed: ${error.message}`);
      timesSaved += Number(data ?? 0);
    }
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
  }

  const person = (p: { row: ListRow; candidate: FoundPerson }) => ({
    id: p.candidate.id, name: p.candidate.name, role: p.candidate.role, phone: p.row.phone, stage: p.candidate.stage_name,
    interviewer: p.candidate.interviewer_name, when: p.row.when, old_when: p.candidate.interview_at,
  });
  const notAdded = add ? plan.notFound.length - add.people.toAdd.length : plan.notFound.length;
  await supabase
    .from("uploads")
    .update({
      status: failed ? "failed" : "completed",
      failure_message: failed,
      zbm_rows: movePairs.filter((p) => p.candidate.role === "ZBM").length + (add?.role === "ZBM" ? added : 0),
      hos_rows: movePairs.filter((p) => p.candidate.role === "HOS").length + (add?.role === "HOS" ? added : 0),
      new_added: assigned + added,
      duplicates_skipped: plan.already.length,
      unassigned_count: Math.max(notAdded, 0),
      summary: {
        interviewer: interviewer.name,
        stage: oneToOne.name,
        reassign: args.reassign,
        mark_rescheduled: args.markRescheduled,
        added_role: add?.role ?? null,
        assigned: plan.toAssign.map(person),
        other_interviewer: plan.otherInterviewer.map(person),
        already: plan.already.map(person),
        further: plan.further.map(person),
        time_changed: plan.timeChanged.map(person),
        added: (add?.people.toAdd ?? []).map((r) => ({ name: r.name, phone: r.phone, role: add?.role, when: r.when })),
        same_name: (add?.people.sameName ?? []).map((s) => ({ name: s.row.name, phone: s.row.phone, existing: s.matches.map((m) => ({ id: m.id, phone: m.primary_phone, stage: m.stage_name })) })),
        not_found: (add ? add.people.noName : plan.notFound).map((r) => ({ row: r.rowNumber, name: r.name, phone: r.phone })),
        duplicates_in_file: file.duplicatesInFile,
      },
    })
    .eq("id", upload.id);

  await supabase.from("activity_log").insert({
    action: "upload",
    upload_id: upload.id,
    details: {
      kind: "interviewer_list",
      file_name: args.fileName,
      interviewer: interviewer.name,
      assigned,
      added,
      added_role: add?.role ?? null,
      already: plan.already.length,
      other_interviewer_skipped: args.reassign ? 0 : plan.otherInterviewer.length,
      further: plan.further.length,
      rescheduled,
      not_found: Math.max(notAdded, 0),
      failed,
    },
  });
  if (failed) throw new Error(`${failed}. What was done so far is saved in Upload History; upload the same file again to finish.`);
  return { uploadId: upload.id, assigned, added, timesSaved, rescheduled };
}
