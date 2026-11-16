import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBulkSenderCsv, bulkSenderFileName, csvField, fileNamePart, type ExportCandidate } from "./bulk-sender";

/** The browser download encodes the string as UTF-8 exactly like TextEncoder does. */
const bytes = (csv: string) => Buffer.from(new TextEncoder().encode(csv));

const person = (name: string, phone: string | null, extra: Partial<ExportCandidate> = {}): ExportCandidate => ({
  id: name,
  name,
  primary_phone: phone,
  stage_name: "FAQ Invited",
  interviewer_name: null,
  ...extra,
});

describe("bulk-sender CSV format", () => {
  const out = buildBulkSenderCsv([person("Kaothi K C", "9962791460"), person("Sameera M", "8089405492")]);
  const b = bytes(out.csv);

  it("starts with the UTF-8 BOM and the exact header", () => {
    expect([...b.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(b.subarray(3).toString("utf8").split("\n")[0]).toBe("Name,Mobile Number,Source,Tags,booking_at");
  });

  it("writes rows as Name,91XXXXXXXXXX,ORGANIC,,", () => {
    expect(out.csv).toBe("﻿Name,Mobile Number,Source,Tags,booking_at\nKaothi K C,919962791460,ORGANIC,,\nSameera M,918089405492,ORGANIC,,\n");
  });

  it("uses LF only and ends with exactly one newline (no blank row)", () => {
    expect(b.includes(0x0d)).toBe(false);
    expect(out.csv.endsWith(",,\n")).toBe(true);
    expect(out.csv.endsWith("\n\n")).toBe(false);
  });

  it("quotes a name only when it contains a comma (or a quote)", () => {
    expect(csvField("Ravi Kumar")).toBe("Ravi Kumar");
    expect(csvField("Kumar, Ravi")).toBe('"Kumar, Ravi"');
    expect(csvField('Ravi "RK" Kumar')).toBe('"Ravi ""RK"" Kumar"');
    const csv = buildBulkSenderCsv([person("  Kumar,  Ravi ", "9876543210")]).csv;
    expect(csv.split("\n")[1]).toBe('"Kumar, Ravi",919876543210,ORGANIC,,');
  });
});

describe("bulk-sender rules", () => {
  it("skips invalid mobiles and lists them", () => {
    const out = buildBulkSenderCsv([person("A", "9876543210"), person("B", null), person("C", "12345")]);
    expect(out.includedIds).toEqual(["A"]);
    expect(out.skipped.map((s) => [s.name, s.reason])).toEqual([["B", "invalid phone"], ["C", "invalid phone"]]);
  });

  it("removes duplicate mobile numbers within one export", () => {
    const out = buildBulkSenderCsv([person("A", "9876543210"), person("A again", "+91 98765 43210")]);
    expect(out.includedIds).toEqual(["A"]);
    expect(out.skipped[0]).toMatchObject({ name: "A again", reason: "duplicate mobile" });
  });

  it("fills Tags with the stage, the interviewer, or custom text", () => {
    const c = [person("A", "9876543210", { stage_name: "1:1 Aligned", interviewer_name: "Parul" }), person("B", "9876543211", { stage_name: "1:1 Aligned" })];
    expect(buildBulkSenderCsv(c, { mode: "stage" }).csv).toContain("A,919876543210,ORGANIC,1:1 Aligned,\n");
    expect(buildBulkSenderCsv(c, { mode: "interviewer" }).csv).toContain("A,919876543210,ORGANIC,Parul,\nB,919876543211,ORGANIC,,\n");
    expect(buildBulkSenderCsv(c, { mode: "custom", customText: " ZBM-FAQ-14Nov " }).csv).toContain("B,919876543211,ORGANIC,ZBM-FAQ-14Nov,\n");
    expect(buildBulkSenderCsv(c, { mode: "custom", customText: "a,b" }).csv).toContain('ORGANIC,"a,b",\n');
  });

  it("never writes scientific notation or + / spaces in the mobile", () => {
    const line = buildBulkSenderCsv([person("A", "98765 43210")]).csv.split("\n")[1];
    expect(line).toBe("A,919876543210,ORGANIC,,");
  });
});

describe("file name", () => {
  const d = new Date("2026-11-14T06:30:00Z");
  it("is ROLE_Stage_DD-MMM-YYYY.csv", () => {
    expect(bulkSenderFileName("HOS", ["FAQ Invited", "FAQ Invited"], d)).toBe("HOS_FAQ-Invited_14-Nov-2026.csv");
    expect(bulkSenderFileName("ZBM", ["1:1 Aligned"], d)).toBe("ZBM_1-1-Aligned_14-Nov-2026.csv");
    expect(bulkSenderFileName("ZBM", ["Shortlisted", "LOI Sent"], d)).toBe("ZBM_Mixed_14-Nov-2026.csv");
  });
  it("uses the IST date (11:30 PM UTC is already the next day in India)", () => {
    expect(bulkSenderFileName("ZBM", ["LOI Sent"], new Date("2026-11-14T20:00:00Z"))).toBe("ZBM_LOI-Sent_15-Nov-2026.csv");
  });
  it("removes characters Windows does not allow", () => {
    expect(fileNamePart('JD / Test: "Cleared"?')).toBe("JD-Test-Cleared");
  });
});

// Byte-for-byte check against your real bulk-sender file (skipped if samples/ is not present).
const SAMPLE = path.resolve(__dirname, "../../../samples/bulk_sender_sample.csv");
describe.runIf(existsSync(SAMPLE))("matches samples/bulk_sender_sample.csv byte for byte", () => {
  it("rebuilds the sample file exactly from its names and numbers", () => {
    const original = readFileSync(SAMPLE);
    const rows = original.toString("utf8").replace(/^﻿/, "").split("\n").slice(1).filter(Boolean);
    const candidates = rows.map((line, i) => {
      const [name, mobile] = line.split(",");
      return person(name, mobile.slice(2), { id: String(i) });
    });
    const rebuilt = bytes(buildBulkSenderCsv(candidates).csv);
    expect(rebuilt.length).toBe(original.length);
    expect(rebuilt.equals(original)).toBe(true);
  });
});
