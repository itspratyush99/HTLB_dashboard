/**
 * Combines the parsed file, the duplicate matches and the user's choices in the preview
 * into one "plan": what gets imported, what gets skipped, and the counts for Upload History.
 * Pure function: re-run it whenever the user changes a decision.
 */
import { classifyRows, type Classification, type ExistingCandidate } from "./dedupe";
import type { FlaggedRecord, ImportRequest, NoteRecord, UnassignedRecord } from "./import";
import type { ParseResult, ParsedRow, Role } from "./types";

export type RoleDecision = Role | "skip";
export type FlagDecision = "skip" | "add";

export interface PlannedRow {
  parsed: ParsedRow;
  role: Role | null; // detected role, or the user's choice for an unassigned row; null = skipped
  classification: Classification | null; // null when the row has no role
}

export interface Plan {
  rows: PlannedRow[];
  newRows: PlannedRow[];
  exactRows: PlannedRow[];
  possibleRows: PlannedRow[];
  completeRows: PlannedRow[]; // fill in details of people added from a test file
  unassignedRows: PlannedRow[]; // role could not be detected (whatever the user chose)
  toImport: PlannedRow[];
  counts: {
    total: number;
    zbm: number;
    hos: number;
    importZbm: number;
    importHos: number;
    errors: number;
    possibleAdd: number;
    possibleSkip: number;
    unassignedSkipped: number;
  };
}

export function buildPlan(
  parse: ParseResult,
  existing: ExistingCandidate[],
  roleDecisions: Record<number, RoleDecision>,
  flagDecisions: Record<number, FlagDecision>,
): Plan {
  const withRole = parse.rows.map((parsed) => {
    const chosen = parsed.candidate.role ?? roleDecisions[parsed.rowNumber] ?? "skip";
    return { parsed, role: chosen === "skip" ? null : chosen };
  });

  const assigned = withRole.filter((r) => r.role !== null);
  const classifications = classifyRows(
    assigned.map(({ parsed, role }) => ({
      role: role!,
      name: parsed.candidate.name,
      name_norm: parsed.candidate.name_norm,
      email_norm: parsed.candidate.email_norm,
      primary_phone: parsed.candidate.primary_phone,
      rowNumber: parsed.rowNumber,
    })),
    existing,
  );
  const byRow = new Map(assigned.map((r, i) => [r.parsed.rowNumber, classifications[i]]));
  const rows: PlannedRow[] = withRole.map((r) => ({ ...r, classification: byRow.get(r.parsed.rowNumber) ?? null }));

  const newRows = rows.filter((r) => r.classification?.kind === "new");
  const exactRows = rows.filter((r) => r.classification?.kind === "exact");
  const possibleRows = rows.filter((r) => r.classification?.kind === "possible");
  const completeRows = rows.filter((r) => r.classification?.kind === "complete");
  const unassignedRows = rows.filter((r) => r.parsed.candidate.role === null);
  const decision = (r: PlannedRow) => flagDecisions[r.parsed.rowNumber] ?? "skip";
  const toImport = [...newRows, ...possibleRows.filter((r) => decision(r) === "add")].sort(
    (a, b) => a.parsed.rowNumber - b.parsed.rowNumber,
  );

  return {
    rows,
    newRows,
    exactRows,
    possibleRows,
    completeRows,
    unassignedRows,
    toImport,
    counts: {
      total: parse.totalRows,
      zbm: rows.filter((r) => r.role === "ZBM").length,
      hos: rows.filter((r) => r.role === "HOS").length,
      importZbm: toImport.filter((r) => r.role === "ZBM").length,
      importHos: toImport.filter((r) => r.role === "HOS").length,
      errors: parse.errors.length,
      possibleAdd: possibleRows.filter((r) => decision(r) === "add").length,
      possibleSkip: possibleRows.filter((r) => decision(r) === "skip").length,
      unassignedSkipped: unassignedRows.filter((r) => r.role === null).length,
    },
  };
}

export function toImportRequest(
  plan: Plan,
  parse: ParseResult,
  file: { name: string; size: number },
  flagDecisions: Record<number, FlagDecision>,
): ImportRequest {
  const flagged: FlaggedRecord[] = plan.possibleRows.map((r) => {
    const c = r.parsed.candidate;
    const matches = r.classification?.kind === "possible" ? r.classification.matches : [];
    return {
      row: r.parsed.rowNumber,
      name: c.name,
      phone: c.primary_phone,
      email: c.email,
      role: r.role!,
      matched: matches.map((m) =>
        m.source === "database"
          ? { id: m.id, name: m.name, stage: m.stage_name, from_file_row: null }
          : { id: null, name: m.name, stage: null, from_file_row: m.rowNumber },
      ),
      decision: flagDecisions[r.parsed.rowNumber] ?? "skip",
    };
  });
  const unassigned: UnassignedRecord[] = plan.unassignedRows.map((r) => ({
    row: r.parsed.rowNumber,
    name: r.parsed.candidate.name,
    job_title: r.parsed.candidate.job_title,
    decision: r.role ?? "skip",
  }));
  const warnings: NoteRecord[] = plan.toImport.flatMap((r) =>
    r.parsed.warnings.map((message) => ({ row: r.parsed.rowNumber, name: r.parsed.candidate.name, message })),
  );

  return {
    fileName: file.name,
    fileSize: file.size,
    candidates: plan.toImport.map((r) => ({ ...r.parsed.candidate, role: r.role!, rowNumber: r.parsed.rowNumber })),
    complete: plan.completeRows.map((r) => ({
      id: r.classification?.kind === "complete" ? r.classification.candidate.id : "",
      stage: r.classification?.kind === "complete" ? r.classification.candidate.stage_name : null,
      row: r.parsed.rowNumber,
      candidate: { ...r.parsed.candidate, role: r.role! },
    })),
    questions: parse.questions,
    counts: {
      total_rows: plan.counts.total,
      zbm_rows: plan.counts.zbm,
      hos_rows: plan.counts.hos,
      duplicates_skipped: plan.exactRows.length,
      flagged_count: plan.possibleRows.length,
      flagged_added: plan.counts.possibleAdd,
      flagged_skipped: plan.counts.possibleSkip,
      unassigned_count: plan.unassignedRows.length,
    },
    flagged,
    unassigned,
    errors: parse.errors,
    warnings,
  };
}
