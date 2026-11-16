/**
 * Reads an uploaded .xlsx / .xls / .csv file into plain rows, in the browser.
 * Keeps hyperlinks (Naukri's "View profile" cells hold the real profile URL as a link).
 */
import * as XLSX from "xlsx";
import type { CellValue } from "./clean";

export interface SheetRow {
  rowNumber: number; // as shown in Excel (header is row 1)
  values: Record<string, CellValue>;
  links: Record<string, string>;
}

export interface SheetData {
  headers: string[];
  rows: SheetRow[];
}

export const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function readSheet(data: ArrayBuffer, fileName: string): SheetData {
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  let wb: XLSX.WorkBook;

  // Naukri's .xlsx files make SheetJS print harmless "Bad uncompressed size" messages; hide them.
  const originalError = console.error;
  console.error = () => {};
  try {
    if (isCsv) {
      // TextDecoder removes a UTF-8 BOM automatically. raw:true keeps phone numbers and dates as text.
      const text = new TextDecoder("utf-8").decode(data);
      wb = XLSX.read(text, { type: "string", raw: true });
    } else {
      wb = XLSX.read(new Uint8Array(data), { type: "array", cellDates: false });
    }
  } finally {
    console.error = originalError;
  }

  // Use the first sheet that has any data.
  const sheet = wb.SheetNames.map((n) => wb.Sheets[n]).find((s) => s && s["!ref"]);
  if (!sheet || !sheet["!ref"]) return { headers: [], rows: [] };
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  const cellAt = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  const valueOf = (cell: XLSX.CellObject | undefined): CellValue => {
    if (!cell || cell.t === "e" || cell.t === "z") return null;
    if (cell.t === "n" || cell.t === "b") return cell.v as number | boolean;
    return cell.v === undefined || cell.v === null ? null : String(cell.v);
  };

  // Header = first row that has any text.
  let headerRow = range.s.r;
  while (headerRow <= range.e.r) {
    let any = false;
    for (let c = range.s.c; c <= range.e.c; c++) if (String(valueOf(cellAt(headerRow, c)) ?? "").trim()) any = true;
    if (any) break;
    headerRow++;
  }

  const headers: string[] = [];
  const colIndex: number[] = [];
  const seen = new Map<string, number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    let h = String(valueOf(cellAt(headerRow, c)) ?? "").replace(/^﻿/, "").replace(/\s+/g, " ").trim();
    if (!h) continue;
    const count = (seen.get(h) ?? 0) + 1;
    seen.set(h, count);
    if (count > 1) h = `${h} (${count})`; // keep duplicate headers apart
    headers.push(h);
    colIndex.push(c);
  }

  const rows: SheetRow[] = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const values: Record<string, CellValue> = {};
    const links: Record<string, string> = {};
    headers.forEach((h, i) => {
      const cell = cellAt(r, colIndex[i]);
      values[h] = valueOf(cell);
      const target = cell?.l?.Target;
      if (target) links[h] = target;
    });
    rows.push({ rowNumber: r + 1, values, links });
  }
  return { headers, rows };
}
