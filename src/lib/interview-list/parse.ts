/**
 * Interviewer-list upload: a booking / calendar export (CSV or Excel) of everyone aligned with one
 * interviewer. Each person is found in the tracker by mobile and moved to 1:1 Aligned with that
 * interviewer; people not in the tracker can be added. A booking date/time column, if present,
 * is saved as the 1:1 date.
 *
 * Booking tools name their columns differently, so columns are found by name patterns.
 * Pure functions: no database, so they can be unit-tested.
 */
import { normaliseEmail, normaliseName, parseEmails, parsePhones, plainText, type CellValue } from "@/lib/naukri/clean";
import type { SheetData } from "@/lib/naukri/read";
import type { Role } from "@/lib/naukri/types";

export interface ListRow {
  rowNumber: number;
  name: string | null;
  phone: string | null; // 10-digit mobile, if the file has one
  nameNorm: string | null;
  emailNorm: string | null;
  email: string | null;
  whenText: string | null; // booking time as written in the file
  when: string | null; // ISO time (India time when the file has no time zone), or null if unreadable
  raw: Record<string, string | null>;
}

export interface ListFile {
  rows: ListRow[];
  errors: { rowNumber: number; name: string | null; message: string }[];
  duplicatesInFile: number; // same person listed again: the latest booking is kept
  missingColumns: string[];
  columns: { mobile?: string; name?: string; email?: string; when?: string; date?: string; time?: string };
}

const norm = (h: string) => h.toLowerCase().replace(/[_\s]+/g, " ").trim();
const find = (headers: string[], tests: RegExp[], not: string[] = []) => {
  for (const t of tests) {
    const h = headers.find((x) => t.test(norm(x)) && !not.includes(x));
    if (h) return h;
  }
  return undefined;
};

export function parseInterviewFile(sheet: SheetData): ListFile {
  const h = sheet.headers;
  const mobile = find(h, [/^mobile( number| no\.?)?$/, /^phone( number| no\.?)?$/, /(invitee|attendee|candidate|guest|participant).*(phone|mobile)/, /mobile/, /phone/, /whatsapp/, /contact( number| no\.?)?$/]);
  const email = find(h, [/^e-?mail( id| address)?$/, /(invitee|attendee|candidate|guest|participant) e-?mail/, /e-?mail/], [mobile ?? ""]);
  const name = find(
    h,
    [/^name$/, /^(invitee|attendee|candidate|guest|customer|client|participant|student|applicant) name$/, /full name/, /^(candidate|invitee|attendee|participant|guest|applicant|student)$/, /name/],
    [mobile ?? "", email ?? ""],
  );
  // One date+time column, or separate date and time columns.
  let when = find(h, [/^booking at$/, /^booked? (at|for)$/, /start (date )?time/, /^start$/, /scheduled (at|for|time|on)/, /(event|meeting|interview|appointment|session|slot) (start|time|date)/, /date ?time/, /^slot$/]);
  // "Session Date" + "Session Time": a date-only column is combined with the time column.
  if (when && /date$/.test(norm(when)) && !/date ?time/.test(norm(when)) && find(h, [/time$/], [when])) when = undefined;
  const date = when ? undefined : find(h, [/^(booking |meeting |interview |event |appointment |session )?date$/, /date/], [mobile ?? "", name ?? "", email ?? ""]);
  const time = when ? undefined : find(h, [/^(booking |meeting |interview |event |session |appointment |slot |start )?time$/, /time$/, /start/], [mobile ?? "", name ?? "", date ?? ""]);
  const columns = { mobile, name, email, when, date, time };
  if (!mobile && !name && !email) return { rows: [], errors: [], duplicatesInFile: 0, missingColumns: ["Name / Mobile / Email"], columns };

  const errors: ListFile["errors"] = [];
  const byKey = new Map<string, ListRow>();
  let duplicates = 0;
  sheet.rows.forEach((r) => {
    const v = (c?: string): CellValue => (c ? r.values[c] : null);
    const rowName = plainText(v(name));
    const phone = parsePhones(v(mobile)).primary;
    const rowEmail = parseEmails(v(email)).primary;
    const nameNorm = rowName ? normaliseName(rowName) || null : null;
    const emailNorm = normaliseEmail(rowEmail);
    if (!nameNorm && !phone && !emailNorm) {
      if (Object.values(r.values).some((x) => plainText(x))) errors.push({ rowNumber: r.rowNumber, name: rowName, message: "No name, valid mobile or email" });
      return;
    }
    const whenValue: CellValue = when ? v(when) : date ? combineDateTime(v(date), v(time)) : null;
    const row: ListRow = {
      rowNumber: r.rowNumber,
      name: rowName,
      phone,
      email: rowEmail,
      nameNorm,
      emailNorm,
      whenText: plainText(whenValue),
      when: parseBookingTime(whenValue),
      raw: Object.fromEntries(h.map((k) => [k, plainText(r.values[k])])),
    };
    const key = phone ? `p:${phone}` : emailNorm ? `e:${emailNorm}` : `n:${nameNorm}`;
    const prev = byKey.get(key);
    if (prev) {
      duplicates++;
      // Keep the latest booking (a rebooked slot usually appears again).
      if (!prev.when || (row.when && row.when > prev.when)) byKey.set(key, { ...row, name: row.name ?? prev.name, nameNorm: row.nameNorm ?? prev.nameNorm, email: row.email ?? prev.email, emailNorm: row.emailNorm ?? prev.emailNorm });
    } else byKey.set(key, row);
  });
  return { rows: [...byKey.values()], errors, duplicatesInFile: duplicates, missingColumns: [], columns };
}

/** "rahul kumar sharma" → "rahul sharma" (first + last word), for similar-name matches. */
export function nameKey(nameNorm: string | null): string | null {
  if (!nameNorm) return null;
  const w = nameNorm.split(" ").filter(Boolean);
  return w.length ? `${w[0]} ${w[w.length - 1]}` : null;
}

function combineDateTime(d: CellValue, t: CellValue): CellValue {
  if (d === null || d === undefined || d === "") return null;
  if (typeof d === "number") return typeof t === "number" ? Math.floor(d) + (t % 1) : t ? `${excelToText(d)} ${plainText(t)}` : d;
  return t === null || t === undefined || t === "" ? d : `${d} ${typeof t === "number" ? excelTimeText(t) : t}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Excel serial day number → "YYYY-MM-DD HH:MM" (wall time). */
function excelToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function excelTimeText(fraction: number): string {
  const mins = Math.round((fraction % 1) * 1440);
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/**
 * Reads the booking times booking tools use, e.g.
 * "2026-11-27 15:00", "2026-11-27T15:00:00+05:30", "27/11/2026 3:00 PM", "27-11-2026 15:00",
 * "27 Nov 2026, 3:00 pm", "Nov 27, 2026 3:00 PM", "Friday, 27 November 2026 15:00", or an Excel date.
 * Day comes before month (Indian format). Times without a zone are India time (+05:30).
 */
export function parseBookingTime(value: CellValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value > 20000 && value < 80000 ? parseBookingTime(excelToText(value)) : null;
  let s = String(value).trim().replace(/\s+/g, " ");
  if (!s) return null;

  // Has its own time zone (ISO with Z or offset) → trust it.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s.replace(" ", "T").replace(/\s+/, ""));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  s = s.replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*/i, "").replace(/\s*\((ist|gmt[^)]*|india[^)]*)\)|\s+ist\b/i, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();

  let y: number, mo: number, d: number, rest: string;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T ]?(.*)$/);
  if (m) [y, mo, d, rest] = [+m[1], +m[2], +m[3], m[4]];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\s*(.*)$/))) {
    [d, mo, y, rest] = [+m[1], +m[2], +m[3], m[4]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // clearly month/day
  } else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3})[a-z]* (\d{4})\s*(.*)$/i))) {
    [d, mo, y, rest] = [+m[1], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[3], m[4]];
  } else if ((m = s.match(/^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)? (\d{4})\s*(.*)$/i))) {
    [mo, d, y, rest] = [MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2], +m[3], m[4]];
  } else return null;
  if (y < 100) y += 2000;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;

  let hh = 0, mm = 0;
  rest = rest.replace(/^(at|@|-)\s*/i, "").trim();
  if (rest) {
    const t = rest.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*(am|pm|a\.m\.|p\.m\.)?/i);
    if (!t) return null;
    hh = +t[1];
    mm = t[2] ? +t[2] : 0;
    const ap = t[3]?.toLowerCase().replace(/\./g, "");
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
  }
  const iso = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+05:30`;
  const out = new Date(iso);
  return isNaN(out.getTime()) || out.getUTCDate() === undefined ? null : out.toISOString();
}

/** Interviewer named in the file name, e.g. "Parul_bookings_Nov.csv" → Parul. */
export function interviewerFromFileName<T extends { id: number; name: string }>(fileName: string, interviewers: T[]): T | null {
  const f = fileName.toLowerCase();
  const hits = interviewers.filter((i) => i.name.trim() && f.includes(i.name.trim().toLowerCase().split(" ")[0]));
  return hits.length === 1 ? hits[0] : null;
}

/** A saved candidate found by name / mobile / email (from find_candidates_for_list). */
export interface FoundPerson {
  id: string;
  role: Role;
  name: string;
  name_norm?: string | null;
  name_key?: string | null;
  email_norm?: string | null;
  primary_phone: string | null;
  stage_id: number;
  stage_name: string;
  stage_position: number;
  interviewer_id: number | null;
  interviewer_name: string | null;
  interview_at: string | null;
}

export type MatchedBy = "name" | "mobile" | "email" | "similar name";
export type Pair = { row: ListRow; candidate: FoundPerson; matchedBy: MatchedBy };
export interface ListPlan {
  toAssign: Pair[]; // moves to 1:1 Aligned with the chosen interviewer
  otherInterviewer: Pair[]; // already in 1:1 Aligned with someone else → only if ticked
  already: Pair[]; // already in 1:1 Aligned with this interviewer
  further: Pair[]; // past 1:1 Aligned → not changed
  similar: Pair[]; // only a similar name matched (e.g. middle name missing) → counted only if ticked
  ambiguous: { row: ListRow; matches: FoundPerson[] }[]; // more than one person with that name, nothing else to tell them apart
  notFound: ListRow[]; // not in the tracker (can be added when the file has their mobile)
  timeChanged: Pair[]; // in 1:1 already, with a different booking time saved → can be marked Rescheduled
}

/**
 * Finds each row in the tracker: by name first, then mobile, then email, then a similar name.
 * A person may be in both ZBM and HOS: one match per role is used, so they're handled in both.
 * When a name fits several people in the same role, the mobile / email picks the right one;
 * if that can't decide, the row is listed as "more than one match" and nothing changes.
 */
export function matchRow(row: ListRow, found: FoundPerson[]): { pairs: Pair[]; ambiguous: FoundPerson[] | null; similar: boolean } {
  const tieBreak = (list: FoundPerson[]) => {
    const byPhone = row.phone ? list.filter((c) => c.primary_phone === row.phone) : [];
    if (byPhone.length) return byPhone;
    const byEmail = row.emailNorm ? list.filter((c) => c.email_norm === row.emailNorm) : [];
    return byEmail.length ? byEmail : list;
  };
  const perRole = (list: FoundPerson[], by: MatchedBy) => {
    const pairs: Pair[] = [];
    let ambiguous: FoundPerson[] | null = null;
    for (const role of ["ZBM", "HOS"] as const) {
      const inRole = tieBreak(list.filter((c) => c.role === role));
      if (inRole.length === 1) pairs.push({ row, candidate: inRole[0], matchedBy: by });
      else if (inRole.length > 1) ambiguous = [...(ambiguous ?? []), ...inRole];
    }
    return { pairs, ambiguous };
  };
  const tries: [FoundPerson[], MatchedBy][] = [
    [row.nameNorm ? found.filter((c) => c.name_norm === row.nameNorm) : [], "name"],
    [row.phone ? found.filter((c) => c.primary_phone === row.phone) : [], "mobile"],
    [row.emailNorm ? found.filter((c) => c.email_norm === row.emailNorm) : [], "email"],
  ];
  for (const [list, by] of tries) {
    if (!list.length) continue;
    const r = perRole(list, by);
    if (r.pairs.length || r.ambiguous) return { pairs: r.pairs, ambiguous: r.pairs.length ? null : r.ambiguous, similar: false };
  }
  const key = nameKey(row.nameNorm);
  const similar = key ? found.filter((c) => c.name_key === key) : [];
  if (similar.length) {
    const r = perRole(similar, "similar name");
    return { pairs: r.pairs, ambiguous: r.pairs.length ? null : r.ambiguous, similar: true };
  }
  return { pairs: [], ambiguous: null, similar: false };
}

/** Who goes where. Booking times are compared to the minute. */
export function planInterviewList(
  file: ListFile,
  found: FoundPerson[],
  opts: { oneToOne: { id: number; position: number }; interviewerId: number; includeSimilar?: boolean },
): ListPlan {
  const plan: ListPlan = { toAssign: [], otherInterviewer: [], already: [], further: [], similar: [], ambiguous: [], notFound: [], timeChanged: [] };
  const minute = (t: string | null) => (t ? Math.floor(new Date(t).getTime() / 60000) : null);
  for (const row of file.rows) {
    const m = matchRow(row, found);
    if (m.ambiguous) {
      plan.ambiguous.push({ row, matches: m.ambiguous });
      continue;
    }
    if (!m.pairs.length) {
      plan.notFound.push(row);
      continue;
    }
    if (m.similar) {
      plan.similar.push(...m.pairs);
      if (!opts.includeSimilar) continue;
    }
    for (const pair of m.pairs) {
      const c = pair.candidate;
      const inOne = c.stage_id === opts.oneToOne.id;
      if (c.stage_position > opts.oneToOne.position) plan.further.push(pair);
      else if (inOne && c.interviewer_id === opts.interviewerId) plan.already.push(pair);
      else if (inOne && c.interviewer_id !== null) plan.otherInterviewer.push(pair);
      else plan.toAssign.push(pair);
      if (inOne && row.when && c.interview_at && minute(row.when) !== minute(c.interview_at)) plan.timeChanged.push(pair);
    }
  }
  return plan;
}

/** What is sent to the database for each person added from the file. */
export function toNewInterviewCandidate(row: ListRow) {
  const name = (row.name ?? "").replace(/\s+/g, " ").trim();
  return {
    name,
    name_norm: normaliseName(name),
    primary_phone: row.phone,
    phone_raw: Object.entries(row.raw).find(([k]) => /mobile|phone/i.test(k))?.[1] ?? row.phone,
    email: row.email,
    email_norm: row.emailNorm,
    interview_at: row.when,
    raw: row.raw,
  };
}

/** "27 Nov, 3:00 PM" in India time. */
export function formatInterviewTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}
