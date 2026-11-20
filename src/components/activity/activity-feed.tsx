"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, CalendarClock, ChevronDown, ChevronRight, Download, Loader2, Settings, Tag as TagIcon, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/dates";
import type { Interviewer, Stage } from "@/lib/candidates/types";
import { ROLE_COLORS } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CandidateDrawer } from "@/components/candidates/candidate-drawer";
import type { Viewer } from "@/lib/viewer";

type Action = "stage_change" | "interviewer_change" | "tag_change" | "reschedule" | "upload" | "export" | "settings_change" | "candidates_deleted";

interface Group {
  gkey: string;
  action: Action;
  at: string;
  user_name: string | null;
  role: "ZBM" | "HOS" | null;
  candidate_count: number;
  first_candidate_id: string | null;
  details: Record<string, unknown> | null;
  upload_id: string | null;
  bulk_action_id: string | null;
  from_stages: string[];
  to_stages: string[];
  from_interviewers: string[];
  to_interviewers: string[];
  sample_names: string[] | null;
}

interface FeedFilters {
  user_id?: string;
  action?: Action;
  role?: "ZBM" | "HOS";
  from?: string;
  to?: string;
}

const PAGE = 50;
const ACTIONS: [Action, string][] = [
  ["stage_change", "Stage moves"],
  ["interviewer_change", "Interviewer changes"],
  ["tag_change", "Tag changes"],
  ["reschedule", "Rescheduled 1:1s"],
  ["upload", "Uploads"],
  ["export", "Exports"],
  ["settings_change", "Settings changes"],
  ["candidates_deleted", "Deletions"],
];
const plural = (n: number) => `${n.toLocaleString("en-IN")} candidate${n === 1 ? "" : "s"}`;
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** Activity Log: filterable, grouped by bulk action, newest first, with "Load more". */
export function ActivityFeed({ users, stages, interviewers, viewer }: { users: { id: string; full_name: string }[]; stages: Stage[]; interviewers: Interviewer[]; viewer?: Viewer }) {
  const supabase = useMemo(() => createClient(), []);
  const [filters, setFilters] = useState<FeedFilters>({});
  const [rows, setRows] = useState<Group[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (offset: number) => {
      setLoading(true);
      const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data, error } = await supabase.rpc("activity_feed", { p_filters: clean, p_limit: PAGE, p_offset: offset });
      setLoading(false);
      if (error) return toast.error("Couldn't load the Activity Log", { description: error.message });
      const result = data as { rows: Group[]; has_more: boolean };
      setRows((r) => (offset === 0 ? result.rows : [...r, ...result.rows]));
      setHasMore(result.has_more);
    },
    [supabase, filters],
  );

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  const set = <K extends keyof FeedFilters>(k: K, v: FeedFilters[K] | "") => setFilters((f) => ({ ...f, [k]: v || undefined }));

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="glass flex flex-wrap items-end gap-3 rounded-2xl p-3">
        <Select label="User" value={filters.user_id ?? ""} onChange={(v) => set("user_id", v)} options={users.map((u) => [u.id, u.full_name])} />
        <Select label="Action" value={filters.action ?? ""} onChange={(v) => set("action", v as Action)} options={ACTIONS} />
        <Select label="Role" value={filters.role ?? ""} onChange={(v) => set("role", v as "ZBM" | "HOS")} options={[["ZBM", "ZBM"], ["HOS", "HOS"]]} />
        <label className="flex flex-col gap-1 text-xs font-medium">
          From
          <Input type="date" className="h-8 w-40" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          To
          <Input type="date" className="h-8 w-40" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value)} />
        </label>
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>Clear</Button>
        )}
        {loading && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Entries */}
      <div className="glass divide-y divide-black/[0.06] overflow-hidden rounded-2xl">
        {rows.map((g) => (
          <Entry key={`${g.gkey}:${g.action}`} g={g} onOpenCandidate={setDrawerId} />
        ))}
        {!loading && !rows.length && <p className="p-10 text-center text-sm text-muted-foreground">No activity matches these filters.</p>}
      </div>
      {hasMore && (
        <Button variant="outline" className="self-center" onClick={() => fetchPage(rows.length)} disabled={loading}>
          {loading && <Loader2 className="animate-spin" />} Load more
        </Button>
      )}

      {viewer?.interviewerOnly && (
        <p className="-mt-1 text-xs text-muted-foreground">You see your own actions and those about candidates assigned to you.</p>
      )}
      <CandidateDrawer candidateId={drawerId} onClose={() => setDrawerId(null)} stages={stages} interviewers={interviewers} viewer={viewer} onChanged={() => fetchPage(0)} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium">
      {label}
      <select className="h-9 min-w-36 rounded-lg border border-black/10 bg-white/80 px-2 text-sm font-normal" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** One line in the log, expandable for bulk actions and exports. */
function Entry({ g, onOpenCandidate }: { g: Group; onOpenCandidate: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const d = g.details ?? {};
  const who = <b>{g.user_name ?? "System"}</b>;
  const expandable = (g.bulk_action_id && g.candidate_count > 1) || (g.action === "export" && Array.isArray(d.candidate_ids) && d.candidate_ids.length > 0);
  const Icon = { stage_change: ArrowRightLeft, interviewer_change: UserRound, upload: Upload, export: Download, settings_change: Settings, candidates_deleted: Trash2, tag_change: TagIcon, reschedule: CalendarClock }[g.action];

  const singleName =
    g.candidate_count === 1 && g.first_candidate_id ? (
      <button className="font-medium text-primary hover:underline" onClick={() => onOpenCandidate(g.first_candidate_id!)}>
        {g.sample_names?.[0] ?? "candidate"}
      </button>
    ) : (
      <>{plural(g.candidate_count)}</>
    );

  let text: React.ReactNode;
  // Only mention the interviewer when the move actually set a new one (e.g. into 1:1 Aligned).
  const interviewerChanged =
    g.to_interviewers.length > 0 && g.to_interviewers.some((name) => !g.from_interviewers.includes(name));
  if (g.action === "stage_change") {
    const from = g.from_stages.length === 1 ? g.from_stages[0] : `${g.from_stages.length} stages`;
    const to = g.to_stages.join(", ");
    text = (
      <>
        {who} moved {singleName} from <b>{from}</b> to <b>{to}</b>
        {interviewerChanged && <> · interviewer <b>{g.to_interviewers.join(", ")}</b></>}
      </>
    );
  } else if (g.action === "interviewer_change") {
    text = g.to_interviewers.length ? (
      <>{who} set interviewer <b>{g.to_interviewers.join(", ")}</b> for {singleName}</>
    ) : (
      <>{who} removed the interviewer from {singleName}</>
    );
  } else if (g.action === "tag_change") {
    text = (
      <>
        {who} changed the tag of {singleName} from <b>{str(d.from_tag) || "No tag"}</b> to <b>{str(d.to_tag) || "No tag"}</b>
      </>
    );
  } else if (g.action === "reschedule") {
    text = d.rescheduled === false ? (
      <>{who} removed <b>Rescheduled</b> from {singleName}</>
    ) : (
      <>{who} marked the 1:1 of {singleName} as <b>Rescheduled</b></>
    );
  } else if (g.action === "upload" && d.kind === "test_results") {
    text = (
      <>
        {who} uploaded test results{" "}
        {g.upload_id ? <Link className="font-medium text-primary hover:underline" href={`/uploads/${g.upload_id}`}>{str(d.file_name)}</Link> : str(d.file_name)}:{" "}
        <b>{str(d.moved)} moved</b> to {str(d.target_stage)}, {str(d.already_moved)} already moved, {str(d.not_found)} not in the tracker
      </>
    );
  } else if (g.action === "upload") {
    text = (
      <>
        {who} uploaded{" "}
        {g.upload_id ? <Link className="font-medium text-primary hover:underline" href={`/uploads/${g.upload_id}`}>{str(d.file_name)}</Link> : str(d.file_name)}: <b>{str(d.new_added)} new</b>
        {" "}(ZBM {str(d.zbm_added)} · HOS {str(d.hos_added)}), {str(d.duplicates_skipped)} duplicates skipped
        {d.failed ? <span className="text-amber-700"> · stopped part-way</span> : null}
      </>
    );
  } else if (g.action === "export") {
    text = (
      <>
        {who} exported <b>{plural(Number(d.exported ?? 0))}</b> for the bulk sender: <span className="font-mono text-xs">{str(d.file_name)}</span>
        {d.tags && d.tags !== "none" ? <> · Tags: {str(d.tags)}</> : null}
      </>
    );
  } else if (g.action === "candidates_deleted") {
    const names = Array.isArray(d.names) ? (d.names as string[]) : [];
    text = (
      <>
        {who} <span className="font-medium text-destructive">deleted</span> {plural(Number(d.count ?? 0))}
        {names.length > 0 ? <>: {names.slice(0, 5).join(", ")}{names.length > 5 ? ` and ${names.length - 5} more` : ""}</> : d.names_erased ? " (names removed from the log at their request)" : ""}
      </>
    );
  } else {
    const rec = ((d.new ?? d.old) ?? {}) as Record<string, unknown>;
    const what = { stages: "stage", interviewers: "interviewer", role_keywords: "role keyword", app_settings: "setting", profiles: "team user" }[str(d.table)] ?? str(d.table);
    const label = str(rec.name ?? rec.keyword ?? rec.key ?? rec.full_name);
    text = <>{who} {str(d.operation) === "insert" ? "added" : str(d.operation) === "delete" ? "deleted" : "changed"} {what} <b>{label}</b></>;
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border", g.action === "export" && "border-emerald-300 text-emerald-600", g.action === "stage_change" && "border-primary/30 text-primary")}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">{text}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {formatDateTime(g.at)}
            {g.role && <Badge color={ROLE_COLORS[g.role]}>{g.role}</Badge>}
            {expandable && (
              <button className="inline-flex items-center gap-0.5 text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {open ? "Hide" : "Show"} candidates
              </button>
            )}
          </p>
          {open && <GroupCandidates g={g} onOpenCandidate={onOpenCandidate} />}
        </div>
      </div>
    </div>
  );
}

/** The candidates inside one bulk move / export. */
function GroupCandidates({ g, onOpenCandidate }: { g: Group; onOpenCandidate: (id: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<{ id: string; name: string; note: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (g.action === "export") {
        const ids = (g.details?.candidate_ids ?? []) as string[];
        const { data } = await supabase.rpc("candidates_for_export", { p_ids: ids });
        if (!cancelled) setItems(((data ?? []) as { id: string; name: string; stage_name: string }[]).map((c) => ({ id: c.id, name: c.name, note: `now in ${c.stage_name}` })));
      } else {
        const { data } = await supabase
          .from("activity_log")
          .select("id, candidate_id, details")
          .eq("bulk_action_id", g.bulk_action_id!)
          .eq("action", g.action)
          .order("id");
        if (!cancelled)
          setItems(
            ((data ?? []) as { candidate_id: string; details: Record<string, string | null> }[]).map((r) => ({
              id: r.candidate_id,
              name: r.details?.candidate_name ?? "—",
              note:
                g.action === "stage_change"
                  ? `${r.details?.from_stage} → ${r.details?.to_stage}`
                  : g.action === "reschedule"
                    ? (String(r.details?.rescheduled) === "false" ? "Rescheduled removed" : "Rescheduled")
                  : g.action === "tag_change"
                    ? `${r.details?.from_tag ?? "No tag"} → ${r.details?.to_tag ?? "No tag"}`
                    : `${r.details?.from_interviewer ?? "none"} → ${r.details?.to_interviewer ?? "none"}`,
            })),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [g, supabase]);

  if (!items) return <Loader2 className="mt-2 size-4 animate-spin text-muted-foreground" />;
  return (
    <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs">
      {items.map((c) => (
        <li key={c.id} className="flex justify-between gap-3 py-0.5">
          <button className="text-left text-primary hover:underline" onClick={() => onOpenCandidate(c.id)}>{c.name}</button>
          <span className="text-muted-foreground">{c.note}</span>
        </li>
      ))}
    </ul>
  );
}
