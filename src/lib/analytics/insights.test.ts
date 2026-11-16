import { describe, expect, it } from "vitest";
import { buildInsights, conversions, type AnalyticsData, type FunnelRow } from "./insights";

const stage = (position: number, name: string, entered: number, converted: number, prev_entered = 0, prev_converted = 0): FunnelRow => ({
  id: position, name, color: "#000", position, current: 0, entered, converted, prev_entered, prev_converted,
});

const base = (over: Partial<AnalyticsData>): AnalyticsData => ({
  period: { from: "2026-11-10", to: "2026-11-16", prev_from: "2026-11-03", prev_to: "2026-11-09", days: 7 },
  thresholds: { max_days: 3, min_conversion_pct: 30 },
  today: "2026-11-16",
  stuck_before: "2026-11-12",
  funnel: [stage(1, "FAQ Invited", 50, 20), stage(2, "1:1 Aligned", 10, 5), stage(3, "LOI Sent", 3, 0)],
  time_in_stage: [],
  daily: [],
  stuck: [],
  ...over,
});

describe("conversions", () => {
  it("pairs each stage with the next one and skips the last", () => {
    const c = conversions(base({}).funnel);
    expect(c.map((x) => `${x.from.name}→${x.to.name} ${x.pct}%`)).toEqual(["FAQ Invited→1:1 Aligned 40%", "1:1 Aligned→LOI Sent 50%"]);
  });
});

describe("bottleneck insights", () => {
  it("reports no bottlenecks when everything is within limits", () => {
    expect(buildInsights(base({}))).toEqual([{ level: "good", text: expect.stringContaining("No bottlenecks this week") }]);
  });

  it("flags low conversion and the drop from the previous period", () => {
    const d = base({ funnel: [stage(1, "FAQ Invited", 50, 6, 40, 16), stage(2, "1:1 Aligned", 6, 6)] });
    expect(buildInsights(d)[0].text).toBe(
      "FAQ Invited → 1:1 Aligned conversion dropped to 12% this week (down from 40% in the 7 days before): 6 of 50 moved on. Your minimum is 30%.",
    );
  });

  it("says 'is only' when there is no earlier period to compare with", () => {
    const d = base({ funnel: [stage(1, "FAQ Invited", 50, 6), stage(2, "1:1 Aligned", 6, 6)] });
    expect(buildInsights(d)[0].text).toBe("FAQ Invited → 1:1 Aligned conversion is only 12% this week: 6 of 50 moved on. Your minimum is 30%.");
  });

  it("ignores tiny samples", () => {
    expect(buildInsights(base({ funnel: [stage(1, "A", 4, 0), stage(2, "B", 0, 0)] }))[0].level).toBe("good");
  });

  it("flags stuck candidates with a link to open them", () => {
    const [i] = buildInsights(base({ stuck: [{ role: "HOS", stage_id: 5, name: "LOI Sent", color: "#000", position: 5, count: 46, oldest_days: 9 }] }));
    expect(i).toEqual({ level: "critical", text: "46 HOS candidates stuck in LOI Sent for more than 3 days (longest: 9 days).", link: { role: "HOS", stageId: 5 } });
  });

  it("flags slow stages by median time", () => {
    const d = base({ time_in_stage: [{ id: 1, name: "FAQ Invited", position: 1, avg_days: 6, median_days: 5.2, stints: 12, current_avg_days: 2 }] });
    expect(buildInsights(d)[0].text).toBe("Candidates spend a median of 5.2 days in FAQ Invited before moving on, more than your 3-day limit.");
  });
});
