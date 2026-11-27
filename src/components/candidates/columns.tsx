/**
 * Column definitions for the ZBM / HOS candidate table.
 * `sort` is the key understood by the search_candidates database function.
 * Screening-question columns are added per role from the questions found in uploads.
 */
import { ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { CandidateRow } from "@/lib/candidates/types";
import { Badge } from "@/components/ui/badge";
import { RESCHEDULED_COLOR, sourceLabel } from "@/lib/candidates/rescheduled";
import { formatInterviewTime } from "@/lib/interview-list/parse";
import { ROLE_COLORS } from "@/lib/brand";

/** Things a cell can do, e.g. open the candidate detail panel. */
export interface CellContext {
  openCandidate: (id: string) => void;
  shortlistedStageId: number | null; // tags only exist in this stage
}

export interface Column {
  key: string;
  label: string;
  title?: string; // full header text on hover (for long screening questions)
  sort?: string;
  defaultVisible: boolean;
  className?: string;
  render: (row: CandidateRow, ctx: CellContext) => React.ReactNode;
}

const text = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? <Dash /> : v);
function Dash() {
  return <span className="text-muted-foreground/60">—</span>;
}

/** Role column, shown in the All tab. */
export const ROLE_COLUMN: Column = {
  key: "role",
  label: "Role",
  sort: "role",
  defaultVisible: true,
  className: "whitespace-nowrap",
  render: (r) => <Badge color={ROLE_COLORS[r.role]}>{r.role}</Badge>,
};

export const BASE_COLUMNS: Column[] = [
  {
    key: "name",
    label: "Name",
    sort: "name",
    defaultVisible: true,
    className: "min-w-44 whitespace-nowrap font-medium",
    render: (r, ctx) => (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          className="text-left font-medium hover:text-primary hover:underline"
          onClick={() => ctx.openCandidate(r.id)}
          title="Open details and history"
        >
          {r.name}
        </button>
        {r.profile_url && (
          <a
            href={r.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Naukri profile"
            onClick={(e) => e.stopPropagation()}
            className="text-primary/70 hover:text-primary"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </span>
    ),
  },
  {
    key: "stage",
    label: "Stage",
    sort: "stage",
    defaultVisible: true,
    render: (r) => <Badge color={r.stage_color}>{r.stage_name}</Badge>,
  },
  {
    key: "tag",
    label: "Tag",
    sort: "tag",
    defaultVisible: true,
    render: (r, ctx) => (r.rescheduled ? <Badge color={RESCHEDULED_COLOR}>Rescheduled</Badge> : r.tag_name ? <Badge color={r.tag_color}>{r.tag_name}</Badge> : r.stage_id === ctx.shortlistedStageId ? <span className="text-xs text-muted-foreground">No tag</span> : r.source && r.source !== "naukri" ? <Badge color="#64748b">{sourceLabel(r.source)}</Badge> : <Dash />),
  },
  {
    key: "interviewer",
    label: "Interviewer",
    sort: "interviewer",
    defaultVisible: true,
    render: (r) => (r.interviewer_name ? <Badge color={r.interviewer_color ?? undefined}>{r.interviewer_name}</Badge> : <Dash />),
  },
  {
    key: "interview_at",
    label: "1:1 date",
    defaultVisible: true,
    className: "whitespace-nowrap",
    render: (r) => (r.interview_at ? formatInterviewTime(r.interview_at) : <Dash />),
  },
  {
    key: "primary_phone",
    label: "Mobile",
    sort: "primary_phone",
    defaultVisible: true,
    className: "font-mono text-xs",
    render: (r) => r.primary_phone ?? <span className="font-sans text-red-600">invalid</span>,
  },
  { key: "alternate_phone", label: "Other phone", defaultVisible: false, className: "font-mono text-xs", render: (r) => text(r.alternate_phone) },
  { key: "email", label: "Email", sort: "email", defaultVisible: true, className: "max-w-56 truncate", render: (r) => text(r.email) },
  { key: "alternate_email", label: "Other email", defaultVisible: false, className: "max-w-56 truncate", render: (r) => text(r.alternate_email) },
  { key: "current_location", label: "Location", sort: "current_location", defaultVisible: true, render: (r) => text(r.current_location) },
  {
    key: "preferred_locations",
    label: "Preferred locations",
    sort: "preferred_locations",
    defaultVisible: false,
    className: "max-w-64 truncate",
    render: (r) => <span title={r.preferred_locations ?? ""}>{text(r.preferred_locations)}</span>,
  },
  { key: "home_town", label: "Home town", sort: "home_town", defaultVisible: false, render: (r) => text(r.home_town) },
  {
    key: "total_exp_months",
    label: "Experience",
    sort: "total_exp_months",
    defaultVisible: true,
    className: "whitespace-nowrap tabular-nums",
    render: (r) => (r.total_exp_months === null ? <Dash /> : `${Math.floor(r.total_exp_months / 12)}y ${r.total_exp_months % 12}m`),
  },
  {
    key: "salary_lakhs",
    label: "Salary (L)",
    sort: "salary_lakhs",
    defaultVisible: true,
    className: "text-right tabular-nums",
    render: (r) => text(r.salary_lakhs),
  },
  { key: "notice_period", label: "Notice", sort: "notice_period", defaultVisible: true, className: "whitespace-nowrap", render: (r) => text(r.notice_period) },
  { key: "current_company", label: "Company", sort: "current_company", defaultVisible: true, className: "max-w-48 truncate", render: (r) => text(r.current_company) },
  { key: "designation", label: "Designation", sort: "designation", defaultVisible: true, className: "max-w-48 truncate", render: (r) => text(r.designation) },
  { key: "gender", label: "Gender", sort: "gender", defaultVisible: false, render: (r) => text(r.gender) },
  { key: "ug_degree", label: "UG degree", sort: "ug_degree", defaultVisible: false, render: (r) => text(r.ug_degree) },
  { key: "pg_degree", label: "PG degree", sort: "pg_degree", defaultVisible: false, render: (r) => text(r.pg_degree) },
  {
    key: "resume_headline",
    label: "Headline",
    sort: "resume_headline",
    defaultVisible: false,
    className: "max-w-80 truncate",
    render: (r) => <span title={r.resume_headline ?? ""}>{text(r.resume_headline)}</span>,
  },
  { key: "dob", label: "Date of birth", sort: "dob", defaultVisible: false, className: "whitespace-nowrap", render: (r) => formatDate(r.dob) },
  { key: "applied_on", label: "Applied", sort: "applied_on", defaultVisible: true, className: "whitespace-nowrap", render: (r) => formatDate(r.applied_on) },
  { key: "created_at", label: "Uploaded", sort: "created_at", defaultVisible: true, className: "whitespace-nowrap", render: (r) => formatDate(r.created_at) },
  {
    key: "stage_changed_at",
    label: "Stage changed",
    sort: "stage_changed_at",
    defaultVisible: false,
    className: "whitespace-nowrap",
    render: (r) => formatDate(r.stage_changed_at),
  },
];

/** "How many years of experience do you have in Sales?" → "Q: Sales (yrs)" style short header. */
export function shortQuestion(q: string): string {
  const exp = q.match(/years of experience .* in (.+?)\??$/i);
  if (exp) return `Exp. in ${exp[1]}`;
  const ctc = q.match(/current ctc/i);
  if (ctc) return "Stated CTC";
  return q.length > 28 ? `${q.slice(0, 28)}…` : q.replace(/\?$/, "");
}

export function screeningColumns(questions: { question: string; is_numeric: boolean }[]): Column[] {
  return questions.map(({ question, is_numeric }) => ({
    key: `q:${question}`,
    label: shortQuestion(question),
    title: question,
    sort: `q:${question}`,
    defaultVisible: true,
    className: is_numeric ? "text-right tabular-nums" : "max-w-48 truncate",
    render: (r: CandidateRow) => text(r.screening?.[question]?.t ?? null),
  }));
}
