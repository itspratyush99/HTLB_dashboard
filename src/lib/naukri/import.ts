/**
 * Talks to Supabase for the upload flow (runs in the browser, as the logged-in user):
 *   1. load role keyword rules
 *   2. find existing candidates that share a phone/email with the file
 *   3. save the upload record, the candidates (in batches of 500), the screening questions, and an activity-log entry
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingCandidate } from "./dedupe";
import { DEFAULT_ROLE_KEYWORDS, type RoleKeyword } from "./roles";
import type { CandidateInput, Role, RowError, ScreeningQuestion } from "./types";

export const INSERT_BATCH_SIZE = 500;
const LOOKUP_CHUNK = 1000;

export async function fetchRoleRules(supabase: SupabaseClient): Promise<RoleKeyword[]> {
  const { data, error } = await supabase.from("role_keywords").select("role, keyword, whole_word");
  if (error) throw new Error(`Couldn't load role keywords: ${error.message}`);
  return data && data.length ? (data as RoleKeyword[]) : DEFAULT_ROLE_KEYWORDS;
}

export async function fetchExistingMatches(
  supabase: SupabaseClient,
  phones: string[],
  emails: string[],
): Promise<ExistingCandidate[]> {
  const uniquePhones = [...new Set(phones.filter(Boolean))];
  const uniqueEmails = [...new Set(emails.filter(Boolean))];
  const results = new Map<string, ExistingCandidate>();
  const chunks = Math.max(Math.ceil(uniquePhones.length / LOOKUP_CHUNK), Math.ceil(uniqueEmails.length / LOOKUP_CHUNK), 1);
  for (let i = 0; i < chunks; i++) {
    const { data, error } = await supabase.rpc("match_existing_candidates", {
      p_phones: uniquePhones.slice(i * LOOKUP_CHUNK, (i + 1) * LOOKUP_CHUNK),
      p_emails: uniqueEmails.slice(i * LOOKUP_CHUNK, (i + 1) * LOOKUP_CHUNK),
    });
    if (error) throw new Error(`Couldn't check for duplicates: ${error.message}`);
    for (const row of (data ?? []) as ExistingCandidate[]) results.set(row.id, row);
  }
  return [...results.values()];
}

/** A row the user made a decision about, stored with the upload for the history page. */
export interface FlaggedRecord {
  row: number;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  matched: { id: string | null; name: string; stage: string | null; from_file_row: number | null }[];
  decision: "skip" | "add";
}
export interface UnassignedRecord {
  row: number;
  name: string;
  job_title: string | null;
  decision: Role | "skip";
}
export interface NoteRecord {
  row: number;
  name: string | null;
  message: string;
}

export interface ImportRequest {
  fileName: string;
  fileSize: number;
  candidates: (CandidateInput & { role: Role; rowNumber: number })[];
  /** People added earlier from a test file: fill in their details from these rows. */
  complete: { id: string; stage: string | null; row: number; candidate: CandidateInput & { role: Role } }[];
  questions: ScreeningQuestion[];
  counts: {
    total_rows: number;
    zbm_rows: number;
    hos_rows: number;
    duplicates_skipped: number;
    flagged_count: number;
    flagged_added: number;
    flagged_skipped: number;
    unassigned_count: number;
  };
  flagged: FlaggedRecord[];
  unassigned: UnassignedRecord[];
  errors: RowError[];
  warnings: NoteRecord[];
}

export interface ImportResult {
  uploadId: string;
  inserted: number;
  completed: number;
  insertedByRole: Record<Role, number>;
  failed: string | null; // message if the import stopped part-way
}

export async function runImport(
  supabase: SupabaseClient,
  req: ImportRequest,
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  // 1. Upload record first, so every candidate can point to it.
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .insert({
      file_name: req.fileName,
      file_size_bytes: req.fileSize,
      status: "processing",
      ...req.counts,
      error_count: req.errors.length,
      warning_count: req.warnings.length,
      flagged: req.flagged,
      unassigned: req.unassigned,
      errors: req.errors.map((e) => ({ row: e.rowNumber, name: e.name, message: e.message })),
      warnings: req.warnings,
    })
    .select("id")
    .single();
  if (uploadError || !upload) throw new Error(`Couldn't start the upload: ${uploadError?.message ?? "unknown error"}`);

  // 2. Screening questions (new ones only; existing ones are left as they are).
  for (const role of ["ZBM", "HOS"] as Role[]) {
    if (!req.candidates.some((c) => c.role === role) || !req.questions.length) continue;
    await supabase
      .from("screening_questions")
      .upsert(req.questions.map((q) => ({ role, question: q.question, is_numeric: q.is_numeric })), {
        onConflict: "role,question",
        ignoreDuplicates: true,
      });
  }

  // 3. Candidates, in batches. Stage is always set by the database to the default stage.
  let inserted = 0;
  const insertedByRole: Record<Role, number> = { ZBM: 0, HOS: 0 };
  let failed: string | null = null;
  onProgress(0, req.candidates.length);
  for (let i = 0; i < req.candidates.length; i += INSERT_BATCH_SIZE) {
    const batch = req.candidates.slice(i, i + INSERT_BATCH_SIZE).map((c) => {
      const { rowNumber, ...row } = c; // rowNumber is only used in the preview, not stored
      void rowNumber;
      return { ...row, upload_id: upload.id };
    });
    const { error } = await supabase.from("candidates").insert(batch);
    if (error) {
      failed = `Stopped after ${inserted} of ${req.candidates.length} candidates: ${error.message}`;
      break;
    }
    inserted += batch.length;
    batch.forEach((c) => insertedByRole[c.role]++);
    onProgress(inserted, req.candidates.length);
  }

  // 4. Fill in the details of people who were added from a test-results file.
  let completed = 0;
  if (!failed && req.complete.length) {
    for (let i = 0; i < req.complete.length; i += INSERT_BATCH_SIZE) {
      const batch = req.complete.slice(i, i + INSERT_BATCH_SIZE).map((c) => ({ ...c.candidate, id: c.id }));
      const { data, error } = await supabase.rpc("complete_test_candidates", { p_rows: batch });
      if (error) {
        failed = `New candidates were added, but filling in the details of people from the test file stopped after ${completed}: ${error.message}`;
        break;
      }
      completed += Number(data ?? 0);
    }
  }

  // 5. Final counts + history entry.
  await supabase
    .from("uploads")
    .update({
      status: failed ? "failed" : "completed",
      new_added: inserted,
      failure_message: failed,
      summary: { completed: req.complete.map((c) => ({ id: c.id, row: c.row, name: c.candidate.name, role: c.candidate.role, phone: c.candidate.primary_phone, stage: c.stage })) },
    })
    .eq("id", upload.id);

  const rolesTouched = (["ZBM", "HOS"] as Role[]).filter((r) => insertedByRole[r] > 0);
  await supabase.from("activity_log").insert({
    action: "upload",
    upload_id: upload.id,
    role: rolesTouched.length === 1 ? rolesTouched[0] : null,
    details: {
      file_name: req.fileName,
      new_added: inserted,
      zbm_added: insertedByRole.ZBM,
      hos_added: insertedByRole.HOS,
      duplicates_skipped: req.counts.duplicates_skipped,
      completed,
      flagged_added: req.counts.flagged_added,
      flagged_skipped: req.counts.flagged_skipped,
      errors: req.errors.length,
      failed,
    },
  });

  return { uploadId: upload.id, inserted, completed, insertedByRole, failed };
}
