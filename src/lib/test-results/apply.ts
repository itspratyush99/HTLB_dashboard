/**
 * Talks to Supabase for the test-results upload (runs in the browser as the logged-in user):
 * find candidates by mobile, move them, and record the upload in Upload History + Activity Log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FoundCandidate, TestFile, TestPlan } from "./parse";

const CHUNK = 1000;

export async function findByPhones(supabase: SupabaseClient, phones: string[]): Promise<FoundCandidate[]> {
  const unique = [...new Set(phones)];
  const out: FoundCandidate[] = [];
  for (let i = 0; i < Math.max(unique.length, 1); i += CHUNK) {
    const { data, error } = await supabase.rpc("find_candidates_by_phone", { p_phones: unique.slice(i, i + CHUNK) });
    if (error) throw new Error(`Couldn't look up candidates: ${error.message}`);
    out.push(...((data ?? []) as FoundCandidate[]));
  }
  return out;
}

export async function loadTestSettings(supabase: SupabaseClient) {
  const [stages, setting] = await Promise.all([
    supabase.from("stages").select("id, name, color, position, is_default").order("position"),
    supabase.from("app_settings").select("value").eq("key", "test_cleared_stage_id").maybeSingle(),
  ]);
  if (stages.error) throw new Error(stages.error.message);
  const list = (stages.data ?? []) as { id: number; name: string; color: string; position: number; is_default: boolean }[];
  const shortlisted = list.find((s) => s.is_default) ?? list[0];
  const saved = Number(setting.data?.value);
  const target = list.find((s) => s.id === saved) ?? list.find((s) => s.position === shortlisted.position + 1) ?? list[1];
  return { stages: list, shortlistedStageId: shortlisted.id, targetStageId: target?.id ?? null };
}

export interface ApplyResult {
  uploadId: string;
  moved: number;
}

export async function applyTestResults(
  supabase: SupabaseClient,
  args: { fileName: string; fileSize: number; file: TestFile; plan: TestPlan; targetStage: { id: number; name: string }; passMark: number | null },
): Promise<ApplyResult> {
  const { plan, file, targetStage } = args;
  const ids = plan.toMove.map((m) => m.candidate.id);

  let moved = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.rpc("move_candidates", { p_ids: ids.slice(i, i + CHUNK), p_stage_id: targetStage.id, p_interviewer_id: null });
    if (error) throw new Error(`Moving candidates failed after ${moved}: ${error.message}`);
    moved += (data as { changed: number }).changed;
  }

  const summary = {
    target_stage: targetStage.name,
    pass_mark: args.passMark,
    moved: plan.toMove.map((m) => ({ id: m.candidate.id, name: m.candidate.name, role: m.candidate.role, phone: m.row.phone, from_tag: m.candidate.tag_name, percentage: m.row.percentage })),
    already_moved: plan.alreadyMoved.map((m) => ({ name: m.candidate.name, role: m.candidate.role, phone: m.row.phone, stage: m.candidate.stage_name })),
    other_stage: plan.otherStage.map((m) => ({ name: m.candidate.name, role: m.candidate.role, phone: m.row.phone, stage: m.candidate.stage_name })),
    below_pass_mark: plan.belowPassMark.map((m) => ({ name: m.row.name, phone: m.row.phone, percentage: m.row.percentage, in_tracker: !!m.candidate })),
    not_found: plan.notFound.map((r) => ({ row: r.rowNumber, name: r.name, phone: r.phone, percentage: r.percentage })),
    duplicates_in_file: file.duplicatesInFile,
  };

  const { data: upload, error } = await supabase
    .from("uploads")
    .insert({
      kind: "test_results",
      file_name: args.fileName,
      file_size_bytes: args.fileSize,
      status: "completed",
      total_rows: file.rows.length + file.errors.length + file.duplicatesInFile,
      zbm_rows: plan.toMove.filter((m) => m.candidate.role === "ZBM").length,
      hos_rows: plan.toMove.filter((m) => m.candidate.role === "HOS").length,
      new_added: moved,
      duplicates_skipped: plan.alreadyMoved.length,
      unassigned_count: plan.notFound.length,
      error_count: file.errors.length,
      errors: file.errors.map((e) => ({ row: e.rowNumber, name: e.name, message: e.message })),
      summary,
    })
    .select("id")
    .single();
  if (error || !upload) throw new Error(`Candidates were moved, but the upload couldn't be saved to Upload History: ${error?.message}`);

  await supabase.from("activity_log").insert({
    action: "upload",
    upload_id: upload.id,
    details: {
      kind: "test_results",
      file_name: args.fileName,
      moved,
      target_stage: targetStage.name,
      already_moved: plan.alreadyMoved.length,
      not_found: plan.notFound.length,
      below_pass_mark: plan.belowPassMark.length,
    },
  });
  return { uploadId: upload.id, moved };
}
