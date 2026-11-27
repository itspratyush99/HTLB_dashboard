"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  UserPlus,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  ExternalLink,
  Filter,
  Loader2,
  Search,
  Tag as TagIcon,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cleanFilters, decodeFilters, describeFilters, encodeFilters, removeFilter, type Filters } from "@/lib/candidates/filters";
import { roleParam, type CandidateRow, type FilterOptions, type Interviewer, type RoleScope, type SearchResult, type ShortlistTag, type Stage } from "@/lib/candidates/types";
import { ROLE_COLORS } from "@/lib/brand";
import { RESCHEDULED_COLOR, sourceLabel } from "@/lib/candidates/rescheduled";
import { formatInterviewTime } from "@/lib/interview-list/parse";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CandidateDrawer } from "./candidate-drawer";
import { BASE_COLUMNS, ROLE_COLUMN, screeningColumns, type CellContext, type Column } from "./columns";
import { ExportDialog } from "./export-dialog";
import { AddCandidateDialog } from "./add-candidate-dialog";
import { FilterPanel } from "./filter-panel";
import { DeleteDialog } from "./delete-dialog";
import { TagDialog } from "./tag-dialog";
import { InterviewerDialog, MoveDialog } from "./move-dialog";
import type { Viewer } from "@/lib/viewer";

const PAGE_SIZES = [25, 50, 100, 200];
const ROLE_NAMES: Record<RoleScope, string> = { ZBM: "Zonal Business Manager", HOS: "Head of States", ALL: "ZBM + HOS" };
const roleLabel = (r: RoleScope) => (r === "ALL" ? "All" : r);

interface Props {
  role: RoleScope;
  viewer: Viewer;
  tags: ShortlistTag[];
  stages: Stage[];
  interviewers: Interviewer[];
  options: FilterOptions;
}

/**
 * The ZBM / HOS candidate table: search, filters, sorting, column picker,
 * row selection (including "select all filtered results") and the bulk-sender export.
 * Filtering, sorting and paging happen in the database, so it stays fast with thousands of candidates.
 */
export function RoleTab({ role, viewer, tags, stages, interviewers, options }: Props) {
  const shortlistedStageId = stages.find((s) => s.is_default)?.id ?? null;
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  // ---- view state (mirrored in the URL so it survives refresh and can be linked to)
  const [filters, setFilters] = useState<Filters>(() => decodeFilters(searchParams.get("f")));
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "created_at");
  const [desc, setDesc] = useState(() => (searchParams.get("dir") ?? "desc") === "desc");
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get("page")) || 1));
  const [pageSize, setPageSize] = useState(() => (PAGE_SIZES.includes(Number(searchParams.get("size"))) ? Number(searchParams.get("size")) : 50));
  const [searchText, setSearchText] = useState(filters.q ?? "");

  // ---- data
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // ---- selection (ids), kept across pages, filter changes and exports
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);

  // ---- dialogs
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Move dialog: which candidates, and whether they came from the selection or an export.
  const [move, setMove] = useState<{ ids: string[]; heading: string; source: "selection" | "export" } | null>(null);
  const [interviewerOpen, setInterviewerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const cellContext = useMemo<CellContext>(() => ({ openCandidate: setDrawerId, shortlistedStageId }), [shortlistedStageId]);
  // Tag dialog: which candidates, the suggested tag, and the title.
  const [tagDialog, setTagDialog] = useState<{ ids: string[]; suggested?: number | "none" | null; heading?: string } | null>(null);
  const [tagCounts, setTagCounts] = useState<{ total: number; none: number; tags: (ShortlistTag & { count: number })[] } | null>(null);
  const [reschedCounts, setReschedCounts] = useState<ReschedCount[]>([]);
  const [reschedSaving, setReschedSaving] = useState(false);

  // ---- columns (visibility remembered per role in this browser)
  const columns = useMemo<Column[]>(() => {
    const [name, stage, interviewer, ...rest] = BASE_COLUMNS;
    const createdIdx = rest.findIndex((c) => c.key === "applied_on");
    // The All tab also shows which role each candidate applied for.
    const roleCol: Column[] = role === "ALL" ? [ROLE_COLUMN] : [];
    return [name, ...roleCol, stage, interviewer, ...rest.slice(0, createdIdx), ...screeningColumns(options.questions), ...rest.slice(createdIdx)];
  }, [options.questions, role]);
  const storageKey = `ct.columns.${role}`;
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => !c.defaultVisible).map((c) => c.key)));
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setHidden(new Set(JSON.parse(saved) as string[]));
    } catch {
      /* storage unavailable: use defaults */
    }
  }, [storageKey]);
  const setColumnVisible = (key: string, visible: boolean) => {
    setHidden((h) => {
      const next = new Set(h);
      if (visible) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const visibleColumns = columns.filter((c) => !hidden.has(c.key));

  // ---- debounce the search box into the filters
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q ?? "") === searchText.trim() ? f : cleanFilters({ ...f, q: searchText }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchText]);

  // ---- keep the URL in sync (no page reload)
  useEffect(() => {
    const params = new URLSearchParams();
    const f = encodeFilters(filters);
    if (f) params.set("f", f);
    if (sort !== "created_at") params.set("sort", sort);
    if (!desc) params.set("dir", "asc");
    if (page > 1) params.set("page", String(page));
    if (pageSize !== 50) params.set("size", String(pageSize));
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters, sort, desc, page, pageSize]);

  // ---- load the current page
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    // Candidates, tag counts and Rescheduled counts load at the same time.
    const [{ data, error }, counts, rc] = await Promise.all([
      supabase.rpc("search_candidates", {
        p_role: roleParam(role),
        p_filters: cleanFilters(filters),
        p_sort: sort,
        p_desc: desc,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      }),
      viewer.interviewerOnly ? Promise.resolve(null) : supabase.rpc("shortlist_tag_counts", { p_role: roleParam(role) }),
      supabase.rpc("rescheduled_counts", { p_role: roleParam(role) }),
    ]);
    if (id !== requestId.current) return; // a newer request has started
    setLoading(false);
    if (error) {
      setError(error.message);
      toast.error("Couldn't load candidates", { description: error.message });
      return;
    }
    setError(null);
    setResult(data as SearchResult);
    if (counts && !counts.error) setTagCounts(counts.data as typeof tagCounts);
    if (!rc.error) setReschedCounts((rc.data as ReschedCount[]) ?? []);
  }, [supabase, role, filters, sort, desc, page, pageSize, viewer.interviewerOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // If filters shrink the result below the current page, go back to the last page.
  useEffect(() => {
    if (result && page > 1 && (page - 1) * pageSize >= result.total) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
  }, [result, page, pageSize]);

  // ---- actions
  const applyFilters = (f: Filters) => {
    setFilters(cleanFilters({ ...f, q: searchText }));
    setPage(1);
  };
  const toggleSort = (key: string) => {
    if (sort === key) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(false);
    }
    setPage(1);
  };

  const rows = result?.rows ?? [];
  const pageIds = rows.map((r) => r.id);
  const pageSelectedCount = pageIds.filter((id) => selected.has(id)).length;
  const headerState = pageSelectedCount === 0 ? false : pageSelectedCount === pageIds.length ? true : "indeterminate";

  const togglePage = (on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      pageIds.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const toggleRow = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function markRescheduled(value: boolean) {
    setReschedSaving(true);
    const { data, error } = await supabase.rpc("set_rescheduled", { p_ids: [...selected], p_value: value });
    setReschedSaving(false);
    if (error) {
      toast.error("Couldn't save", { description: error.message });
      return;
    }
    const r = data as { changed: number; unchanged: number; not_in_stage: number };
    const stageName = reschedCounts.map((c) => c.stage_name).join(" / ") || "1:1 Aligned";
    const extra = [
      r.unchanged ? `${r.unchanged} already ${value ? "rescheduled" : "not rescheduled"}` : null,
      r.not_in_stage ? `${r.not_in_stage} skipped (not in ${stageName})` : null,
    ].filter(Boolean).join(" · ");
    toast.success(value ? `${r.changed} marked Rescheduled` : `Rescheduled removed from ${r.changed}`, { description: extra || undefined });
    load();
  }

  async function selectAllFiltered() {
    setSelectingAll(true);
    const { data, error } = await supabase.rpc("candidate_ids", { p_role: roleParam(role), p_filters: cleanFilters(filters) });
    setSelectingAll(false);
    if (error) return toast.error("Couldn't select all", { description: error.message });
    setSelected((s) => new Set([...s, ...((data as string[]) ?? [])]));
  }

  const chips = describeFilters(filters, stages, interviewers, tags);
  const total = result?.total ?? 0;
  const roleTotal = result?.role_total ?? 0;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allFilteredSelected = total > 0 && selected.size >= total && rows.every((r) => selected.has(r.id));

  return (
    <div className="flex flex-col gap-3">
      {/* Title row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[32px] sm:leading-tight">{roleLabel(role)} candidates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ROLE_NAMES[role]} ·{" "}
            {result ? (
              <>Showing <b className="text-foreground">{total.toLocaleString("en-IN")}</b> of {roleTotal.toLocaleString("en-IN")} candidates</>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        {!viewer.interviewerOnly && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus /> Add candidate
            </Button>
            <Button asChild variant="outline">
              <Link href="/uploads/new"><Upload /> Upload Naukri file</Link>
            </Button>
          </div>
        )}
      </div>

      {viewer.interviewerOnly && (
        <div className="rounded-2xl border border-gold/40 bg-gold-soft/80 px-4 py-2.5 text-sm backdrop-blur-xl">
          You&apos;re seeing only the candidates assigned to you as interviewer
          {viewer.interviewerName ? <> (<b>{viewer.interviewerName}</b>)</> : null}. An admin decides who interviews whom.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8 pr-8"
            placeholder="Search name, email, phone, company, headline"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <button className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setSearchText("")} aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button variant="outline" onClick={() => setFiltersOpen(true)}>
          <Filter /> Filters
          {chips.length > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{chips.length}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline"><Columns3 /> Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[70vh] overflow-y-auto">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Show columns</DropdownMenuLabel>
            {columns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={!hidden.has(c.key)}
                disabled={c.key === "name"}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(v) => setColumnVisible(c.key, v === true)}
              >
                <span title={c.title}>{c.label}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                const defaults = columns.filter((c) => !c.defaultVisible).map((c) => c.key);
                setHidden(new Set(defaults));
                try {
                  localStorage.removeItem(storageKey);
                } catch {
                  /* ignore */
                }
              }}
            >
              Reset to default
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Quick tag buttons for the daily reminder routine (Shortlisted only) */}
      {!viewer.interviewerOnly && shortlistedStageId !== null && tagCounts && (
        <ShortlistBar
          counts={tagCounts}
          filters={filters}
          shortlistedStageId={shortlistedStageId}
          stageName={stages.find((s) => s.id === shortlistedStageId)?.name ?? "Shortlisted"}
          onPick={(tagKey) => {
            setSelected(new Set()); // start clean so groups are never mixed by accident
            setFilters(cleanFilters({ q: searchText, stage_ids: [shortlistedStageId], tag_ids: tagKey ? [tagKey] : undefined }));
            setPage(1);
          }}
          onSelectAll={selectAllFiltered}
          selectingAll={selectingAll}
          totalShown={total}
          allSelected={allFilteredSelected}
        />
      )}

      {/* Quick buttons for 1:1 Aligned: everyone (interviewers too) can mark rescheduled interviews */}
      {reschedCounts.map((rc) => (
        <ReschedBar
          key={rc.stage_id}
          counts={rc}
          filters={filters}
          onPick={(value) => {
            setSelected(new Set());
            setFilters(cleanFilters({ q: searchText, stage_ids: [rc.stage_id], rescheduled: value }));
            setPage(1);
          }}
          onSelectAll={selectAllFiltered}
          selectingAll={selectingAll}
          totalShown={total}
          allSelected={allFilteredSelected}
        />
      ))}

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white/80 py-0.5 pl-2.5 pr-1 text-xs">
              {c.label}
              <button
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  setFilters((f) => removeFilter(f, c.key));
                  setPage(1);
                }}
                aria-label={`Remove filter ${c.label}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button
            className="ml-1 text-xs text-primary hover:underline"
            onClick={() => {
              setFilters(cleanFilters({ q: searchText }));
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-gold/40 bg-gold-soft/90 px-4 py-2.5 text-sm shadow-sm backdrop-blur-xl">
          <span>
            <b>{selected.size.toLocaleString("en-IN")}</b> selected
          </span>
          {!allFilteredSelected && total > pageSelectedCount && (
            <button className="text-primary hover:underline disabled:opacity-50" onClick={selectAllFiltered} disabled={selectingAll}>
              {selectingAll ? "Selecting…" : `Select all ${total.toLocaleString("en-IN")} matching the filters`}
            </button>
          )}
          <button className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMove({ ids: [...selected], heading: "Move to stage", source: "selection" })}
            >
              <ArrowRightLeft /> Move to stage…
            </Button>
            {reschedCounts.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={reschedSaving}>
                    {reschedSaving ? <Loader2 className="animate-spin" /> : <CalendarClock />} Rescheduled…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    1:1 interview of the {selected.size} selected
                  </DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => void markRescheduled(true)}>
                    <CalendarClock /> Mark as Rescheduled
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void markRescheduled(false)}>
                    <X /> Remove Rescheduled
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!viewer.interviewerOnly && (
              <Button size="sm" variant="outline" onClick={() => setTagDialog({ ids: [...selected] })}>
                <TagIcon /> Tag…
              </Button>
            )}
            {!viewer.interviewerOnly && (
              <Button size="sm" variant="outline" onClick={() => setInterviewerOpen(true)}>
                <Users /> Interviewer…
              </Button>
            )}
            {viewer.isAdmin && (
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete…
              </Button>
            )}
            <Button size="sm" onClick={() => setExportOpen(true)}>
              <Download /> Export for Bulk Sender
            </Button>
          </div>
        </div>
      )}

      {/* Phones: one card per candidate */}
      <div className={cn("flex flex-col gap-2 md:hidden", loading && result && "opacity-70")}>
        {rows.length > 0 && (
          <label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Checkbox checked={headerState} onCheckedChange={(v) => togglePage(v === true)} aria-label="Select this page" />
            Select this page
          </label>
        )}
        {rows.map((r) => (
          <MobileCard key={r.id} row={r} showRole={role === "ALL"} selected={selected.has(r.id)} onToggle={(on) => toggleRow(r.id, on)} onOpen={() => setDrawerId(r.id)} />
        ))}
        {!loading && !rows.length && (
          <p className="glass rounded-2xl px-4 py-10 text-center text-sm text-muted-foreground">
            {error ? `Couldn't load: ${error}` : roleTotal === 0 ? `No ${role === "ALL" ? "" : `${role} `}candidates yet.` : "No candidates match these filters."}
          </p>
        )}
      </div>

      {/* Table (tablet and desktop) */}
      <div className={cn("glass relative hidden overflow-hidden rounded-2xl md:block", loading && result && "opacity-70")}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/[0.025]">
              <tr className="border-b">
                <th className="sticky left-0 z-10 w-10 bg-[#f7f7f4] px-3">
                  <Checkbox checked={headerState} onCheckedChange={(v) => togglePage(v === true)} aria-label="Select this page" disabled={!rows.length} />
                </th>
                {visibleColumns.map((c) => (
                  <th key={c.key} className="h-10 whitespace-nowrap px-3 text-left text-xs font-medium text-muted-foreground" title={c.title}>
                    {c.sort ? (
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.sort!)}>
                        {c.label}
                        {sort === c.sort ? (desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />) : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.id} row={r} columns={visibleColumns} ctx={cellContext} selected={selected.has(r.id)} onToggle={(on) => toggleRow(r.id, on)} />
              ))}
              {!loading && !rows.length && (
                <tr>
                  <td colSpan={visibleColumns.length + 1} className="px-3 py-16 text-center text-muted-foreground">
                    {error
                      ? `Couldn't load: ${error}`
                      : roleTotal === 0
                        ? <>No {role === "ALL" ? "" : `${role} `}candidates yet. <Link className="text-primary hover:underline" href="/uploads/new">Upload a Naukri file</Link> to add some.</>
                        : "No candidates match these filters."}
                  </td>
                </tr>
              )}
              {loading && !result && (
                <tr>
                  <td colSpan={visibleColumns.length + 1} className="px-3 py-16 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <span className="hidden sm:inline">Rows per page</span>
              <select
                className="h-8 rounded-lg border border-black/10 bg-white/80 px-2 text-foreground"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft /> <span className="hidden sm:inline">Previous</span>
            </Button>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">{page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              <span className="hidden sm:inline">Next</span> <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <FilterPanel
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={applyFilters}
        stages={stages}
        interviewers={interviewers}
        options={options}
        tags={viewer.interviewerOnly ? [] : tags}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        role={role}
        selectedIds={[...selected]}
        filters={filters}
        stages={stages}
        tags={tags}
        shortlistedStageId={shortlistedStageId}
        canTag={!viewer.interviewerOnly}
        onTagExported={(ids, suggested, heading) => {
          setExportOpen(false);
          setTagDialog({ ids, suggested, heading });
        }}
        onMoveExported={(ids) => {
          setExportOpen(false);
          setMove({ ids, heading: `Move the ${ids.length} exported candidate${ids.length === 1 ? "" : "s"}`, source: "export" });
        }}
      />
      <MoveDialog
        open={!!move}
        onOpenChange={(o) => !o && setMove(null)}
        ids={move?.ids ?? []}
        heading={move?.heading}
        viewer={viewer}
        stages={stages}
        interviewers={interviewers}
        onMoved={(result) => {
          // Moved candidates usually leave the current stage filter, so start a fresh selection.
          if (result.changed) {
            const movedIds = new Set(move?.ids ?? []);
            setSelected((s) => new Set([...s].filter((id) => !movedIds.has(id))));
          }
          load();
        }}
      />
      <InterviewerDialog open={interviewerOpen} onOpenChange={setInterviewerOpen} ids={[...selected]} interviewers={interviewers} onChanged={load} />
      {!viewer.interviewerOnly && (
        <AddCandidateDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          role={role}
          stages={stages}
          interviewers={interviewers}
          tags={tags}
          onAdded={(id) => {
            load();
            setDrawerId(id);
          }}
        />
      )}
      <TagDialog
        open={!!tagDialog}
        onOpenChange={(o) => !o && setTagDialog(null)}
        ids={tagDialog?.ids ?? []}
        suggested={tagDialog?.suggested}
        heading={tagDialog?.heading}
        tags={tags}
        shortlistedStageId={shortlistedStageId}
        onChanged={() => {
          // The tagged candidates leave the current tag group: start a fresh selection.
          const done = new Set(tagDialog?.ids ?? []);
          setSelected((s) => new Set([...s].filter((id) => !done.has(id))));
          load();
        }}
      />
      <CandidateDrawer candidateId={drawerId} onClose={() => setDrawerId(null)} stages={stages} interviewers={interviewers} viewer={viewer} onChanged={load} />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        ids={[...selected]}
        onDeleted={(gone) => {
          const g = new Set(gone);
          setSelected((s) => new Set([...s].filter((id) => !g.has(id))));
          load();
        }}
      />
    </div>
  );
}

function TableRow({
  row,
  columns,
  ctx,
  selected,
  onToggle,
}: {
  row: CandidateRow;
  columns: Column[];
  ctx: CellContext;
  selected: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <tr
      className={cn("border-b last:border-0 hover:bg-muted/40", selected && "bg-gold-soft/80 hover:bg-gold-soft")}
      onClick={(e) => {
        // Clicking anywhere on a row (except links) toggles it, like a mail inbox.
        if ((e.target as HTMLElement).closest("a,button")) return;
        onToggle(!selected);
      }}
    >
      <td className={cn("sticky left-0 z-10 px-3", selected ? "bg-gold-soft" : "bg-white/90")}>
        <Checkbox checked={selected} onCheckedChange={(v) => onToggle(v === true)} aria-label={`Select ${row.name}`} />
      </td>
      {columns.map((c) => (
        <td key={c.key} className={cn("px-3 py-2", c.className)}>
          {c.render(row, ctx)}
        </td>
      ))}
    </tr>
  );
}

/** Phone layout of one candidate: tap the card to select, tap the name to open details. */
function MobileCard({ row: r, showRole, selected, onToggle, onOpen }: { row: CandidateRow; showRole?: boolean; selected: boolean; onToggle: (on: boolean) => void; onOpen: () => void }) {
  return (
    <div
      className={cn("glass flex gap-3 rounded-2xl p-3 transition-colors", selected && "border-gold/50 bg-gold-soft/80")}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        onToggle(!selected);
      }}
    >
      <Checkbox className="mt-1" checked={selected} onCheckedChange={(v) => onToggle(v === true)} aria-label={`Select ${r.name}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button type="button" className="truncate text-left text-[15px] font-semibold" onClick={onOpen}>{r.name}</button>
          {r.profile_url && (
            <a href={r.profile_url} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1 text-primary/70" aria-label="Naukri profile">
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {showRole && <Badge color={ROLE_COLORS[r.role]}>{r.role}</Badge>}
          <Badge color={r.stage_color}>{r.stage_name}</Badge>
          {r.tag_name && <Badge color={r.tag_color ?? undefined}>{r.tag_name}</Badge>}
          {r.rescheduled && <Badge color={RESCHEDULED_COLOR}>Rescheduled</Badge>}
          {r.source && r.source !== "naukri" && <Badge color="#64748b">{sourceLabel(r.source)}</Badge>}
          {r.interview_at && <span className="text-xs text-muted-foreground">1:1 {formatInterviewTime(r.interview_at)}</span>}
          {r.interviewer_name && <Badge color={r.interviewer_color}>{r.interviewer_name}</Badge>}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className={cn("font-mono", !r.primary_phone && "text-red-600")}>{r.primary_phone ?? "no valid mobile"}</span>
          <span className="truncate">{r.current_location ?? "—"}</span>
          <span>{r.total_exp_months === null ? "—" : `${Math.floor(r.total_exp_months / 12)}y ${r.total_exp_months % 12}m exp`}</span>
          <span>{r.salary_lakhs === null ? "—" : `₹${r.salary_lakhs} L`} · {r.notice_period ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Quick buttons for Shortlisted: All · No tag · 72h · 48h · 24h · Hold, each with its count.
 * Daily order: 24h → Hold, 48h → 24h, 72h → 48h, then No tag → 72h (after the Naukri upload).
 */
function ShortlistBar({
  counts,
  filters,
  shortlistedStageId,
  stageName,
  onPick,
  onSelectAll,
  selectingAll,
  totalShown,
  allSelected,
}: {
  counts: { total: number; none: number; tags: (ShortlistTag & { count: number })[] };
  filters: Filters;
  shortlistedStageId: number;
  stageName: string;
  onPick: (tagKey: string | null) => void;
  onSelectAll: () => void;
  selectingAll: boolean;
  totalShown: number;
  allSelected: boolean;
}) {
  const onlyShortlisted = filters.stage_ids?.length === 1 && filters.stage_ids[0] === shortlistedStageId;
  const activeKey = onlyShortlisted ? (filters.tag_ids?.length === 1 ? filters.tag_ids[0] : filters.tag_ids?.length ? "multi" : "all") : null;
  const items: { key: string | null; label: string; count: number; color?: string }[] = [
    { key: null, label: `All ${stageName}`, count: counts.total },
    { key: "none", label: "No tag", count: counts.none },
    ...counts.tags.map((t) => ({ key: String(t.id), label: t.name, count: Number(t.count), color: t.color })),
  ];
  const sorted = [...counts.tags].sort((a, b) => b.position - a.position).map((t) => t.name);
  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
      <span className="mr-1 text-xs font-medium text-muted-foreground">{stageName}:</span>
      {items.map((it) => {
        const active = (it.key ?? "all") === activeKey;
        return (
          <button
            key={it.label}
            type="button"
            onClick={() => onPick(it.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              active ? "border-primary bg-primary text-white" : "border-black/10 bg-white/70 hover:bg-white",
            )}
          >
            {it.color && <span className="size-2 rounded-full" style={{ backgroundColor: active ? "#fff" : it.color }} />}
            {it.label}
            <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-white/20" : "bg-black/[0.05]")}>{it.count}</span>
          </button>
        );
      })}
      {activeKey !== null && totalShown > 0 && (
        <Button size="sm" variant="gold" onClick={onSelectAll} disabled={selectingAll || allSelected} className="ml-auto">
          {selectingAll ? <Loader2 className="animate-spin" /> : null}
          {allSelected ? `All ${totalShown} selected` : `Select all ${totalShown}`}
        </Button>
      )}
      <p className="w-full text-xs text-muted-foreground">
        Daily order: {sorted.slice(1).map((n, i) => `${n} → ${sorted[i]}`).join(", ")}, then No tag → {sorted[sorted.length - 1] ?? "first tag"} after the Naukri upload.
      </p>
    </div>
  );
}

type ReschedCount = { stage_id: number; stage_name: string; stage_color: string; total: number; rescheduled: number };

/** Quick buttons for 1:1 Aligned: All · Rescheduled · Not rescheduled, each with its count. */
function ReschedBar({
  counts,
  filters,
  onPick,
  onSelectAll,
  selectingAll,
  totalShown,
  allSelected,
}: {
  counts: ReschedCount;
  filters: Filters;
  onPick: (value: "yes" | "no" | undefined) => void;
  onSelectAll: () => void;
  selectingAll: boolean;
  totalShown: number;
  allSelected: boolean;
}) {
  const onlyThis = filters.stage_ids?.length === 1 && filters.stage_ids[0] === counts.stage_id;
  const activeKey = onlyThis ? (filters.rescheduled ?? "all") : null;
  const total = Number(counts.total);
  const res = Number(counts.rescheduled);
  const items: { key: "all" | "yes" | "no"; label: string; count: number; color?: string }[] = [
    { key: "all", label: `All ${counts.stage_name}`, count: total },
    { key: "yes", label: "Rescheduled", count: res, color: RESCHEDULED_COLOR },
    { key: "no", label: "Not rescheduled", count: total - res },
  ];
  return (
    <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
      <span className="mr-1 text-xs font-medium text-muted-foreground">{counts.stage_name}:</span>
      {items.map((it) => {
        const active = it.key === activeKey;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onPick(it.key === "all" ? undefined : it.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              active ? "border-primary bg-primary text-white" : "border-black/10 bg-white/70 hover:bg-white",
            )}
          >
            {it.color && <span className="size-2 rounded-full" style={{ backgroundColor: active ? "#fff" : it.color }} />}
            {it.label}
            <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-white/20" : "bg-black/[0.05]")}>{it.count}</span>
          </button>
        );
      })}
      {activeKey !== null && totalShown > 0 && (
        <Button size="sm" variant="gold" onClick={onSelectAll} disabled={selectingAll || allSelected} className="ml-auto">
          {selectingAll ? <Loader2 className="animate-spin" /> : null}
          {allSelected ? `All ${totalShown} selected` : `Select all ${totalShown}`}
        </Button>
      )}
      <p className="w-full text-xs text-muted-foreground">
        Tick the people whose 1:1 was rescheduled, then <b>Rescheduled… → Mark as Rescheduled</b>. It clears by itself when they move to the next stage.
      </p>
    </div>
  );
}
