/**
 * Turns the analytics numbers into plain-English bottleneck alerts.
 * Thresholds come from Settings: max days in a stage (default 3) and minimum conversion % (default 30).
 */

export interface FunnelRow {
  id: number;
  name: string;
  color: string;
  position: number;
  current: number;
  entered: number;
  converted: number;
  prev_entered: number;
  prev_converted: number;
}

export interface TimeRow {
  id: number;
  name: string;
  position: number;
  avg_days: number | null;
  median_days: number | null;
  stints: number;
  current_avg_days: number | null;
}

export interface StuckRow {
  role: "ZBM" | "HOS";
  stage_id: number;
  name: string;
  color: string;
  position: number;
  count: number;
  oldest_days: number;
}

export interface DailyRow {
  day: string;
  uploaded: number;
  moves: Record<string, number>;
}

export interface AnalyticsData {
  period: { from: string; to: string; prev_from: string; prev_to: string; days: number };
  thresholds: { max_days: number; min_conversion_pct: number };
  today: string;
  stuck_before: string;
  funnel: FunnelRow[];
  time_in_stage: TimeRow[];
  daily: DailyRow[];
  stuck: StuckRow[];
}

export interface Insight {
  level: "critical" | "good";
  text: string;
  link?: { role: "ZBM" | "HOS"; stageId: number };
}

/** Too few candidates make percentages meaningless ("1 of 2 = 50%"), so conversion alerts need at least this many. */
export const MIN_SAMPLE = 5;

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Conversion from each stage to the next one (by position). The last stage has none. */
export function conversions(funnel: FunnelRow[]) {
  const sorted = [...funnel].sort((a, b) => a.position - b.position);
  return sorted.slice(0, -1).map((s, i) => ({
    from: s,
    to: sorted[i + 1],
    pct: pct(Number(s.converted), Number(s.entered)),
    prevPct: pct(Number(s.prev_converted), Number(s.prev_entered)),
    entered: Number(s.entered),
    converted: Number(s.converted),
    prevEntered: Number(s.prev_entered),
  }));
}

export function buildInsights(d: AnalyticsData): Insight[] {
  const out: Insight[] = [];
  const { max_days, min_conversion_pct } = d.thresholds;
  const periodWord = d.period.days === 7 ? "this week" : `in the last ${d.period.days} days`;

  // 1. Low conversion between consecutive stages.
  for (const c of conversions(d.funnel)) {
    if (c.pct === null || c.entered < MIN_SAMPLE || c.pct >= min_conversion_pct) continue;
    const dropped = c.prevPct !== null && c.prevEntered >= MIN_SAMPLE && c.prevPct > c.pct;
    const verb = dropped ? `dropped to ${c.pct}% ${periodWord} (down from ${c.prevPct}% in the ${d.period.days} days before)` : `is only ${c.pct}% ${periodWord}`;
    out.push({
      level: "critical",
      text: `${c.from.name} → ${c.to.name} conversion ${verb}: ${c.converted} of ${c.entered} moved on. Your minimum is ${min_conversion_pct}%.`,
    });
  }

  // 2. Stages where the typical stay is longer than the limit.
  for (const t of d.time_in_stage) {
    if (t.median_days === null || t.stints < MIN_SAMPLE || Number(t.median_days) <= max_days) continue;
    out.push({
      level: "critical",
      text: `Candidates spend a median of ${t.median_days} days in ${t.name} before moving on, more than your ${max_days}-day limit.`,
    });
  }

  // 3. Candidates stuck longer than the limit.
  for (const s of d.stuck) {
    out.push({
      level: "critical",
      text: `${Number(s.count)} ${s.role} candidate${Number(s.count) === 1 ? "" : "s"} stuck in ${s.name} for more than ${max_days} days (longest: ${s.oldest_days} days).`,
      link: { role: s.role, stageId: s.stage_id },
    });
  }

  if (!out.length) out.push({ level: "good", text: `No bottlenecks ${periodWord}: every conversion is at or above ${min_conversion_pct}% and nobody is over ${max_days} days in a stage.` });
  return out;
}
