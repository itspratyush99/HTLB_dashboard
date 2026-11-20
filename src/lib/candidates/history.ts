/** Turns history / activity rows into plain-English sentences (used by the candidate timeline). */

export interface HistoryEvent {
  at: string;
  kind: "added" | "stage_change" | "interviewer_change" | "export" | "tag_change" | "reschedule";
  user_name: string | null;
  details: Record<string, unknown> | null;
  bulk_action_id: string | null;
  bulk_size: number;
}

const s = (v: unknown) => (typeof v === "string" && v ? v : null);

export function describeEvent(e: HistoryEvent): { title: string; note?: string } {
  const d = e.details ?? {};
  switch (e.kind) {
    case "added":
      return {
        title: `Added in ${s(d.stage) ?? "Shortlisted"}`,
        note: s(d.file_name) ? `From upload ${d.file_name}` : undefined,
      };
    case "tag_change":
      return {
        title: `Tag ${s(d.from_tag) ?? "No tag"} → ${s(d.to_tag) ?? "No tag"}`,
        note: e.bulk_size > 1 ? `Bulk change of ${e.bulk_size}` : undefined,
      };
    case "reschedule":
      return {
        title: d.rescheduled === false ? "Rescheduled removed" : "Marked Rescheduled (1:1)",
        note: e.bulk_size > 1 ? `Bulk change of ${e.bulk_size}` : undefined,
      };
    case "stage_change": {
      const interviewerChanged = s(d.to_interviewer) && d.to_interviewer !== d.from_interviewer;
      return {
        title: `Moved ${s(d.from_stage) ?? "?"} → ${s(d.to_stage) ?? "?"}`,
        note: [s(d.from_tag) ? `Had tag ${d.from_tag}` : null, d.was_rescheduled === true ? "Was rescheduled" : null, interviewerChanged ? `Interviewer: ${d.to_interviewer}` : null, e.bulk_size > 1 ? `Bulk move of ${e.bulk_size}` : null]
          .filter(Boolean)
          .join(" · ") || undefined,
      };
    }
    case "interviewer_change": {
      const from = s(d.from_interviewer);
      const to = s(d.to_interviewer);
      const title = !to ? `Interviewer removed (was ${from ?? "none"})` : !from ? `Interviewer set to ${to}` : `Interviewer changed ${from} → ${to}`;
      return { title, note: e.bulk_size > 1 ? `Bulk change of ${e.bulk_size}` : undefined };
    }
    case "export":
      return {
        title: "Included in a bulk-sender export",
        note: [s(d.file_name), typeof d.exported === "number" ? `${d.exported} candidates` : null, s(d.tags) && d.tags !== "none" ? `Tags: ${d.tags}` : null]
          .filter(Boolean)
          .join(" · "),
      };
  }
}
