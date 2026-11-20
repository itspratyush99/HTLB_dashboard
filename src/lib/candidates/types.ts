/** Shapes used by the ZBM / HOS candidate tabs. */
import type { Role, ScreeningAnswer } from "@/lib/naukri/types";

export type { Role };

/** One row as returned by the search_candidates database function. */
export interface CandidateRow {
  id: string;
  role: Role;
  name: string;
  email: string | null;
  alternate_email: string | null;
  primary_phone: string | null;
  alternate_phone: string | null;
  job_title: string | null;
  applied_on: string | null;
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
  gender: string | null;
  home_town: string | null;
  dob: string | null;
  screening: Record<string, ScreeningAnswer>;
  profile_url: string | null;
  stage_id: number;
  stage_name: string;
  stage_color: string;
  stage_position: number;
  interviewer_id: number | null;
  interviewer_name: string | null;
  interviewer_color: string | null;
  shortlist_tag_id: number | null;
  source?: "naukri" | "test_file"; // test_file = added from a test-results file, details pending Naukri
  rescheduled?: boolean; // 1:1 interview rescheduled (only in 1:1 Aligned)
  rescheduled_at?: string | null;
  tag_name: string | null; // 72h / 48h / 24h / Hold (Shortlisted only)
  tag_color: string | null;
  stage_changed_at: string;
  created_at: string;
  upload_id: string | null;
}

export interface SearchResult {
  total: number;
  role_total: number;
  rows: CandidateRow[];
}

export interface Stage {
  id: number;
  name: string;
  color: string;
  position: number;
  requires_interviewer: boolean;
  is_default?: boolean; // the starting stage (Shortlisted): the only stage with tags
}

/** A Shortlisted tag (72h, 48h, 24h, Hold…). Order = the reminder cycle. */
export interface ShortlistTag {
  id: number;
  name: string;
  color: string;
  position: number;
}

export interface Interviewer {
  id: number;
  name: string;
  color: string;
  is_active: boolean;
}

export interface FilterOptions {
  current_locations: string[];
  home_towns: string[];
  notice_periods: string[];
  genders: string[];
  ug_degrees: string[];
  pg_degrees: string[];
  questions: { question: string; is_numeric: boolean }[];
}
