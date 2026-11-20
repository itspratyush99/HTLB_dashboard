/**
 * Talks to Supabase for the test-results upload (runs in the browser as the logged-in user):
 * find candidates by mobile, move them, and record the upload in Upload History + Activity Log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/naukri/types";
import { toNewCandidate, type FoundCandidate, type NewPeoplePlan, type SameNameCandidate, type TestFile, type TestPlan } from "./parse";

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

/** Same-name lookup in one role (for people not found by mobile). */
export async function findByNames(supabase: SupabaseClient, role: Role, names: string[]): Promise<SameNameCandidate[]> {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return [];
  const out: SameNameCandidate[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await supabase.rpc("find_candidates_by_name", { p_role: role, p_names: unique.slice(i, i + CHUNK) });
    if (error) throw new Error(`Couldn't check names: ${error.message}`);
    out.push(...((data ?? []) as SameNameCandidate[]));
  }
  return out;
}

export interface ApplyResult {
  uploadId: string;
  moved: number;
  added: number;
  addedRole: Role | null;
}

export async function applyTestResults(
  supabase: SupabaseClient,
  args: {
    fileName: string;
    fileSize: number;
    file: TestFile;
    plan: TestPlan;
    targetStage: { id: number; name: string };
    passMark: number | null;
    /** People not in the tracker: added to this role (null = not adding anyone). */
    add: { role: Role; people: NewPeoplePlan } | null;
  },
): Promise<ApplyResult> {
  const { plan, file, targetStage, add } = args;

  // 1. Upload record first, so added candidates can point to it.
  const { data: upload, error } = await supabase
    .from("uploads")
    .insert({
      kind: "test_results",
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

  let moved = 0;
  let added = 0;
  let addedIds: string[] = [];
  let failed: string | null = null;
  try {
    // 2. Move the people already in Shortlisted.
    const ids = plan.toMove.map((m) => m.candidate.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.rpc("move_candidates", { p_ids: ids.slice(i, i + CHUNK), p_stage_id: targetStage.id, p_interviewer_id: null });
      if (error) throw new Error(`Moving stopped after ${moved}: ${error.message}`);
      moved += (data as { changed: number }).changed;
    }
    // 3. Add the people who aren't in the tracker (straight into the same stage).
    if (add && add.people.toAdd.length) {
      const rows = add.people.toAdd.map(toNewCandidate);
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { data, error } = await supabase.rpc("add_test_candidates", {
          p_upload_id: upload.id,
          p_role: add.role,
          p_stage_id: targetStage.id,
          p_rows: rows.slice(i, i + CHUNK),
        });
        if (error) throw new Error(`Adding new people stopped after ${added}: ${error.message}`);
        const r = data as { added: number; ids: string[] };
        added += r.added;
        addedIds = addedIds.concat(r.ids);
      }
    }
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
  }

  // 4. Final counts + details for Upload History.
  const addedSet = new Set(addedIds);
  const summary = {
    target_stage: targetStage.name,
    pass_mark: args.passMark,
    added_role: add?.role ?? null,
    moved: plan.toMove.map((m) => ({ id: m.candidate.id, name: m.candidate.name, role: m.candidate.role, phone: m.row.phone, from_tag: m.candidate.tag_name, percentage: m.row.percentage })),
    added: (add?.people.toAdd ?? []).map((r) => ({ name: r.name, phone: r.phone, role: add?.role, percentage: r.percentage, city: r.city })),
    already_moved: plan.alreadyMoved.map((m) => ({ name: m.candidate.name, role: m.candidate.role, phone: m.row.phone, stage: m.candidate.stage_name })),
    other_stage: plan.otherStage.map((m) => ({ name: m.candidate.name, role: m.candidate.role, phone: m.row.phone, stage: m.candidate.stage_name })),
    below_pass_mark: plan.belowPassMark.map((m) => ({ name: m.row.name, phone: m.row.phone, percentage: m.row.percentage, in_tracker: !!m.candidate })),
    same_name: (add?.people.sameName ?? []).map((s) => ({ name: s.row.name, phone: s.row.phone, percentage: s.row.percentage, existing: s.matches.map((m) => ({ id: m.id, phone: m.primary_phone, stage: m.stage_name })) })),
    not_found: add ? add.people.noName.map((r) => ({ row: r.rowNumber, name: r.name, phone: r.phone, percentage: r.percentage }))
                   : plan.notFound.map((r) => ({ row: r.rowNumber, name: r.name, phone: r.phone, percentage: r.percentage })),
    added_ids: [...addedSet],
    duplicates_in_file: file.duplicatesInFile,
  };
  // People in the file who are neither moved nor added (no name, or same name and not ticked).
  const notAdded = add ? plan.notFound.length - add.people.toAdd.length : plan.notFound.length;
  await supabase
    .from("uploads")
    .update({
      status: failed ? "failed" : "completed",
      failure_message: failed,
      zbm_rows: plan.toMove.filter((m) => m.candidate.role === "ZBM").length + (add?.role === "ZBM" ? added : 0),
      hos_rows: plan.toMove.filter((m) => m.candidate.role === "HOS").length + (add?.role === "HOS" ? added : 0),
      new_added: moved + added,
      duplicates_skipped: plan.alreadyMoved.length,
      unassigned_count: Math.max(notAdded, 0),
      summary,
    })
    .eq("id", upload.id);

  await supabase.from("activity_log").insert({
    action: "upload",
    upload_id: upload.id,
    details: {
      kind: "test_results",
      file_name: args.fileName,
      moved,
      added,
      added_role: add?.role ?? null,
      target_stage: targetStage.name,
      already_moved: plan.alreadyMoved.length,
      not_found: Math.max(notAdded, 0),
      below_pass_mark: plan.belowPassMark.length,
      failed,
    },
  });
  if (failed) throw new Error(`${failed}. What was done so far is saved in Upload History; upload the same file again to finish.`);
  return { uploadId: upload.id, moved, added, addedRole: add?.role ?? null };
}
