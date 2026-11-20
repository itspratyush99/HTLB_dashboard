/**
 * Builds the CSV for the bulk message sender. It must match samples/bulk_sender_sample.csv exactly:
 *
 *   Name,Mobile Number,Source,Tags,booking_at
 *   Kaothi K C,919962791460,ORGANIC,,
 *
 *   • UTF-8 with BOM (bytes EF BB BF first)
 *   • LF line endings; every line, including the last, ends with exactly one "\n"
 *   • Name trimmed; quoted only when it needs it (comma, double quote or line break)
 *   • Mobile Number = "91" + 10-digit mobile, digits only
 *   • Source = ORGANIC, booking_at = empty, Tags = empty unless chosen in the export dialog
 *   • Candidates without a valid 10-digit mobile are skipped and listed
 *   • The same mobile number appears only once
 */
import { formatInTimeZone } from "date-fns-tz";
import { IST } from "@/lib/dates";
import { toIndianMobile } from "@/lib/naukri/clean";

export const BULK_SENDER_HEADER = ["Name", "Mobile Number", "Source", "Tags", "booking_at"] as const;
export const UTF8_BOM = "﻿";

export type TagMode = "none" | "stage" | "interviewer" | "custom";

export interface ExportCandidate {
  id: string;
  name: string;
  primary_phone: string | null;
  stage_name: string | null;
  interviewer_name: string | null;
}

export interface SkippedCandidate {
  id: string;
  name: string;
  reason: "invalid phone" | "duplicate mobile";
  detail: string;
}

export interface BulkSenderExport {
  csv: string; // includes the BOM
  includedIds: string[];
  skipped: SkippedCandidate[];
}

/** Quote a value only if CSV requires it; inner quotes are doubled. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildBulkSenderCsv(
  candidates: ExportCandidate[],
  tags: { mode: TagMode; customText?: string } = { mode: "none" },
): BulkSenderExport {
  const lines = [BULK_SENDER_HEADER.join(",")];
  const includedIds: string[] = [];
  const skipped: SkippedCandidate[] = [];
  const seenMobiles = new Map<string, string>(); // mobile → name of the first candidate with it

  for (const c of candidates) {
    const name = c.name.replace(/\s+/g, " ").trim();
    const mobile = c.primary_phone ? toIndianMobile(c.primary_phone) : null;
    if (!mobile) {
      skipped.push({ id: c.id, name, reason: "invalid phone", detail: c.primary_phone || "no mobile number" });
      continue;
    }
    const firstWithMobile = seenMobiles.get(mobile);
    if (firstWithMobile !== undefined) {
      skipped.push({ id: c.id, name, reason: "duplicate mobile", detail: `same mobile as ${firstWithMobile}` });
      continue;
    }
    seenMobiles.set(mobile, name);

    const tag =
      tags.mode === "stage"
        ? c.stage_name ?? ""
        : tags.mode === "interviewer"
          ? c.interviewer_name ?? ""
          : tags.mode === "custom"
            ? (tags.customText ?? "").trim()
            : "";

    lines.push([csvField(name), `91${mobile}`, "ORGANIC", csvField(tag), ""].join(","));
    includedIds.push(c.id);
  }

  return { csv: UTF8_BOM + lines.map((l) => `${l}\n`).join(""), includedIds, skipped };
}

/** Makes a stage name safe for a file name on Windows/Mac: "1:1 Aligned" → "1-1-Aligned". */
export function fileNamePart(text: string): string {
  return text
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * <ROLE>_<Stage>_<DD-MMM-YYYY>.csv, e.g. HOS_FAQ-Invited_14-Nov-2026.csv.
 * When the exported candidates are in different stages, the stage part is "Mixed".
 * For one Shortlisted tag group the tag is added: ZBM_Shortlisted-48h_19-Nov-2026.csv
 * (`tags` has one entry per candidate: its tag name, "No tag", or null when not in Shortlisted).
 */
export function bulkSenderFileName(role: string, stageNames: (string | null)[], date: Date = new Date(), tags?: (string | null)[]): string {
  const distinct = [...new Set(stageNames.filter(Boolean))] as string[];
  let stage = distinct.length === 1 ? fileNamePart(distinct[0]) : "Mixed";
  const tagSet = new Set(tags ?? []);
  if (distinct.length === 1 && tags?.length && tagSet.size === 1 && !tagSet.has(null)) stage += `-${fileNamePart(String(tags[0]))}`;
  return `${role}_${stage}_${formatInTimeZone(date, IST, "dd-MMM-yyyy")}.csv`;
}
