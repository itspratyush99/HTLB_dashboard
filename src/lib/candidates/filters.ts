/**
 * Candidate filters. The same object is sent to the database (search_candidates / candidate_ids)
 * and stored in the page URL (?f=...), so a filtered view can be bookmarked or linked to
 * (Analytics' "stuck candidates" uses this in Phase 5).
 */
import { formatDate } from "@/lib/dates";
import type { Interviewer, Stage } from "./types";

export interface ScreeningFilter {
  min?: number;
  max?: number;
  text?: string;
}

export interface Filters {
  q?: string;
  stage_ids?: number[];
  interviewer_ids?: string[]; // interviewer ids as text, or "none"
  created_from?: string; // YYYY-MM-DD (IST)
  created_to?: string;
  applied_from?: string;
  applied_to?: string;
  stage_changed_from?: string;
  stage_changed_to?: string;
  current_locations?: string[];
  home_towns?: string[];
  preferred_location?: string;
  exp_min?: number; // years
  exp_max?: number;
  salary_min?: number; // lakhs
  salary_max?: number;
  notice_periods?: string[];
  genders?: string[];
  ug_degrees?: string[];
  pg_degrees?: string[];
  company?: string;
  designation?: string;
  phone_status?: "valid" | "invalid";
  upload_id?: string;
  screening?: Record<string, ScreeningFilter>;
}

const isBlank = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "number" && Number.isNaN(v));

/** Remove empty values so the URL and the database only see real filters. */
export function cleanFilters(f: Filters): Filters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === "screening" && v && typeof v === "object") {
      const s: Record<string, ScreeningFilter> = {};
      for (const [q, cond] of Object.entries(v as Record<string, ScreeningFilter>)) {
        const c = Object.fromEntries(
          Object.entries(cond)
            .map(([key, x]) => [key, typeof x === "string" ? x.trim() : x])
            .filter(([, x]) => !isBlank(x)),
        );
        if (Object.keys(c).length) s[q] = c;
      }
      if (Object.keys(s).length) out.screening = s;
    } else {
      const value = typeof v === "string" ? v.trim() : v;
      if (!isBlank(value)) out[k] = value;
    }
  }
  return out as Filters;
}

export function encodeFilters(f: Filters): string {
  const clean = cleanFilters(f);
  return Object.keys(clean).length ? JSON.stringify(clean) : "";
}

export function decodeFilters(value: string | null): Filters {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? cleanFilters(parsed as Filters) : {};
  } catch {
    return {};
  }
}

export interface FilterChip {
  key: string; // used to remove it
  label: string;
}

const list = (items: string[], max = 3) =>
  items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} +${items.length - max}`;
const range = (min?: number, max?: number, unit = "") =>
  min !== undefined && max !== undefined ? `${min}–${max}${unit}` : min !== undefined ? `≥ ${min}${unit}` : `≤ ${max}${unit}`;
const dateRange = (from?: string, to?: string) =>
  from && to ? `${formatDate(from)} – ${formatDate(to)}` : from ? `from ${formatDate(from)}` : `until ${formatDate(to)}`;

/** Human-readable chips for the active filters (excluding the search box). */
export function describeFilters(f: Filters, stages: Stage[], interviewers: Interviewer[]): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.stage_ids?.length)
    chips.push({ key: "stage_ids", label: `Stage: ${list(f.stage_ids.map((id) => stages.find((s) => s.id === id)?.name ?? "?"))}` });
  if (f.interviewer_ids?.length)
    chips.push({
      key: "interviewer_ids",
      label: `Interviewer: ${list(f.interviewer_ids.map((id) => (id === "none" ? "None" : interviewers.find((i) => String(i.id) === id)?.name ?? "?")))}`,
    });
  if (f.created_from || f.created_to) chips.push({ key: "created", label: `Uploaded ${dateRange(f.created_from, f.created_to)}` });
  if (f.applied_from || f.applied_to) chips.push({ key: "applied", label: `Applied ${dateRange(f.applied_from, f.applied_to)}` });
  if (f.stage_changed_from || f.stage_changed_to)
    chips.push({ key: "stage_changed", label: `Stage changed ${dateRange(f.stage_changed_from, f.stage_changed_to)}` });
  if (f.current_locations?.length) chips.push({ key: "current_locations", label: `Location: ${list(f.current_locations)}` });
  if (f.preferred_location) chips.push({ key: "preferred_location", label: `Prefers: "${f.preferred_location}"` });
  if (f.home_towns?.length) chips.push({ key: "home_towns", label: `Home town: ${list(f.home_towns)}` });
  if (f.exp_min !== undefined || f.exp_max !== undefined) chips.push({ key: "exp", label: `Experience ${range(f.exp_min, f.exp_max, " yrs")}` });
  if (f.salary_min !== undefined || f.salary_max !== undefined) chips.push({ key: "salary", label: `Salary ${range(f.salary_min, f.salary_max, " L")}` });
  if (f.notice_periods?.length) chips.push({ key: "notice_periods", label: `Notice: ${list(f.notice_periods)}` });
  if (f.company) chips.push({ key: "company", label: `Company: "${f.company}"` });
  if (f.designation) chips.push({ key: "designation", label: `Designation: "${f.designation}"` });
  if (f.genders?.length) chips.push({ key: "genders", label: `Gender: ${list(f.genders)}` });
  if (f.ug_degrees?.length) chips.push({ key: "ug_degrees", label: `UG: ${list(f.ug_degrees)}` });
  if (f.pg_degrees?.length) chips.push({ key: "pg_degrees", label: `PG: ${list(f.pg_degrees)}` });
  if (f.phone_status) chips.push({ key: "phone_status", label: f.phone_status === "valid" ? "Valid mobile" : "No valid mobile" });
  if (f.upload_id) chips.push({ key: "upload_id", label: "From one upload" });
  for (const [q, c] of Object.entries(f.screening ?? {})) {
    const short = q.length > 40 ? `${q.slice(0, 40)}…` : q;
    const parts = [c.min !== undefined || c.max !== undefined ? range(c.min, c.max) : "", c.text ? `"${c.text}"` : ""].filter(Boolean);
    chips.push({ key: `screening:${q}`, label: `${short} ${parts.join(" ")}` });
  }
  return chips;
}

/** Removes one chip's filter. */
export function removeFilter(f: Filters, key: string): Filters {
  const next: Filters = { ...f };
  const drop = (...keys: (keyof Filters)[]) => keys.forEach((k) => delete next[k]);
  if (key.startsWith("screening:")) {
    const s = { ...(f.screening ?? {}) };
    delete s[key.slice("screening:".length)];
    next.screening = s;
  } else if (key === "created") drop("created_from", "created_to");
  else if (key === "applied") drop("applied_from", "applied_to");
  else if (key === "stage_changed") drop("stage_changed_from", "stage_changed_to");
  else if (key === "exp") drop("exp_min", "exp_max");
  else if (key === "salary") drop("salary_min", "salary_max");
  else drop(key as keyof Filters);
  return cleanFilters(next);
}
