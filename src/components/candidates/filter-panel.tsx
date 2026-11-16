"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { Filters, ScreeningFilter } from "@/lib/candidates/filters";
import { cleanFilters } from "@/lib/candidates/filters";
import { formatDate } from "@/lib/dates";
import type { FilterOptions, Interviewer, Stage } from "@/lib/candidates/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { shortQuestion } from "./columns";

/**
 * Side panel with every filter. Changes are kept as a draft and applied together
 * with "Apply filters", so the table doesn't reload on every click.
 */
export function FilterPanel({
  open,
  onOpenChange,
  filters,
  onApply,
  stages,
  interviewers,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: Filters;
  onApply: (f: Filters) => void;
  stages: Stage[];
  interviewers: Interviewer[];
  options: FilterOptions;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {/* Remount the form each time it opens so the draft starts from the current filters. */}
        {open && (
          <PanelBody
            initial={filters}
            stages={stages}
            interviewers={interviewers}
            options={options}
            onApply={(f) => {
              onApply(f);
              onOpenChange(false);
            }}
          />
        )}
      </SheetContent>
    </Dialog>
  );
}

function PanelBody({
  initial,
  onApply,
  stages,
  interviewers,
  options,
}: {
  initial: Filters;
  onApply: (f: Filters) => void;
  stages: Stage[];
  interviewers: Interviewer[];
  options: FilterOptions;
}) {
  const [d, setD] = useState<Filters>(initial);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setD((s) => ({ ...s, [key]: value }));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const setQ = (q: string, patch: ScreeningFilter) =>
    setD((s) => ({ ...s, screening: { ...(s.screening ?? {}), [q]: { ...(s.screening?.[q] ?? {}), ...patch } } }));

  return (
    <>
      <div className="border-b px-5 py-4">
        <DialogTitle>Filters</DialogTitle>
        <DialogDescription>All filters combine (AND). Within one list, any ticked value matches.</DialogDescription>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <Section title="Stage">
          <div className="flex flex-col gap-1.5">
            {stages.map((s) => (
              <CheckRow key={s.id} checked={d.stage_ids?.includes(s.id) ?? false} onChange={(on) => set("stage_ids", toggle(d.stage_ids, s.id, on))}>
                <Badge color={s.color}>{s.name}</Badge>
              </CheckRow>
            ))}
          </div>
        </Section>

        <Section title="Interviewer">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {interviewers.map((i) => (
              <CheckRow key={i.id} checked={d.interviewer_ids?.includes(String(i.id)) ?? false} onChange={(on) => set("interviewer_ids", toggle(d.interviewer_ids, String(i.id), on))}>
                <Badge color={i.color}>{i.name}</Badge>
              </CheckRow>
            ))}
            <CheckRow checked={d.interviewer_ids?.includes("none") ?? false} onChange={(on) => set("interviewer_ids", toggle(d.interviewer_ids, "none", on))}>
              <span className="text-sm text-muted-foreground">No interviewer</span>
            </CheckRow>
          </div>
        </Section>

        <Section title="Dates">
          <DateRange label="Uploaded" from={d.created_from} to={d.created_to} onChange={(f, t) => setD((s) => ({ ...s, created_from: f, created_to: t }))} />
          <DateRange label="Date of application" from={d.applied_from} to={d.applied_to} onChange={(f, t) => setD((s) => ({ ...s, applied_from: f, applied_to: t }))} />
          <DateRange label="Last stage change" from={d.stage_changed_from} to={d.stage_changed_to} onChange={(f, t) => setD((s) => ({ ...s, stage_changed_from: f, stage_changed_to: t }))} />
        </Section>

        <Section title="Location">
          <SubLabel>Current location</SubLabel>
          <MultiSelect values={options.current_locations} selected={d.current_locations ?? []} onChange={(v) => set("current_locations", v)} />
          <SubLabel>Preferred locations contain</SubLabel>
          <Input placeholder="e.g. Pune" value={d.preferred_location ?? ""} onChange={(e) => set("preferred_location", e.target.value)} />
          <SubLabel>Home town</SubLabel>
          <MultiSelect values={options.home_towns} selected={d.home_towns ?? []} onChange={(v) => set("home_towns", v)} />
        </Section>

        <Section title="Experience & salary">
          <Range label="Experience (years)" min={d.exp_min} max={d.exp_max} onChange={(a, b) => setD((s) => ({ ...s, exp_min: num(a), exp_max: num(b) }))} />
          <Range label="Annual salary (lakhs)" min={d.salary_min} max={d.salary_max} onChange={(a, b) => setD((s) => ({ ...s, salary_min: num(a), salary_max: num(b) }))} />
          <SubLabel>Notice period</SubLabel>
          <div className="flex flex-col gap-1.5">
            {options.notice_periods.map((n) => (
              <CheckRow key={n} checked={d.notice_periods?.includes(n) ?? false} onChange={(on) => set("notice_periods", toggle(d.notice_periods, n, on))}>
                <span className="text-sm">{n}</span>
              </CheckRow>
            ))}
          </div>
        </Section>

        <Section title="Work & education">
          <SubLabel>Current company contains</SubLabel>
          <Input value={d.company ?? ""} onChange={(e) => set("company", e.target.value)} />
          <SubLabel>Designation contains</SubLabel>
          <Input value={d.designation ?? ""} onChange={(e) => set("designation", e.target.value)} />
          <SubLabel>UG degree</SubLabel>
          <MultiSelect values={options.ug_degrees} selected={d.ug_degrees ?? []} onChange={(v) => set("ug_degrees", v)} />
          <SubLabel>PG degree</SubLabel>
          <MultiSelect values={options.pg_degrees} selected={d.pg_degrees ?? []} onChange={(v) => set("pg_degrees", v)} />
          <SubLabel>Gender</SubLabel>
          <div className="flex gap-4">
            {options.genders.map((g) => (
              <CheckRow key={g} checked={d.genders?.includes(g) ?? false} onChange={(on) => set("genders", toggle(d.genders, g, on))}>
                <span className="text-sm">{g}</span>
              </CheckRow>
            ))}
          </div>
        </Section>

        <Section title="Mobile number">
          <Segmented<"all" | "valid" | "invalid">
            value={d.phone_status ?? "all"}
            onChange={(v) => set("phone_status", v === "all" ? undefined : v)}
            options={[
              { value: "all", label: "All" },
              { value: "valid", label: "Valid (exportable)" },
              { value: "invalid", label: "No valid mobile" },
            ]}
          />
        </Section>

        {options.questions.length > 0 && (
          <Section title="Screening answers">
            {options.questions.map(({ question, is_numeric }) => {
              const c = d.screening?.[question] ?? {};
              return (
                <div key={question} className="space-y-1.5">
                  <p className="text-xs font-medium" title={question}>{shortQuestion(question)} <span className="font-normal text-muted-foreground">· {question}</span></p>
                  {is_numeric ? (
                    <div className="flex items-center gap-2">
                      <Input type="number" step="any" placeholder="Min" value={c.min ?? ""} onChange={(e) => setQ(question, { min: num(e.target.value) })} />
                      <span className="text-muted-foreground">–</span>
                      <Input type="number" step="any" placeholder="Max" value={c.max ?? ""} onChange={(e) => setQ(question, { max: num(e.target.value) })} />
                    </div>
                  ) : (
                    <Input placeholder="Answer contains…" value={c.text ?? ""} onChange={(e) => setQ(question, { text: e.target.value })} />
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Number filters skip answers that aren&apos;t numbers (e.g. &quot;Yes&quot;). The CTC answer is in rupees, e.g. 1500000.
            </p>
          </Section>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
        <Button variant="ghost" onClick={() => setD(initial.q ? { q: initial.q } : {})}>Clear all</Button>
        <Button onClick={() => onApply(cleanFilters(d))}>Apply filters</Button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ pieces

function toggle<T>(list: T[] | undefined, value: T, on: boolean): T[] {
  const s = new Set(list ?? []);
  if (on) s.add(value);
  else s.delete(value);
  return [...s];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-xs font-medium">{children}</p>;
}

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {children}
    </label>
  );
}

function DateRange({ label, from, to, onChange }: { label: string; from?: string; to?: string; onChange: (from?: string, to?: string) => void }) {
  return (
    <div className="space-y-1">
      <SubLabel>{label}</SubLabel>
      <div className="flex items-center gap-2">
        <Input type="date" value={from ?? ""} onChange={(e) => onChange(e.target.value || undefined, to)} aria-label={`${label} from`} />
        <span className="text-muted-foreground">to</span>
        <Input type="date" value={to ?? ""} onChange={(e) => onChange(from, e.target.value || undefined)} aria-label={`${label} to`} />
      </div>
      {(from || to) && (
        <p className="text-xs text-muted-foreground">
          {from ? formatDate(from) : "any date"} → {to ? formatDate(to) : "today"}
        </p>
      )}
    </div>
  );
}

function Range({ label, min, max, onChange }: { label: string; min?: number; max?: number; onChange: (min: string, max: string) => void }) {
  return (
    <div className="space-y-1">
      <SubLabel>{label}</SubLabel>
      <div className="flex items-center gap-2">
        <Input type="number" min={0} step="any" placeholder="Min" value={min ?? ""} onChange={(e) => onChange(e.target.value, max === undefined ? "" : String(max))} />
        <span className="text-muted-foreground">–</span>
        <Input type="number" min={0} step="any" placeholder="Max" value={max ?? ""} onChange={(e) => onChange(min === undefined ? "" : String(min), e.target.value)} />
      </div>
    </div>
  );
}

/** Searchable checkbox list for long pick-lists (locations, degrees). */
function MultiSelect({ values, selected, onChange }: { values: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [search, setSearch] = useState("");
  const shown = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  if (!values.length) return <p className="text-xs text-muted-foreground">No values yet.</p>;
  return (
    <div className="rounded-md border">
      {values.length > 8 && (
        <div className="relative border-b">
          <Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
          <input
            className="h-8 w-full bg-transparent pl-7 pr-2 text-sm outline-none"
            placeholder={`Search ${values.length} values…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <div className="max-h-40 space-y-1 overflow-y-auto p-2">
        {shown.map((v) => (
          <CheckRow key={v} checked={selected.includes(v)} onChange={(on) => onChange(toggle(selected, v, on))}>
            <span className="text-sm">{v}</span>
          </CheckRow>
        ))}
        {!shown.length && <p className="text-xs text-muted-foreground">No match.</p>}
      </div>
      {selected.length > 0 && (
        <div className="flex items-center justify-between border-t px-2 py-1 text-xs text-muted-foreground">
          {selected.length} selected
          <button type="button" className="text-primary hover:underline" onClick={() => onChange([])}>Clear</button>
        </div>
      )}
    </div>
  );
}
