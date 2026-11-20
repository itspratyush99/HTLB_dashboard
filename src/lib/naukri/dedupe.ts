/**
 * Duplicate rules (checked separately within each role):
 *   • Exact duplicate    = normalised Name + Phone + Email all match → skipped, existing candidate untouched.
 *   • Possible duplicate = Phone OR Email matches, but not all three → user chooses "Skip" or "Add as new".
 *   • Completes a test-file person = same role + same phone as someone added from a test-results file
 *     → their missing details are filled in from this row (no new candidate, stage unchanged).
 *   • Otherwise new.
 * Rows earlier in the same file count as "existing" too, so a file that lists someone twice
 * does not create two candidates.
 */
import type { Role } from "./types";

/** A candidate already in the database (from the match_existing_candidates function). */
export interface ExistingCandidate {
  id: string;
  role: Role;
  name: string;
  name_norm: string;
  email_norm: string | null;
  primary_phone: string | null;
  stage_name: string | null;
  created_at: string;
  origin?: string; // 'naukri' or 'test_file'
}

/** What we compare for one incoming row. */
export interface DedupeKey {
  role: Role;
  name: string;
  name_norm: string;
  email_norm: string | null;
  primary_phone: string | null;
  rowNumber: number;
}

/** A match can be a saved candidate or an earlier row of this same file. */
export type Match =
  | ({ source: "database" } & ExistingCandidate)
  | { source: "file"; rowNumber: number; name: string; email_norm: string | null; primary_phone: string | null };

export type Classification =
  | { kind: "new" }
  | { kind: "exact"; match: Match }
  | { kind: "possible"; matches: Match[] }
  | { kind: "complete"; candidate: ExistingCandidate };

const sameNullable = (a: string | null, b: string | null) => (a ?? "") === (b ?? "");

export function classifyRows(rows: DedupeKey[], existing: ExistingCandidate[]): Classification[] {
  // Index by role → phone / email for quick lookups.
  type Entry = { match: Match; name_norm: string; email_norm: string | null; primary_phone: string | null };
  const byPhone = new Map<string, Entry[]>();
  const byEmail = new Map<string, Entry[]>();
  const add = (role: Role, e: Entry) => {
    if (e.primary_phone) {
      const k = `${role}|${e.primary_phone}`;
      byPhone.set(k, [...(byPhone.get(k) ?? []), e]);
    }
    if (e.email_norm) {
      const k = `${role}|${e.email_norm}`;
      byEmail.set(k, [...(byEmail.get(k) ?? []), e]);
    }
  };
  // Test-file people, by role + phone; each can be completed by one row only.
  const testFile = new Map<string, ExistingCandidate>();
  for (const c of existing) if (c.origin === "test_file" && c.primary_phone) testFile.set(`${c.role}|${c.primary_phone}`, c);
  const completed = new Set<string>();

  for (const c of existing) {
    add(c.role, { match: { source: "database", ...c }, name_norm: c.name_norm, email_norm: c.email_norm, primary_phone: c.primary_phone });
  }

  return rows.map((row) => {
    const tf = row.primary_phone ? testFile.get(`${row.role}|${row.primary_phone}`) : undefined;
    if (tf && !completed.has(tf.id)) {
      completed.add(tf.id);
      // Later rows of this file compare against this one (a repeat becomes an exact duplicate).
      add(row.role, {
        match: { source: "file", rowNumber: row.rowNumber, name: row.name, email_norm: row.email_norm, primary_phone: row.primary_phone },
        name_norm: row.name_norm,
        email_norm: row.email_norm,
        primary_phone: row.primary_phone,
      });
      return { kind: "complete", candidate: tf } as const;
    }
    const candidates = new Set<Entry>();
    if (row.primary_phone) byPhone.get(`${row.role}|${row.primary_phone}`)?.forEach((e) => candidates.add(e));
    if (row.email_norm) byEmail.get(`${row.role}|${row.email_norm}`)?.forEach((e) => candidates.add(e));

    const self: Entry = {
      match: { source: "file", rowNumber: row.rowNumber, name: row.name, email_norm: row.email_norm, primary_phone: row.primary_phone },
      name_norm: row.name_norm,
      email_norm: row.email_norm,
      primary_phone: row.primary_phone,
    };

    if (candidates.size === 0) {
      add(row.role, self);
      return { kind: "new" } as const;
    }
    const exact = [...candidates].find(
      (e) =>
        e.name_norm === row.name_norm &&
        sameNullable(e.primary_phone, row.primary_phone) &&
        sameNullable(e.email_norm, row.email_norm),
    );
    if (exact) return { kind: "exact", match: exact.match } as const;

    add(row.role, self); // a possible duplicate may still be added, so later rows compare against it
    return { kind: "possible", matches: [...candidates].map((e) => e.match) } as const;
  });
}
