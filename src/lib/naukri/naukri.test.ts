import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  cleanText,
  parseAnswer,
  parseDate,
  parseEmails,
  parseExperienceMonths,
  parsePhones,
  parseSalaryLakhs,
  safeUrl,
} from "./clean";
import { classifyRows, type DedupeKey, type ExistingCandidate } from "./dedupe";
import { parseNaukriRows } from "./parse";
import { readSheet } from "./read";
import { DEFAULT_ROLE_KEYWORDS, detectRole } from "./roles";

describe("cleaning rules", () => {
  it("treats NA-style placeholders as empty", () => {
    expect(cleanText(" NA ")).toBeNull();
    expect(cleanText("n/a")).toBeNull();
    expect(cleanText("  ICICI   Bank ")).toBe("ICICI Bank");
  });

  it("reads Naukri dates and other common formats", () => {
    expect(parseDate("09-Nov-2026")).toBe("2026-11-09");
    expect(parseDate("25 Oct 2026")).toBe("2026-10-25");
    expect(parseDate("05/02/1999")).toBe("1999-02-05"); // day first
    expect(parseDate("2026-11-09")).toBe("2026-11-09");
    expect(parseDate(46335)).toBe("2026-11-09"); // Excel date serial
    expect(parseDate("NA")).toBeNull();
    expect(parseDate("31-Feb-2026")).toBeUndefined();
    expect(parseDate("someday")).toBeUndefined();
  });

  it("splits phone numbers and finds the first valid Indian mobile", () => {
    expect(parsePhones("8454089323, +400604")).toMatchObject({ primary: "8454089323", alternate: "+400604" });
    expect(parsePhones("919962791460")).toMatchObject({ primary: "9962791460", alternate: null });
    expect(parsePhones("+91 99627 91460")).toMatchObject({ primary: "9962791460" });
    expect(parsePhones("09962791460")).toMatchObject({ primary: "9962791460" });
    expect(parsePhones("12345, 9962791460")).toMatchObject({ primary: "9962791460", alternate: "12345" });
    expect(parsePhones(9876543210)).toMatchObject({ primary: "9876543210" }); // stored as a number
    expect(parsePhones("9.876543210E+09")).toMatchObject({ primary: "9876543210", damaged: false });
    expect(parsePhones("9.87E+09")).toMatchObject({ primary: null, damaged: true }); // digits lost
    expect(parsePhones("NA")).toMatchObject({ primary: null, raw: null });
  });

  it("converts experience to months", () => {
    expect(parseExperienceMonths("3 Year(s) 6 Month(s)")).toBe(42);
    expect(parseExperienceMonths("10 Year(s) 0 Month(s)")).toBe(120);
    expect(parseExperienceMonths("Fresher")).toBe(0);
    expect(parseExperienceMonths("NA")).toBeNull();
  });

  it("converts salary to INR lakhs, ignoring a wrong currency label", () => {
    expect(parseSalaryLakhs("Rs 15.90 Lakhs")).toBe(15.9);
    expect(parseSalaryLakhs("Rs 15 Lakhs")).toBe(15);
    expect(parseSalaryLakhs("USD 9.5 Lakhs")).toBe(9.5);
    expect(parseSalaryLakhs("Rs 1.2 Crore")).toBe(120);
    expect(parseSalaryLakhs("1500000")).toBe(15);
    expect(parseSalaryLakhs("NA")).toBeNull();
  });

  it("keeps answer text and extracts the leading number", () => {
    expect(parseAnswer("9.5 years")).toEqual({ t: "9.5 years", n: 9.5 });
    expect(parseAnswer("Yes")).toEqual({ t: "Yes", n: null });
    expect(parseAnswer("2 ")).toEqual({ t: "2", n: 2 });
    expect(parseAnswer("")).toEqual({ t: null, n: null });
  });

  it("splits a cell with two emails into main + alternate", () => {
    expect(parseEmails("a@x.com, b@y.com")).toEqual({ primary: "a@x.com", alternate: "b@y.com", invalid: null });
    expect(parseEmails("A@x.com, a@X.com")).toEqual({ primary: "A@x.com", alternate: null, invalid: null });
    expect(parseEmails("not-an-email")).toEqual({ primary: null, alternate: null, invalid: "not-an-email" });
    expect(parseEmails("NA")).toEqual({ primary: null, alternate: null, invalid: null });
  });

  it("only keeps web links", () => {
    expect(safeUrl("https://hiring.naukri.com/x")).toBe("https://hiring.naukri.com/x");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("role detection", () => {
  const rules = DEFAULT_ROLE_KEYWORDS;
  it("matches phrases anywhere, ignoring case", () => {
    expect(detectRole("Zonal Business Manager (CTC 24 lac p.a)", rules).role).toBe("ZBM");
    expect(detectRole("HEAD OF STATES - Sales", rules).role).toBe("HOS");
  });
  it("matches ZBM / HOS only as whole words", () => {
    expect(detectRole("HOS - Mumbai", rules).role).toBe("HOS");
    expect(detectRole("ZBM(Gujarat)", rules).role).toBe("ZBM");
    expect(detectRole("Hospital Sales Manager", rules)).toEqual({ role: null, problem: "none" });
  });
  it("flags titles that match both roles", () => {
    expect(detectRole("ZBM / HOS combined opening", rules)).toEqual({ role: null, problem: "ambiguous" });
  });
});

describe("duplicate rules", () => {
  const existing: ExistingCandidate[] = [
    { id: "a", role: "ZBM", name: "Ravi Kumar", name_norm: "ravi kumar", email_norm: "ravi@x.com", primary_phone: "9876543210", stage_name: "FAQ Invited", created_at: "" },
  ];
  const key = (o: Partial<DedupeKey>): DedupeKey => ({
    role: "ZBM", name: "Ravi Kumar", name_norm: "ravi kumar", email_norm: "ravi@x.com", primary_phone: "9876543210", rowNumber: 2, ...o,
  });

  it("skips exact duplicates (name + phone + email)", () => {
    expect(classifyRows([key({})], existing)[0].kind).toBe("exact");
  });
  it("flags phone-or-email matches as possible duplicates", () => {
    expect(classifyRows([key({ name_norm: "ravi k" })], existing)[0].kind).toBe("possible");
    expect(classifyRows([key({ primary_phone: "9000000000" })], existing)[0].kind).toBe("possible");
  });
  it("completes people added from a test file (same role + mobile) instead of flagging them", () => {
    const tf: ExistingCandidate = { id: "t", role: "ZBM", name: "Sharad Gupta", name_norm: "sharad gupta", email_norm: null, primary_phone: "8218654588", stage_name: "JD Cleared", created_at: "", origin: "test_file" };
    const rows = [key({ name_norm: "sharad kumar gupta", email_norm: "s@x.com", primary_phone: "8218654588" }), key({ name_norm: "sharad kumar gupta", email_norm: "s@x.com", primary_phone: "8218654588", rowNumber: 3 })];
    const out = classifyRows(rows, [tf]);
    expect(out[0]).toEqual({ kind: "complete", candidate: tf });
    expect(out[1].kind).toBe("exact"); // listed twice: completed once, the repeat is skipped
    expect(classifyRows([key({ role: "HOS", primary_phone: "8218654588" })], [tf])[0].kind).toBe("new"); // other role
  });
  it("checks each role separately", () => {
    expect(classifyRows([key({ role: "HOS" })], existing)[0].kind).toBe("new");
  });
  it("catches the same person listed twice in one file", () => {
    const rows = [key({ email_norm: "new@x.com", primary_phone: "9111111111" }), key({ email_norm: "new@x.com", primary_phone: "9111111111", rowNumber: 3 })];
    expect(classifyRows(rows, []).map((c) => c.kind)).toEqual(["new", "exact"]);
  });
});

describe("CSV input", () => {
  it("handles a UTF-8 BOM, phone numbers in scientific notation and blank rows", () => {
    const csv = "﻿Job Title,Name,Email ID,Phone Number,Date of application\n" +
      "Head of States,Asha Rao,asha@x.com,9.876543210E+09,09-Nov-2026\n" +
      ",,,,\n" +
      "Something else,No Contact,NA,12345,09-Nov-2026\n";
    const bytes = new TextEncoder().encode(csv);
    const result = parseNaukriRows(readSheet(bytes.buffer as ArrayBuffer, "x.csv"), DEFAULT_ROLE_KEYWORDS);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].candidate).toMatchObject({ role: "HOS", primary_phone: "9876543210", applied_on: "2026-11-09" });
    expect(result.emptyRowsSkipped).toBe(1);
    expect(result.errors).toEqual([{ rowNumber: 4, name: "No Contact", message: "No valid mobile number and no email" }]);
  });

  it("rejects a file that is not a Naukri export", () => {
    const bytes = new TextEncoder().encode("Foo,Bar\n1,2\n");
    expect(parseNaukriRows(readSheet(bytes.buffer as ArrayBuffer, "x.csv"), DEFAULT_ROLE_KEYWORDS).missingColumns).toContain("name");
  });
});

// Runs only when your real sample is present (samples/ is not committed to git).
const SAMPLE = path.resolve(__dirname, "../../../samples/naukri_sample.xlsx");
describe.runIf(existsSync(SAMPLE))("real Naukri sample", () => {
  // Read lazily: the describe body runs even when the sample is missing (and the tests are skipped).
  const load = () => {
    const buf = readFileSync(SAMPLE);
    return parseNaukriRows(
      readSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "naukri_sample.xlsx"),
      DEFAULT_ROLE_KEYWORDS,
    );
  };
  let cached: ReturnType<typeof load> | null = null;
  const result = new Proxy({} as ReturnType<typeof load>, { get: (_t, key) => (cached ??= load())[key as keyof ReturnType<typeof load>] });

  it("reads all 62 candidates as ZBM with no errors or warnings", () => {
    expect(result.rows.flatMap((r) => r.warnings)).toEqual([]);
    expect(result.missingColumns).toEqual([]);
    expect(result.unknownColumns).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(62);
    expect(result.rows.every((r) => r.candidate.role === "ZBM")).toBe(true);
  });

  it("extracts every profile link, phone, date, salary and experience", () => {
    const c = result.rows.map((r) => r.candidate);
    expect(c.every((x) => x.profile_url?.startsWith("https://hiring.naukri.com/"))).toBe(true);
    expect(c.every((x) => /^[6-9]\d{9}$/.test(x.primary_phone ?? ""))).toBe(true);
    expect(c.filter((x) => x.alternate_phone).length).toBe(11);
    expect(c.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.applied_on ?? ""))).toBe(true);
    expect(c.filter((x) => x.salary_lakhs === null).length).toBe(1); // the one "NA"
    expect(c.every((x) => x.total_exp_months !== null)).toBe(true);
    expect(c.filter((x) => x.current_company === null).length).toBe(13); // "NA" → empty
    expect(c.filter((x) => x.dob === null).length).toBe(1);
    // 9 cells hold two emails; 5 of them repeat the same address, so 4 real alternates.
    expect(c.filter((x) => x.alternate_email).length).toBe(4);
    expect(c.every((x) => x.email && !x.email.includes(","))).toBe(true);
  });

  it("finds the 4 screening questions and which are numeric", () => {
    expect(result.questions.map((q) => q.question)).toEqual([
      "How many years of experience do you have in Sales?",
      "How many years of experience do you have in Stock Broking?",
      "How many years of experience do you have in Stock Market?",
      "What is your current CTC in Lacs per annum?",
    ]);
    expect(result.questions.every((q) => q.is_numeric)).toBe(true);
  });

  it("keeps the full original row", () => {
    expect(Object.keys(result.rows[0].candidate.raw)).toHaveLength(37); // 36 columns + profile link
  });

  it("re-uploading the same file gives only exact duplicates", () => {
    const keys = result.rows.map((r) => ({ ...r.candidate, role: r.candidate.role!, rowNumber: r.rowNumber }));
    const asExisting = keys.map((k, i) => ({ ...k, id: String(i), stage_name: "Shortlisted", created_at: "" }));
    expect(classifyRows(keys, asExisting).every((c) => c.kind === "exact")).toBe(true);
  });
});

// Keep the XLSX import used so the test file also confirms the library loads in Node.
it("SheetJS loads", () => expect(typeof XLSX.read).toBe("function"));

// ---------------------------------------------------------------- plan (preview decisions → import request)
import { buildPlan, toImportRequest } from "./plan";

describe("upload plan", () => {
  const csv =
    "Job Title,Name,Email ID,Phone Number\n" +
    "Zonal Business Manager (CTC 24 lac p.a),Ravi Kumar,ravi@x.com,9876543210\n" + // exact dup of saved candidate
    "Zonal Business Manager,Ravi K,ravi2@x.com,9876543210\n" + // possible dup (same phone)
    "Head of States,Asha Rao,asha@x.com,9123456789\n" + // new HOS
    "Regional Sales Lead,Meera Shah,meera@x.com,9988776655\n"; // unassigned
  const bytes = new TextEncoder().encode(csv);
  const parse = parseNaukriRows(readSheet(bytes.buffer as ArrayBuffer, "x.csv"), DEFAULT_ROLE_KEYWORDS);
  const existing: ExistingCandidate[] = [
    { id: "a", role: "ZBM", name: "Ravi Kumar", name_norm: "ravi kumar", email_norm: "ravi@x.com", primary_phone: "9876543210", stage_name: "FAQ Invited", created_at: "2026-11-01T00:00:00Z" },
  ];

  it("defaults: possible duplicates and unassigned rows are skipped", () => {
    const plan = buildPlan(parse, existing, {}, {});
    expect(plan.exactRows).toHaveLength(1);
    expect(plan.possibleRows).toHaveLength(1);
    expect(plan.unassignedRows).toHaveLength(1);
    expect(plan.toImport.map((r) => r.parsed.candidate.name)).toEqual(["Asha Rao"]);
  });

  it("applies the user's choices", () => {
    const plan = buildPlan(parse, existing, { 5: "ZBM" }, { 3: "add" });
    expect(plan.toImport.map((r) => `${r.role}:${r.parsed.candidate.name}`)).toEqual(["ZBM:Ravi K", "HOS:Asha Rao", "ZBM:Meera Shah"]);
    const req = toImportRequest(plan, parse, { name: "x.csv", size: 1 }, { 3: "add" });
    expect(req.counts).toMatchObject({ total_rows: 4, zbm_rows: 3, hos_rows: 1, duplicates_skipped: 1, flagged_count: 1, flagged_added: 1, flagged_skipped: 0, unassigned_count: 1 });
    expect(req.flagged[0].matched[0]).toMatchObject({ id: "a", stage: "FAQ Invited" });
    expect(req.unassigned).toEqual([{ row: 5, name: "Meera Shah", job_title: "Regional Sales Lead", decision: "ZBM" }]);
  });
});
