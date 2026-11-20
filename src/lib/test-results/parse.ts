/**
 * Test-results upload: reads the assessment export (CSV or Excel), finds each person in the tracker
 * by mobile number, and works out who moves to "JD and Assessment Test Cleared".
 *
 * Columns are found by name (from the real HTLB assessment export):
 *   "Mobile" (required), "Name", "Percentage", "Assessment status", "Candidate ID".
 * Pure functions: no database, so they can be unit-tested.
 */
import { parsePhones, plainText, type CellValue } from "@/lib/naukri/clean";
import type { SheetData } from "@/lib/naukri/read";
import type { Role } from "@/lib/naukri/types";

export interface TestRow {
  rowNumber: number;
  name: string | null;
  phone: string; // 10-digit mobile
  percentage: number | null;
  status: string | null;
  candidateId: string | null;
}

export interface TestFile {
  rows: TestRow[];
  errors: { rowNumber: number; name: string | null; message: string }[];
  duplicatesInFile: number; // same mobile listed again (kept once)
  missingColumns: string[];
  hasPercentage: boolean;
}

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
const find = (headers: string[], tests: RegExp[]) => {
  for (const t of tests) {
    const h = headers.find((x) => t.test(norm(x)));
    if (h) return h;
  }
  return undefined;
};

export function parseTestFile(sheet: SheetData): TestFile {
  const h = sheet.headers;
  const col = {
    mobile: find(h, [/^mobile( number)?$/, /mobile/, /phone/, /contact/]),
    name: find(h, [/^name$/, /candidate name/, /full name/, /name/]),
    percentage: find(h, [/^percentage$/, /percent/, /^%$/, /score/]),
    status: find(h, [/assessment status/, /^status$/]),
    candidateId: find(h, [/candidate id/, /^id$/]),
  };
  if (!col.mobile) {
    return { rows: [], errors: [], duplicatesInFile: 0, missingColumns: ["Mobile"], hasPercentage: false };
  }

  const rows: TestRow[] = [];
  const errors: TestFile["errors"] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;
  for (const r of sheet.rows) {
    const v = (c: string | undefined): CellValue => (c ? r.values[c] : null);
    if (Object.values(r.values).every((x) => plainText(x) === null)) continue; // empty row
    const name = plainText(v(col.name));
    const phone = parsePhones(v(col.mobile)).primary;
    if (!phone) {
      errors.push({ rowNumber: r.rowNumber, name, message: `No valid 10-digit mobile ("${plainText(v(col.mobile)) ?? ""}")` });
      continue;
    }
    if (seen.has(phone)) {
      duplicatesInFile++;
      continue;
    }
    seen.add(phone);
    const pctText = plainText(v(col.percentage));
    const pct = pctText !== null ? parseFloat(pctText.replace(/[%\s,]/g, "")) : NaN;
    rows.push({
      rowNumber: r.rowNumber,
      name,
      phone,
      percentage: Number.isFinite(pct) ? pct : null,
      status: plainText(v(col.status)),
      candidateId: plainText(v(col.candidateId)),
    });
  }
  return { rows, errors, duplicatesInFile, missingColumns: [], hasPercentage: !!col.percentage };
}

/** A tracker candidate found by mobile (from the find_candidates_by_phone database function). */
export interface FoundCandidate {
  id: string;
  role: Role;
  name: string;
  primary_phone: string;
  stage_id: number;
  stage_name: string;
  stage_position: number;
  tag_name: string | null;
}

export interface TestPlan {
  toMove: { row: TestRow; candidate: FoundCandidate }[]; // in Shortlisted (any tag) → will move
  alreadyMoved: { row: TestRow; candidate: FoundCandidate }[]; // already in the target stage or later
  otherStage: { row: TestRow; candidate: FoundCandidate }[]; // in some other earlier stage → left alone
  belowPassMark: { row: TestRow; candidate: FoundCandidate | null }[]; // only when a pass mark is set
  notFound: TestRow[];
}

/**
 * Decides what happens to each row.
 * • A person found in both ZBM and HOS is moved in both (as agreed).
 * • Only candidates in the starting stage (Shortlisted) move; anyone already further is left alone,
 *   so uploading a cumulative file again is safe.
 * • passMark (optional): rows with a lower percentage are not moved.
 */
export function planTestResults(
  file: TestFile,
  found: FoundCandidate[],
  opts: { shortlistedStageId: number; targetStage: { id: number; position: number }; passMark: number | null },
): TestPlan {
  const byPhone = new Map<string, FoundCandidate[]>();
  for (const c of found) byPhone.set(c.primary_phone, [...(byPhone.get(c.primary_phone) ?? []), c]);

  const plan: TestPlan = { toMove: [], alreadyMoved: [], otherStage: [], belowPassMark: [], notFound: [] };
  for (const row of file.rows) {
    const matches = byPhone.get(row.phone) ?? [];
    const failed = opts.passMark !== null && (row.percentage === null || row.percentage < opts.passMark);
    if (!matches.length) {
      if (failed) plan.belowPassMark.push({ row, candidate: null });
      else plan.notFound.push(row);
      continue;
    }
    for (const candidate of matches) {
      if (candidate.stage_id === opts.targetStage.id || candidate.stage_position > opts.targetStage.position) {
        plan.alreadyMoved.push({ row, candidate });
      } else if (candidate.stage_id !== opts.shortlistedStageId) {
        plan.otherStage.push({ row, candidate });
      } else if (failed) {
        plan.belowPassMark.push({ row, candidate });
      } else {
        plan.toMove.push({ row, candidate });
      }
    }
  }
  return plan;
}
