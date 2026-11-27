/**
 * Test-results upload: reads the assessment export (CSV or Excel), finds each person in the tracker
 * by mobile number, and works out who moves to "JD and Assessment Test Cleared".
 *
 * Columns are found by name (from the real HTLB assessment export):
 *   "Mobile" (required), "Name", "Percentage", "Assessment status", "Candidate ID".
 * Pure functions: no database, so they can be unit-tested.
 */
import { normaliseName, parsePhones, plainText, type CellValue } from "@/lib/naukri/clean";
import type { SheetData } from "@/lib/naukri/read";
import type { Role } from "@/lib/naukri/types";

export interface TestRow {
  rowNumber: number;
  name: string | null;
  phone: string; // 10-digit mobile
  percentage: number | null;
  status: string | null;
  candidateId: string | null;
  // Extra details, used when the person is added to the tracker from this file.
  city: string | null;
  designation: string | null;
  ctcText: string | null;
  ctcLakhs: number | null;
  raw: Record<string, string | null>;
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
    city: find(h, [/current city/, /^city$/, /current location/, /location/]),
    designation: find(h, [/current designation/, /designation/]),
    ctc: find(h, [/current ctc/, /ctc/, /salary/]),
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
      city: plainText(v(col.city)),
      designation: plainText(v(col.designation)),
      ctcText: plainText(v(col.ctc)),
      ctcLakhs: ctcToLakhs(plainText(v(col.ctc))),
      raw: Object.fromEntries(h.map((k) => [k, plainText(r.values[k])])),
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

/**
 * "Current CTC (₹ LPA)": most people type lakhs (10.35), some type rupees (3600000).
 * Numbers of 1,000 or more are treated as rupees and converted to lakhs.
 */
export function ctcToLakhs(text: string | null): number | null {
  if (!text) return null;
  const n = parseFloat(text.replace(/[,₹\s]/g, "").replace(/(lpa|lakhs?|l)$/i, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const lakhs = n >= 1000 ? n / 100000 : n;
  return lakhs > 0 && lakhs < 100000 ? Math.round(lakhs * 100) / 100 : null;
}

/** "HTLB-ZBM-assessment-results.csv" → ZBM. Null when the name has neither (or both). */
export function roleFromFileName(fileName: string): Role | null {
  const zbm = /zbm/i.test(fileName);
  const hos = /hos/i.test(fileName);
  return zbm === hos ? null : zbm ? "ZBM" : "HOS";
}

/** A saved candidate with the same name (from find_candidates_by_name). */
export interface SameNameCandidate {
  id: string;
  name: string;
  name_norm: string;
  primary_phone: string | null;
  stage_name: string;
}

export interface NewPeoplePlan<R extends { name: string | null } = TestRow> {
  toAdd: R[]; // not in the tracker → added from the file
  sameName: { row: R; matches: SameNameCandidate[] }[]; // same name already in this role → probably the same person
  noName: R[]; // no name in the file → can't be added
}

/**
 * People not in the tracker (by mobile). They are added to the chosen role, except:
 * • rows with no name, and
 * • rows whose name already exists in that role (probably the same person who used another mobile on
 *   Naukri). These are only added when includeSameName is ticked.
 */
export function planNewPeople<R extends { name: string | null }>(notFound: R[], sameNames: SameNameCandidate[], includeSameName: boolean): NewPeoplePlan<R> {
  const byName = new Map<string, SameNameCandidate[]>();
  for (const c of sameNames) byName.set(c.name_norm, [...(byName.get(c.name_norm) ?? []), c]);
  const plan: NewPeoplePlan<R> = { toAdd: [], sameName: [], noName: [] };
  for (const row of notFound) {
    if (!row.name) {
      plan.noName.push(row);
      continue;
    }
    const matches = byName.get(normaliseName(row.name)) ?? [];
    if (matches.length) {
      plan.sameName.push({ row, matches });
      if (includeSameName) plan.toAdd.push(row);
    } else plan.toAdd.push(row);
  }
  return plan;
}

/** What is sent to the database for each person added from the test file. */
export function toNewCandidate(row: TestRow) {
  const name = (row.name ?? "").replace(/\s+/g, " ").trim();
  return {
    name,
    name_norm: normaliseName(name),
    primary_phone: row.phone,
    phone_raw: row.raw ? (Object.entries(row.raw).find(([k]) => /mobile|phone/i.test(k))?.[1] ?? row.phone) : row.phone,
    current_location: row.city,
    designation: row.designation,
    salary_text: row.ctcText ? `${row.ctcText} (test file)` : null,
    salary_lakhs: row.ctcLakhs,
    raw: row.raw,
  };
}
