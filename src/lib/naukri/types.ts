/** Shared types for the Naukri import pipeline: read → parse/clean → detect role → de-duplicate → import. */

export type Role = "ZBM" | "HOS";
export const ROLES: Role[] = ["ZBM", "HOS"];

/** One screening answer: original text + the leading number if there is one ("9.5 years" → 9.5). */
export type ScreeningAnswer = { t: string | null; n: number | null };

/** A cleaned candidate, shaped exactly like the `candidates` table (minus server-set columns). */
export interface CandidateInput {
  role: Role | null; // null = could not be detected (shown as "Unassigned" in the preview)
  job_title: string | null;
  applied_on: string | null; // YYYY-MM-DD
  name: string;
  email: string | null; // first valid email in the cell
  alternate_email: string | null; // any other emails in the same cell
  phone_raw: string | null;
  primary_phone: string | null; // 10 digits
  alternate_phone: string | null;
  current_location: string | null;
  preferred_locations: string | null;
  total_exp_text: string | null;
  total_exp_months: number | null;
  current_company: string | null;
  designation: string | null;
  salary_text: string | null;
  salary_lakhs: number | null;
  notice_period: string | null;
  resume_headline: string | null;
  ug_degree: string | null;
  ug_specialization: string | null;
  ug_institute: string | null;
  pg_degree: string | null;
  pg_specialization: string | null;
  pg_institute: string | null;
  doctorate: { degree: string | null; specialization: string | null; institute: string | null } | null;
  gender: string | null;
  home_town: string | null;
  dob: string | null; // YYYY-MM-DD
  naukri_pipeline_stage: string | null;
  naukri_comments: Record<string, string> | null;
  screening: Record<string, ScreeningAnswer>;
  profile_url: string | null;
  raw: Record<string, string | null>;
  name_norm: string;
  email_norm: string | null;
}

export interface ParsedRow {
  rowNumber: number; // row number as seen in Excel (header = row 1)
  candidate: CandidateInput;
  roleProblem: "none" | "ambiguous" | null; // why role is null, if it is
  warnings: string[]; // imported, but worth knowing (e.g. no valid mobile → excluded from exports)
}

export interface RowError {
  rowNumber: number;
  name: string | null;
  message: string; // these rows are NOT imported
}

export interface ScreeningQuestion {
  question: string;
  is_numeric: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
  questions: ScreeningQuestion[];
  totalRows: number; // non-empty data rows in the file
  emptyRowsSkipped: number;
  missingColumns: string[]; // required columns not found → the whole file is rejected
  unknownColumns: string[]; // columns we don't map (still kept in `raw`)
}
