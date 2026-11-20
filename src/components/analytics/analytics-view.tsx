"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, CheckCircle2, Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/dates";
import { buildInsights, conversions, type AnalyticsData } from "@/lib/analytics/insights";
import type { Interviewer } from "@/lib/candidates/types";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/* Chart colours (validated reference palette): one series hue, recessive chrome, reserved status red. */
const SERIES = BRAND.forestLight;
const GRID = "#e7e6e2";
const AXIS_TEXT = "#6b6a66";
const CRITICAL = "#d03b3b";

type RoleChoice = "BOTH" | "ZBM" | "HOS";
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const shortDay = (day: string) => formatDate(day).slice(0, 6).replace("-", " "); // "16 Nov"
const roleLink = (role: string, f: object) => `/${role.toLowerCase()}?f=${encodeURIComponent(JSON.stringify(f))}`;

export function AnalyticsView({ interviewers }: { interviewers: Interviewer[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState<RoleChoice>("BOTH");
  const [to, setTo] = useState(istToday);
  const [from, setFrom] = useState(() => addDays(istToday(), -29));
  const [interviewerId, setInterviewerId] = useState<string>("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [tagMoves, setTagMoves] = useState<{ from_tag: string; to_stage: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!from || !to || from > to) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("analytics", {
        p_role: role === "BOTH" ? null : role,
        p_from: from,
        p_to: to,
        p_interviewer_id: interviewerId ? Number(interviewerId) : null,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error) toast.error("Couldn't load analytics", { description: error.message });
        else setData(data as AnalyticsData);
      });
    supabase
      .rpc("tag_conversion", { p_role: role === "BOTH" ? null : role, p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!cancelled && !error) setTagMoves((data ?? []) as { from_tag: string; to_stage: string; count: number }[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, role, from, to, interviewerId]);

  const quick = (days: number) => {
    const t = istToday();
    setTo(t);
    setFrom(addDays(t, -(days - 1)));
  };
  const rangeDays = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Filters: one row above everything */}
      <div className="glass glass-strong z-20 flex flex-wrap items-end gap-3 rounded-2xl p-3 md:sticky md:top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]">
        <div className="flex flex-col gap-1 text-xs font-medium">
          Role
          <div className="inline-flex rounded-full bg-black/[0.05] p-0.5">
            {(["BOTH", "ZBM", "HOS"] as RoleChoice[]).map((r) => (
              <button key={r} onClick={() => setRole(r)} className={cn("rounded-full px-3 py-1 text-sm", role === r ? "bg-primary text-white" : "hover:bg-black/[0.05]")}>
                {r === "BOTH" ? "Both" : r}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium">
          From
          <Input type="date" className="h-8 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          To
          <Input type="date" className="h-8 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="flex gap-1 pb-0.5">
          {[7, 14, 30, 90].map((d) => (
            <button key={d} onClick={() => quick(d)} className={cn("rounded-full border border-black/10 px-2.5 py-1 text-xs", rangeDays === d && to === istToday() ? "border-primary bg-primary text-white" : "hover:bg-black/[0.05]")}>
              {d}d
            </button>
          ))}
        </div>
        {interviewers.length > 0 && <label className="flex flex-col gap-1 text-xs font-medium">
          Interviewer
          <select className="h-9 min-w-36 rounded-lg border border-black/10 bg-white/80 px-2 text-sm font-normal" value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}>
            <option value="">All candidates</option>
            {interviewers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>}
        {loading && <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" />}
        {data && (
          <p className="w-full pb-1 text-xs text-muted-foreground xl:ml-auto xl:w-auto">
            {formatDate(data.period.from)} – {formatDate(data.period.to)} · compared with {formatDate(data.period.prev_from)} – {formatDate(data.period.prev_to)}
          </p>
        )}
      </div>

      {!data ? (
        <Loader2 className="mx-auto mt-10 size-5 animate-spin text-muted-foreground" />
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
          <Insights data={data} role={role} interviewerId={interviewerId} />
          <Daily data={data} />
          <div className="grid gap-6 xl:grid-cols-2">
            <Funnel data={data} />
            <TimeInStage data={data} />
          </div>
          {interviewers.length > 0 && <TagMoves rows={tagMoves} />}
          <Stuck data={data} interviewerId={interviewerId} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ sections

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-3xl p-4 sm:p-6">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const INSIGHTS_SHOWN = 5;

function Insights({ data, role, interviewerId }: { data: AnalyticsData; role: RoleChoice; interviewerId: string }) {
  const all = buildInsights(data); // conversion first, then slow stages, then stuck groups
  const [expanded, setExpanded] = useState(false);
  const insights = expanded ? all : all.slice(0, INSIGHTS_SHOWN);
  return (
    <Card
      title="Bottlenecks"
      subtitle={`Limits from Settings: at most ${data.thresholds.max_days} days in a stage, at least ${data.thresholds.min_conversion_pct}% conversion to the next stage.`}
    >
      <ul className="space-y-2">
        {insights.map((i, k) => (
          <li
            key={k}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
              i.level === "critical" ? "border-[#d03b3b]/30 bg-[#d03b3b]/5" : "border-emerald-200 bg-emerald-50",
            )}
          >
            {i.level === "critical" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: CRITICAL }} aria-label="Bottleneck" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="OK" />
            )}
            <span className="flex-1">
              {i.level === "critical" && <b className="mr-1" style={{ color: CRITICAL }}>Bottleneck:</b>}
              {i.text}
            </span>
            {i.link && (
              <Link
                className="shrink-0 text-primary hover:underline"
                href={roleLink(i.link.role, {
                  stage_ids: [i.link.stageId],
                  stage_changed_to: data.stuck_before,
                  ...(interviewerId ? { interviewer_ids: [interviewerId] } : {}),
                })}
              >
                Open them →
              </Link>
            )}
          </li>
        ))}
      </ul>
      {all.length > INSIGHTS_SHOWN && (
        <button className="mt-2 text-sm text-primary hover:underline" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show fewer" : `Show ${all.length - INSIGHTS_SHOWN} more`}
        </button>
      )}
      {role === "BOTH" && <p className="mt-3 text-xs text-muted-foreground">Showing ZBM and HOS together. Pick a role above to see one.</p>}
    </Card>
  );
}

function ChartTooltip({ active, payload, label, suffix }: { active?: boolean; payload?: { value: number }[]; label?: string; suffix: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass glass-strong rounded-xl px-2.5 py-1.5 text-xs">
      <div className="text-muted-foreground">{label ? formatDate(label) : ""}</div>
      <div className="font-semibold tabular-nums">{payload[0].value} {suffix}</div>
    </div>
  );
}

function DayBars({ rows, height, yMax, suffix, showYAxis = true }: { rows: { day: string; value: number }[]; height: number; yMax?: number; suffix: string; showYAxis?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: showYAxis ? -16 : 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
        <YAxis hide={!showYAxis} allowDecimals={false} domain={[0, yMax ?? "auto"]} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={false} width={40} />
        <Tooltip cursor={{ fill: "rgba(31,77,54,0.06)" }} content={<ChartTooltip suffix={suffix} />} />
        <Bar dataKey="value" fill={SERIES} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Daily({ data }: { data: AnalyticsData }) {
  const uploads = data.daily.map((d) => ({ day: d.day, value: d.uploaded }));
  const stages = [...data.funnel].sort((a, b) => a.position - b.position);
  const perStage = stages.map((s) => ({
    stage: s,
    rows: data.daily.map((d) => ({ day: d.day, value: d.moves[String(s.id)] ?? 0 })),
  }));
  const moveMax = Math.max(1, ...perStage.flatMap((p) => p.rows.map((r) => r.value)));
  const totalUploaded = uploads.reduce((a, r) => a + r.value, 0);

  return (
    <Card title="Daily progress" subtitle="New candidates uploaded per day, and candidates moved into each stage per day.">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">New candidates uploaded</h3>
        <span className="text-sm text-muted-foreground"><b className="text-foreground tabular-nums">{totalUploaded}</b> in this period</span>
      </div>
      <DayBars rows={uploads} height={200} suffix="uploaded" />

      <h3 className="mb-2 mt-6 text-sm font-medium">Moved into each stage <span className="font-normal text-muted-foreground">(same scale on every chart)</span></h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {perStage.map(({ stage, rows }) => (
          <div key={stage.id} className="rounded-lg border p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <Badge color={stage.color}>{stage.name}</Badge>
              <span className="text-xs text-muted-foreground"><b className="text-foreground tabular-nums">{rows.reduce((a, r) => a + r.value, 0)}</b> moved in</span>
            </div>
            <DayBars rows={rows} height={110} yMax={moveMax} suffix={`moved into ${stage.name}`} />
          </div>
        ))}
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-primary">Show as a table</summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Day</th>
                <th className="px-2 py-1.5 text-right font-medium">Uploaded</th>
                {stages.map((s) => <th key={s.id} className="px-2 py-1.5 text-right font-medium">→ {s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.day} className="border-t">
                  <td className="whitespace-nowrap px-2 py-1">{formatDate(d.day)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.uploaded}</td>
                  {stages.map((s) => <td key={s.id} className="px-2 py-1 text-right tabular-nums">{d.moves[String(s.id)] ?? 0}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function Funnel({ data }: { data: AnalyticsData }) {
  const stages = [...data.funnel].sort((a, b) => a.position - b.position);
  const conv = conversions(data.funnel);
  const max = Math.max(1, ...stages.map((s) => Number(s.entered)));
  const min = data.thresholds.min_conversion_pct;

  return (
    <Card title="Funnel" subtitle="How many entered each stage in this period, and how many of them have since reached a later stage.">
      <div className="space-y-1">
        {stages.map((s, i) => {
          const c = conv[i];
          const low = c && c.pct !== null && c.entered >= 5 && c.pct < min;
          return (
            <div key={s.id}>
              <div className="grid grid-cols-[minmax(0,7.5rem)_1fr_3rem] items-center gap-2 sm:grid-cols-[minmax(0,13rem)_1fr_4.5rem] sm:gap-3" title={`${s.entered} entered ${s.name} in this period · ${s.current} in it now`}>
                <span className="truncate"><Badge color={s.color}>{s.name}</Badge></span>
                <span className="h-6 overflow-hidden rounded bg-muted/60">
                  <span className="block h-full rounded-r" style={{ width: `${(Number(s.entered) / max) * 100}%`, backgroundColor: SERIES, minWidth: Number(s.entered) ? 4 : 0 }} />
                </span>
                <span className="text-right text-sm font-semibold tabular-nums">{Number(s.entered).toLocaleString("en-IN")}</span>
              </div>
              {c && (
                <div className="flex items-center gap-2 py-1 pl-[8rem] text-xs sm:pl-[13.75rem]">
                  <ArrowDown className="size-3 text-muted-foreground" />
                  {c.pct === null ? (
                    <span className="text-muted-foreground">no one entered</span>
                  ) : (
                    <span className={cn("tabular-nums", low ? "font-semibold" : "text-muted-foreground")} style={low ? { color: CRITICAL } : undefined}>
                      {low && <AlertTriangle className="mr-1 inline size-3" />}
                      {c.pct}% moved on ({c.converted} of {c.entered})
                      {c.prevPct !== null && c.prevEntered >= 5 && <span className="font-normal text-muted-foreground"> · before: {c.prevPct}%</span>}
                      {low && " · below minimum"}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Candidates who entered a stage recently may not have had time to move on yet, so the latest days lower the rate.
      </p>
    </Card>
  );
}

function TimeInStage({ data }: { data: AnalyticsData }) {
  const max = data.thresholds.max_days;
  const rows = [...data.time_in_stage].sort((a, b) => a.position - b.position);
  return (
    <Card title="Time in stage" subtitle="Days from entering a stage to leaving it, for stays that started in this period.">
      <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[30rem] text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">Stage</th>
            <th className="pb-2 text-right font-medium">Average</th>
            <th className="pb-2 text-right font-medium">Median</th>
            <th className="pb-2 text-right font-medium">Finished stays</th>
            <th className="pb-2 text-right font-medium">In it now (avg so far)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const slow = t.median_days !== null && Number(t.median_days) > max;
            const fs = data.funnel.find((f) => f.id === t.id);
            return (
              <tr key={t.id} className="border-t">
                <td className="py-2"><Badge color={fs?.color}>{t.name}</Badge></td>
                <td className="py-2 text-right tabular-nums">{t.avg_days ?? "—"}{t.avg_days !== null && " d"}</td>
                <td className="py-2 text-right tabular-nums" style={slow ? { color: CRITICAL, fontWeight: 600 } : undefined}>
                  {slow && <AlertTriangle className="mr-1 inline size-3" aria-label="Over the limit" />}
                  {t.median_days ?? "—"}{t.median_days !== null && " d"}
                </td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">{t.stints}</td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">
                  {fs ? fs.current : 0}
                  {t.current_avg_days !== null && <> · {t.current_avg_days} d</>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="mt-3 text-xs text-muted-foreground">Red = median over your {max}-day limit. The median is the typical stay; the average is pulled up by a few long ones.</p>
    </Card>
  );
}

function Stuck({ data, interviewerId }: { data: AnalyticsData; interviewerId: string }) {
  const total = data.stuck.reduce((a, s) => a + Number(s.count), 0);
  return (
    <Card
      title="Stuck candidates"
      subtitle={`In the same stage for more than ${data.thresholds.max_days} days (last stage excluded). Open a group to export or move them.`}
    >
      {!data.stuck.length ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> Nobody is stuck.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[34rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Stage</th>
              <th className="pb-2 text-right font-medium">Candidates</th>
              <th className="pb-2 text-right font-medium">Longest wait</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {data.stuck.map((s) => (
              <tr key={`${s.role}-${s.stage_id}`} className="border-t">
                <td className="py-2 font-medium">{s.role}</td>
                <td className="py-2"><Badge color={s.color}>{s.name}</Badge></td>
                <td className="py-2 text-right font-semibold tabular-nums">{Number(s.count)}</td>
                <td className="py-2 text-right tabular-nums">{s.oldest_days} days</td>
                <td className="py-2 text-right">
                  <Link
                    className="text-primary hover:underline"
                    href={roleLink(s.role, {
                      stage_ids: [s.stage_id],
                      stage_changed_to: data.stuck_before,
                      ...(interviewerId ? { interviewer_ids: [interviewerId] } : {}),
                    })}
                  >
                    Open in {s.role} tab →
                  </Link>
                </td>
              </tr>
            ))}
            <tr className="border-t">
              <td colSpan={2} className="py-2 text-xs text-muted-foreground">Total</td>
              <td className="py-2 text-right font-semibold tabular-nums">{total}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

/** Which reminder works: candidates who left Shortlisted in the period, grouped by the tag they had then. */
function TagMoves({ rows }: { rows: { from_tag: string; to_stage: string; count: number }[] }) {
  const byStage = new Map<string, { from_tag: string; count: number }[]>();
  rows.forEach((r) => byStage.set(r.to_stage, [...(byStage.get(r.to_stage) ?? []), { from_tag: r.from_tag, count: Number(r.count) }]));
  const order = (t: string) => ["No tag", "72h", "48h", "24h", "Hold"].indexOf(t) + 1 || 99;
  return (
    <Card
      title="Which reminder works"
      subtitle="Candidates who left Shortlisted in this period (e.g. after the test-results upload), by the tag they had at that moment."
    >
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">Nobody left Shortlisted in this period yet. This fills in as you upload test results.</p>
      ) : (
        <div className="space-y-5">
          {[...byStage.entries()].map(([stage, list]) => {
            const total = list.reduce((a, r) => a + r.count, 0);
            const max = Math.max(1, ...list.map((r) => r.count));
            return (
              <div key={stage}>
                <p className="mb-2 text-sm">
                  → <b>{stage}</b>: {total} candidate{total === 1 ? "" : "s"}
                </p>
                <div className="space-y-1">
                  {[...list].sort((a, b) => order(a.from_tag) - order(b.from_tag)).map((r) => (
                    <div key={r.from_tag} className="grid grid-cols-[5rem_1fr_5rem] items-center gap-2 text-sm" title={`${r.count} had tag ${r.from_tag}`}>
                      <span className="text-muted-foreground">{r.from_tag}</span>
                      <span className="h-3 overflow-hidden rounded bg-muted/60">
                        <span className="block h-full rounded-r" style={{ width: `${(r.count / max) * 100}%`, backgroundColor: SERIES, minWidth: 4 }} />
                      </span>
                      <span className="text-right tabular-nums">
                        {r.count} <span className="text-xs text-muted-foreground">({Math.round((r.count / total) * 100)}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
