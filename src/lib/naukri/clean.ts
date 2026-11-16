/**
 * Field-level cleaning rules for Naukri exports.
 * Every function is pure (no database, no browser) so it can be unit-tested.
 */
import * as XLSX from "xlsx";
import type { ScreeningAnswer } from "./types";

export type CellValue = string | number | boolean | null | undefined;

/** Text Naukri (or a person) uses to mean "no value". Matching ignores case. */
const EMPTY_MARKERS = new Set(["", "na", "n/a", "n.a.", "n.a", "-", "--", "null", "nil", "not mentioned", "not disclosed"]);

/** Trim, collapse repeated spaces, and turn "NA"-style placeholders into null. */
export function cleanText(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  const text = (typeof value === "number" ? numberToPlainString(value) : String(value))
    .replace(/[ \s]+/g, " ")
    .trim();
  return EMPTY_MARKERS.has(text.toLowerCase()) ? null : text;
}

/** Like cleanText but keeps "NA"/"N/A" etc. (used for the raw copy and screening answers). */
export function plainText(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  const text = (typeof value === "number" ? numberToPlainString(value) : String(value))
    .replace(/[ \s]+/g, " ")
    .trim();
  return text === "" ? null : text;
}

/** 9876543210 stays 9876543210 (never "9.87e+9"). */
export function numberToPlainString(n: number): string {
  if (Number.isInteger(n)) return BigInt(n).toString();
  return String(n);
}

/** Lowercase + trimmed + single spaces. Used for duplicate checks. */
export function normaliseName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export function normaliseEmail(email: string | null): string | null {
  if (!email) return null;
  const e = email.replace(/\s+/g, "").toLowerCase();
  return e === "" ? null : e;
}

export function looksLikeEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/**
 * Naukri sometimes puts two emails in one cell: "a@x.com, b@y.com".
 * The first valid one becomes the main email (used for duplicate checks); the rest are kept as alternates.
 */
export function parseEmails(value: CellValue): { primary: string | null; alternate: string | null; invalid: string | null } {
  const text = cleanText(value);
  if (!text) return { primary: null, alternate: null, invalid: null };
  const parts = text.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const valid = parts.filter(looksLikeEmail);
  if (!valid.length) return { primary: null, alternate: null, invalid: text };
  // Drop repeats of the main email (Naukri often lists the same address twice), ignoring letter case.
  const seen = new Set([valid[0].toLowerCase()]);
  const rest = parts.filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  return { primary: valid[0], alternate: rest.length ? rest.join(", ") : null, invalid: null };
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Converts a Naukri date to YYYY-MM-DD.
 * Handles "09-Nov-2026" (Naukri's format), "09 Nov 2026", "09/11/2026" (day first),
 * "2026-11-09", and real Excel date cells (stored as serial numbers).
 * Returns null for blanks/"NA"; returns undefined when there is text we could not understand.
 */
export function parseDate(value: CellValue): string | null | undefined {
  if (typeof value === "number") {
    if (value > 20000 && value < 80000) {
      const p = XLSX.SSF.parse_date_code(value);
      return p ? isoDate(p.y, p.m, p.d) ?? undefined : undefined;
    }
    return undefined;
  }
  const text = cleanText(value);
  if (!text) return null;

  let m = text.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3,9})[-\s/.,]*(\d{4})$/); // 09-Nov-2026
  if (m) {
    const month = MONTHS[m[2].slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3).toLowerCase()];
    return month ? isoDate(+m[3], month, +m[1]) ?? undefined : undefined;
  }
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // 2026-11-09
  if (m) return isoDate(+m[1], +m[2], +m[3]) ?? undefined;
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // 09/11/2026 (Indian day-first)
  if (m) return isoDate(+m[3], +m[2], +m[1]) ?? undefined;
  return undefined;
}

// ---------------------------------------------------------------- phones

export interface PhoneResult {
  raw: string | null;
  primary: string | null; // 10 digits, starts with 6–9
  alternate: string | null;
  damaged: boolean; // looked like a number Excel shortened to scientific notation (digits lost)
}

/** Reduce one phone-ish token to a 10-digit Indian mobile, or null. */
export function toIndianMobile(token: string): string | null {
  let digits = token.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * "8454089323, +400604" → primary 8454089323, alternate "+400604".
 * Handles numbers stored as real numbers, "+91 98765 43210", "09876543210",
 * and scientific notation ("9.876543210E+09" is fine; "9.87E+09" has lost digits → damaged).
 */
export function parsePhones(value: CellValue): PhoneResult {
  if (value === null || value === undefined) return { raw: null, primary: null, alternate: null, damaged: false };

  let raw: string;
  let damaged = false;
  if (typeof value === "number") {
    raw = numberToPlainString(value);
  } else {
    raw = String(value).trim();
    const sci = raw.match(/^([+-]?\d+(?:\.\d+)?)[eE]\+?(\d+)$/);
    if (sci) {
      const significantDigits = sci[1].replace(/\D/g, "").replace(/^0+/, "").length;
      const expanded = numberToPlainString(Math.round(Number(raw)));
      if (significantDigits < 10) damaged = true;
      raw = expanded;
    }
  }
  if (cleanText(raw) === null) return { raw: null, primary: null, alternate: null, damaged: false };

  const tokens = raw.split(/[,;/|\n]+/).map((t) => t.trim()).filter(Boolean);
  let primary: string | null = null;
  const rest: string[] = [];
  for (const token of tokens) {
    const mobile = damaged ? null : toIndianMobile(token);
    if (!primary && mobile) primary = mobile;
    else rest.push(token);
  }
  return { raw, primary, alternate: rest.length ? rest.join(", ") : null, damaged };
}

// ---------------------------------------------------------------- experience & salary

/** "3 Year(s) 6 Month(s)" → 42. "Fresher" → 0. Unknown → null. */
export function parseExperienceMonths(value: CellValue): number | null {
  const text = cleanText(value);
  if (!text) return null;
  if (/fresher/i.test(text)) return 0;
  const years = text.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:year|yr)/i);
  const months = text.match(/(\d+)\s*(?:month|mon|mth)/i);
  if (!years && !months) return null;
  return Math.round((years ? parseFloat(years[1]) * 12 : 0) + (months ? parseInt(months[1], 10) : 0));
}

/**
 * "Rs 15.90 Lakhs" → 15.9. Always treated as Indian rupees in lakhs, even if the candidate
 * picked another currency label by mistake ("USD 9.5 Lakhs" → 9.5).
 * Also understands crore, thousand, and plain rupee amounts ("1500000" → 15).
 */
export function parseSalaryLakhs(value: CellValue): number | null {
  const text = cleanText(value);
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lpa|l\b|crores?|cr\b|thousands?|k\b)?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit.startsWith("cr")) n *= 100;
  else if (unit.startsWith("th") || unit === "k") n /= 100;
  else if (!unit && n >= 10000) n /= 100000; // a plain rupee amount
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------- screening answers & links

/** "9.5 years" → {t:"9.5 years", n:9.5}; "Yes" → {t:"Yes", n:null}; "1,500,000" → n 1500000. */
export function parseAnswer(value: CellValue): ScreeningAnswer {
  const t = plainText(value);
  if (!t) return { t: null, n: null };
  const m = t.replace(/,/g, "").match(/^-?\d+(?:\.\d+)?/);
  return { t, n: m ? parseFloat(m[0]) : null };
}

/** Only real web links are kept (never javascript: or file: links). */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return /^https?:\/\/\S+$/i.test(v) ? v : null;
}
