import { describe, expect, it } from "vitest";
import { describeEvent, type HistoryEvent } from "./history";

const ev = (kind: HistoryEvent["kind"], details: Record<string, unknown>, bulk_size = 1): HistoryEvent => ({
  at: "2026-11-16T09:00:00Z", kind, user_name: "Lakshay", details, bulk_action_id: null, bulk_size,
});

describe("candidate history wording", () => {
  it("describes moves, with the interviewer only when it changed", () => {
    expect(describeEvent(ev("stage_change", { from_stage: "FAQ Invited", to_stage: "1:1 Aligned", to_interviewer: "Parul" }, 35))).toEqual({
      title: "Moved FAQ Invited → 1:1 Aligned",
      note: "Interviewer: Parul · Bulk move of 35",
    });
    expect(describeEvent(ev("stage_change", { from_stage: "1:1 Aligned", to_stage: "LOI Sent", from_interviewer: "Parul", to_interviewer: "Parul" })).note).toBeUndefined();
  });
  it("describes tag changes and the tag someone had when they moved", () => {
    expect(describeEvent(ev("tag_change", { from_tag: "72h", to_tag: "48h" }, 85))).toEqual({ title: "Tag 72h → 48h", note: "Bulk change of 85" });
    expect(describeEvent(ev("tag_change", { to_tag: "72h" })).title).toBe("Tag No tag → 72h");
    expect(describeEvent(ev("stage_change", { from_stage: "Shortlisted", to_stage: "JD and Assessment Test Cleared", from_tag: "24h" })).note).toBe("Had tag 24h");
  });
  it("describes Rescheduled", () => {
    expect(describeEvent(ev("reschedule", { rescheduled: true })).title).toBe("Marked Rescheduled (1:1)");
    expect(describeEvent(ev("reschedule", { rescheduled: false }, 3))).toEqual({ title: "Rescheduled removed", note: "Bulk change of 3" });
    expect(describeEvent(ev("stage_change", { from_stage: "1:1 Aligned", to_stage: "LOI Sent", was_rescheduled: true })).note).toBe("Was rescheduled");
  });
  it("describes interviewer changes", () => {
    expect(describeEvent(ev("interviewer_change", { to_interviewer: "Umer" })).title).toBe("Interviewer set to Umer");
    expect(describeEvent(ev("interviewer_change", { from_interviewer: "Parul", to_interviewer: "Umer" })).title).toBe("Interviewer changed Parul → Umer");
    expect(describeEvent(ev("interviewer_change", { from_interviewer: "Parul" })).title).toBe("Interviewer removed (was Parul)");
  });
  it("describes uploads and exports", () => {
    expect(describeEvent(ev("added", { file_name: "n.xlsx", stage: "Shortlisted" }))).toEqual({ title: "Added in Shortlisted", note: "From upload n.xlsx" });
    expect(describeEvent(ev("export", { file_name: "ZBM_FAQ-Invited_16-Nov-2026.csv", exported: 62, tags: "stage" })).note).toBe(
      "ZBM_FAQ-Invited_16-Nov-2026.csv · 62 candidates · Tags: stage",
    );
  });
});
