import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSheet } from "@/lib/naukri/read";
import { ctcToLakhs, parseTestFile, planNewPeople, planTestResults, roleFromFileName, toNewCandidate, type FoundCandidate } from "./parse";

const csv = (text: string) => {
  const b = new TextEncoder().encode(text);
  return parseTestFile(readSheet(b.buffer as ArrayBuffer, "t.csv"));
};

const header = '"Candidate ID","Name","Mobile","Access approved","Assessment status","Percentage"\n';

describe("reading a test-results file", () => {
  it("finds the columns and cleans mobiles", () => {
    const f = csv(header + '"HTLB-1","Ravi","+91 98765 43210","Yes","Submitted","95"\n"HTLB-2","Asha","12345","Yes","Submitted","40"\n');
    expect(f.rows).toMatchObject([{ rowNumber: 2, name: "Ravi", phone: "9876543210", percentage: 95, status: "Submitted", candidateId: "HTLB-1" }]);
    expect(f.rows).toHaveLength(1);
    expect(f.errors[0]).toMatchObject({ rowNumber: 3, name: "Asha" });
  });
  it("keeps a repeated mobile once", () => {
    const f = csv(header + '"1","A","9876543210","Yes","Submitted","90"\n"2","A","9876543210","Yes","Submitted","90"\n');
    expect(f.rows).toHaveLength(1);
    expect(f.duplicatesInFile).toBe(1);
  });
  it("rejects a file without a mobile column", () => {
    expect(csv('"Name","Email"\n"A","a@x.com"\n').missingColumns).toEqual(["Mobile"]);
  });
});

describe("who moves", () => {
  const cand = (o: Partial<FoundCandidate>): FoundCandidate => ({
    id: "c", role: "ZBM", name: "X", primary_phone: "9876543210", stage_id: 1, stage_name: "Shortlisted", stage_position: 1, tag_name: "48h", ...o,
  });
  const file = csv(header + '"1","A","9876543210","Yes","Submitted","95"\n"2","B","9123456789","Yes","Submitted","30"\n"3","C","9000000001","Yes","Submitted","80"\n"4","D","9000000002","Yes","Submitted","88"\n');
  const opts = { shortlistedStageId: 1, targetStage: { id: 2, position: 2 }, passMark: null };

  it("moves Shortlisted people whatever their tag, in both roles, and leaves the rest", () => {
    const found = [
      cand({ id: "a1" }),
      cand({ id: "a2", role: "HOS", tag_name: null }), // same person in HOS → also moves
      cand({ id: "b", primary_phone: "9123456789", tag_name: "Hold" }),
      cand({ id: "c", primary_phone: "9000000001", stage_id: 4, stage_name: "1:1 Aligned", stage_position: 4 }), // already further
    ];
    const p = planTestResults(file, found, opts);
    expect(p.toMove.map((x) => x.candidate.id)).toEqual(["a1", "a2", "b"]);
    expect(p.alreadyMoved.map((x) => x.candidate.id)).toEqual(["c"]);
    expect(p.notFound.map((r) => r.name)).toEqual(["D"]);
  });

  it("applies an optional pass mark", () => {
    const p = planTestResults(file, [cand({ id: "a1" }), cand({ id: "b", primary_phone: "9123456789" })], { ...opts, passMark: 50 });
    expect(p.toMove.map((x) => x.candidate.id)).toEqual(["a1"]);
    expect(p.belowPassMark.map((x) => x.row.name)).toEqual(["B"]);
  });
});

// Your real assessment exports (only present on a machine that has them in samples/).
for (const [label, file] of [["HOS", "samples/HTLB-HOS-assessment-results.csv"], ["ZBM", "samples/HTLB-ZBM-assessment-results.csv"]] as const) {
  const p = path.resolve(__dirname, "../../..", file);
  describe.runIf(existsSync(p))(`real ${label} assessment file`, () => {
    it("reads every row with a valid mobile and a percentage", () => {
      const buf = readFileSync(p);
      const f = parseTestFile(readSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, file));
      expect(f.missingColumns).toEqual([]);
      expect(f.errors).toEqual([]);
      expect(f.rows.length).toBe(label === "HOS" ? 310 : 138);
      expect(f.rows.every((r) => /^[6-9]\d{9}$/.test(r.phone) && r.percentage !== null)).toBe(true);
    });
  });
}

describe("adding people who aren't in the tracker", () => {
  const full = '"Candidate ID","Name","Mobile","Percentage","Current City","Current CTC (₹ LPA)","Current Designation"\n';
  const f = csv(full + '"1","Sharad  Gupta","8218654588","80","Chandigarh","10.35","TSM"\n"2","Md Irshad","7777090297","100","Mumbai","3600000","Divisional Head"\n"3","","9000000003","90","","",""\n');
  it("reads city, CTC (lakhs or rupees) and designation", () => {
    expect(f.rows[0]).toMatchObject({ city: "Chandigarh", designation: "TSM", ctcLakhs: 10.35 });
    expect(f.rows[1].ctcLakhs).toBe(36);
    expect(ctcToLakhs("abc")).toBeNull();
    expect(ctcToLakhs("12 LPA")).toBe(12);
  });
  it("adds new names, holds back same names and rows without a name", () => {
    const same = [{ id: "x", name: "Md Irshad", name_norm: "md irshad", primary_phone: "9999999999", stage_name: "Shortlisted" }];
    const p = planNewPeople(f.rows, same, false);
    expect(p.toAdd.map((r) => r.name)).toEqual(["Sharad Gupta"]);
    expect(p.sameName.map((s) => s.row.name)).toEqual(["Md Irshad"]);
    expect(p.noName).toHaveLength(1);
    expect(planNewPeople(f.rows, same, true).toAdd).toHaveLength(2);
    expect(toNewCandidate(f.rows[0])).toMatchObject({ name: "Sharad Gupta", name_norm: "sharad gupta", primary_phone: "8218654588", salary_lakhs: 10.35, current_location: "Chandigarh" });
  });
  it("detects the role from the file name", () => {
    expect(roleFromFileName("HTLB-ZBM-assessment-results.csv")).toBe("ZBM");
    expect(roleFromFileName("HTLB-HOS-assessment-results (1).csv")).toBe("HOS");
    expect(roleFromFileName("results.csv")).toBeNull();
  });
});
