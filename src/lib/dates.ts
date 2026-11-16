import { formatInTimeZone } from "date-fns-tz";

/** Every date and time in the app is shown in India Standard Time. */
export const IST = "Asia/Kolkata";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 14-Nov-2026 */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return d ? formatInTimeZone(d, IST, "dd-MMM-yyyy") : "—";
}

/** 14-Nov-2026, 03:45 PM */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  return d ? formatInTimeZone(d, IST, "dd-MMM-yyyy, hh:mm a") : "—";
}
