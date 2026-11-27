import { describe, expect, it } from "vitest";
import { readSheet } from "@/lib/naukri/read";
import { interviewerFromFileName, parseBookingTime, parseInterviewFile, planInterviewList, toNewInterviewCandidate, type FoundPerson } from "./parse";

const csv = (text: string) => parseInterviewFile(readSheet(new TextEncoder().encode(text).buffer as ArrayBuffer, "t.csv"));
const ist = (s: string) => new Date(s + "+05:30").toISOString();

describe("booking times", () => {
  it.each([
    ["2026-11-27 15:00", "2026-11-27T15:00"],
    ["2026-11-27T15:00:00+05:30", "2026-11-27T15:00"],
    ["27/11/2026 3:00 PM", "2026-11-27T15:00"],
    ["27-11-2026 15:30", "2026-11-27T15:30"],
    ["27 Nov 2026, 3:00 pm", "2026-11-27T15:00"],
    ["Nov 27, 2026 11:00 AM", "2026-11-27T11:00"],
    ["Friday, 27 November 2026 at 12:00 PM (IST)", "2026-11-27T12:00"],
    ["11/27/2026 10:00", "2026-11-27T10:00"],
    ["27/11/2026", "2026-11-27T00:00"],
  ])("%s", (text, want) => expect(parseBookingTime(text)).toBe(ist(want)));
  it("reads UTC times and Excel dates, rejects junk", () => {
    expect(parseBookingTime("2026-11-27T09:30:00Z")).toBe(ist("2026-11-27T15:00"));
    expect(parseBookingTime(46353.625)).toBe(ist("2026-11-27T15:00"));
    expect(parseBookingTime("soon")).toBeNull();
    expect(parseBookingTime("31/31/2026")).toBeNull();
  });
});

describe("reading a booking export", () => {
  it("finds columns with booking-tool names and keeps the latest booking per mobile", () => {
    const f = csv('Invitee Name,Invitee Email,Phone Number,Start Time,Event Type\nRavi Kumar,ravi@x.com,+91 98765 43210,27/11/2026 3:00 PM,1:1 Parul\nRavi Kumar,,9876543210,28/11/2026 11:00 AM,1:1 Parul\nAsha,,12345,27/11/2026 4:00 PM,1:1 Parul\n');
    expect(f.columns).toMatchObject({ name: "Invitee Name", mobile: "Phone Number", email: "Invitee Email", when: "Start Time" });
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ name: "Ravi Kumar", phone: "9876543210", email: "ravi@x.com", when: ist("2026-11-28T11:00") });
    expect(f.duplicatesInFile).toBe(1);
    expect(f.errors).toHaveLength(1);
  });
  it("reads the Bulk Sender CSV and separate date + time columns", () => {
    expect(csv("Name,Mobile Number,Source,Tags,booking_at\nRavi,919876543210,ORGANIC,,2026-11-27 15:00\n").rows[0]).toMatchObject({ phone: "9876543210", when: ist("2026-11-27T15:00") });
    expect(csv("Name,Mobile,Date,Time\nRavi,9876543210,27/11/2026,3:00 PM\n").rows[0].when).toBe(ist("2026-11-27T15:00"));
  });
  it("needs a mobile column", () => {
    expect(csv("Name,Email\nA,a@x.com\n").missingColumns).toEqual(["Mobile"]);
  });
  it("spots the interviewer in the file name", () => {
    const iv = [{ id: 1, name: "Parul" }, { id: 2, name: "Umer" }];
    expect(interviewerFromFileName("parul_bookings_nov.csv", iv)?.id).toBe(1);
    expect(interviewerFromFileName("bookings.csv", iv)).toBeNull();
  });
});

describe("who goes where", () => {
  const p = (o: Partial<FoundPerson>): FoundPerson => ({
    id: "x", role: "ZBM", name: "X", primary_phone: "9000000001", stage_id: 2, stage_name: "Test Cleared", stage_position: 2,
    interviewer_id: null, interviewer_name: null, interview_at: null, ...o,
  });
  const file = csv("Name,Mobile,Start Time\nA,9000000001,27/11/2026 3:00 PM\nB,9000000002,27/11/2026 4:00 PM\nC,9000000003,\nD,9000000004,27/11/2026 5:00 PM\nE,9000000005,\n");
  const found = [
    p({ id: "a" }), // Test Cleared → assign
    p({ id: "a2", role: "HOS" }), // same person in HOS → also assigned
    p({ id: "b", primary_phone: "9000000002", stage_id: 4, stage_position: 4, interviewer_id: 7, interview_at: ist("2026-11-26T10:00") }), // with Umer
    p({ id: "c", primary_phone: "9000000003", stage_id: 4, stage_position: 4, interviewer_id: 3 }), // already Parul
    p({ id: "d", primary_phone: "9000000004", stage_id: 6, stage_position: 6 }), // further along
  ];
  const plan = planInterviewList(file, found, { oneToOne: { id: 4, position: 4 }, interviewerId: 3 });
  it("sorts people", () => {
    expect(plan.toAssign.map((x) => x.candidate.id)).toEqual(["a", "a2"]);
    expect(plan.otherInterviewer.map((x) => x.candidate.id)).toEqual(["b"]);
    expect(plan.already.map((x) => x.candidate.id)).toEqual(["c"]);
    expect(plan.further.map((x) => x.candidate.id)).toEqual(["d"]);
    expect(plan.notFound.map((r) => r.phone)).toEqual(["9000000005"]);
    expect(plan.timeChanged.map((x) => x.candidate.id)).toEqual(["b"]);
  });
  it("builds new candidates", () => {
    expect(toNewInterviewCandidate(file.rows[0])).toMatchObject({ name: "A", name_norm: "a", primary_phone: "9000000001", interview_at: ist("2026-11-27T15:00") });
  });
});
