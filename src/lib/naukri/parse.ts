/**
 * Turns the rows of a Naukri export into clean candidates.
 * Column names were taken from a real Naukri file (samples/naukri_sample.xlsx).
 * Headers are matched ignoring letter case and extra spaces; a few alternative spellings are accepted.
 */
import {
  cleanText,
  normaliseEmail,
  normaliseName,
  parseAnswer,
  parseDate,
  parseEmails,
  parseExperienceMonths,
  parsePhones,
  parseSalaryLakhs,
  plainText,
  safeUrl,
  type CellValue,
} from "./clean";
import type { SheetData } from "./read";
import { detectRole, type RoleKeyword } from "./roles";
import type { CandidateInput, ParseResult, ParsedRow, RowError, ScreeningAnswer } from "./types";

/** Our field → accepted Naukri header spellings (already normalised: lowercase, single spaces, no space around "/"). */
const COLUMNS = {
  jobTitle: ["job title"],
  applied: ["date of application", "applied on", "application date"],
  name: ["name", "candidate name"],
  email: ["email id", "email", "email address"],
  phone: ["phone number", "mobile number", "phone", "mobile"],
  currentLocation: ["current location"],
  preferredLocations: ["preferred locations", "preferred location"],
  experience: ["total experience", "experience"],
  company: ["curr. company name", "current company name", "current company"],
  designation: ["curr. company designation", "current company designation", "current designation"],
  salary: ["annual salary", "current ctc"],
  notice: ["notice period/availability to join", "notice period"],
  headline: ["resume headline"],
  ugDegree: ["under graduation degree", "ug degree"],
  ugSpec: ["ug specialization"],
  ugInstitute: ["ug university/institute name"],
  pgDegree: ["post graduation degree", "pg degree"],
  pgSpec: ["pg specialization"],
  pgInstitute: ["pg university/institute name"],
  docDegree: ["doctorate degree"],
  docSpec: ["doctorate specialization"],
  docInstitute: ["doctorate university/institute name"],
  gender: ["gender"],
  homeTown: ["home town/city", "home town", "hometown"],
  dob: ["date of birth", "dob"],
  pipeline: ["latest pipeline stage"],
  profile: ["candidate profile", "profile"],
} as const;
type Field = keyof typeof COLUMNS;

/** Columns the file must have, or it is rejected before preview. */
const REQUIRED: Field[] = ["jobTitle", "name"];

const normaliseHeader = (h: string) => h.toLowerCase().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
const ANSWER_HEADER = /^ans\s*\(([\s\S]*)\)\s*$/i;
const COMMENT_HEADER = /^comment\s*\d+$/i;

export function parseNaukriRows(sheet: SheetData, roleRules: RoleKeyword[]): ParseResult {
  // 1. Map headers.
  const headerFor: Partial<Record<Field, string>> = {};
  const answerHeaders: { header: string; question: string }[] = [];
  const commentHeaders: string[] = [];
  const unknownColumns: string[] = [];
  for (const header of sheet.headers) {
    const norm = normaliseHeader(header);
    const field = (Object.keys(COLUMNS) as Field[]).find(
      (f) => !headerFor[f] && (COLUMNS[f] as readonly string[]).includes(norm),
    );
    const answer = header.match(ANSWER_HEADER);
    if (field) headerFor[field] = header;
    else if (answer) answerHeaders.push({ header, question: answer[1].replace(/\s+/g, " ").trim() });
    else if (COMMENT_HEADER.test(header.trim())) commentHeaders.push(header);
    else unknownColumns.push(header);
  }
  const missingColumns: string[] = REQUIRED.filter((f) => !headerFor[f]).map((f) => COLUMNS[f][0]);
  if (!headerFor.phone && !headerFor.email) missingColumns.push("phone number or email id");
  if (missingColumns.length) {
    return { rows: [], errors: [], questions: [], totalRows: 0, emptyRowsSkipped: 0, missingColumns, unknownColumns };
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  let emptyRowsSkipped = 0;

  for (const sheetRow of sheet.rows) {
    const v = (f: Field): CellValue => (headerFor[f] ? sheetRow.values[headerFor[f]!] : null);
    const t = (f: Field) => cleanText(v(f));

    // 2. Skip completely empty rows.
    if (Object.values(sheetRow.values).every((x) => plainText(x) === null)) {
      emptyRowsSkipped++;
      continue;
    }

    const name = t("name");
    const emails = parseEmails(v("email"));
    const email = emails.primary;
    const phone = parsePhones(v("phone"));
    const warnings: string[] = [];

    // 3. Rows we cannot import.
    if (!name) {
      errors.push({ rowNumber: sheetRow.rowNumber, name: null, message: "Name is empty" });
      continue;
    }
    if (!phone.primary && !email) {
      errors.push({
        rowNumber: sheetRow.rowNumber,
        name,
        message: phone.damaged
          ? "Phone number was damaged by Excel (scientific notation) and there is no email"
          : "No valid mobile number and no email",
      });
      continue;
    }

    // 4. Rows we import, with a note.
    if (phone.damaged) warnings.push("Phone number was damaged by Excel (scientific notation) — fix it in Naukri");
    else if (!phone.primary) warnings.push("No valid 10-digit mobile — will be skipped in bulk-sender exports");
    if (emails.invalid) warnings.push(`Email "${emails.invalid}" doesn't look valid — stored in the raw row only`);

    const applied = parseDate(v("applied"));
    if (applied === undefined) warnings.push(`Couldn't read date of application "${plainText(v("applied"))}"`);
    const dob = parseDate(v("dob"));
    if (dob === undefined) warnings.push(`Couldn't read date of birth "${plainText(v("dob"))}"`);

    const salaryText = t("salary");
    const salary = parseSalaryLakhs(salaryText);
    if (salaryText && salary === null) warnings.push(`Couldn't read salary "${salaryText}"`);
    const expText = t("experience");
    const expMonths = parseExperienceMonths(expText);
    if (expText && expMonths === null) warnings.push(`Couldn't read experience "${expText}"`);

    const screening: Record<string, ScreeningAnswer> = {};
    for (const { header, question } of answerHeaders) screening[question] = parseAnswer(sheetRow.values[header]);

    const comments: Record<string, string> = {};
    for (const h of commentHeaders) {
      const c = cleanText(sheetRow.values[h]); // "NA" comments are dropped here (still kept in `raw`)
      if (c) comments[h] = c;
    }

    const doctorate = { degree: t("docDegree"), specialization: t("docSpec"), institute: t("docInstitute") };
    const profileHeader = headerFor.profile;
    const profileUrl = profileHeader
      ? safeUrl(sheetRow.links[profileHeader]) ?? safeUrl(plainText(sheetRow.values[profileHeader]))
      : null;

    // The untouched original row (text as shown in the file), plus the profile link.
    const raw: Record<string, string | null> = {};
    for (const h of sheet.headers) raw[h] = plainText(sheetRow.values[h]);
    for (const [h, link] of Object.entries(sheetRow.links)) raw[`${h} (link)`] = link;

    const jobTitle = t("jobTitle");
    const detected = detectRole(jobTitle, roleRules);

    const candidate: CandidateInput = {
      role: detected.role,
      job_title: jobTitle,
      applied_on: applied ?? null,
      name,
      email,
      alternate_email: emails.alternate,
      phone_raw: phone.raw,
      primary_phone: phone.primary,
      alternate_phone: phone.alternate,
      current_location: t("currentLocation"),
      preferred_locations: t("preferredLocations"),
      total_exp_text: expText,
      total_exp_months: expMonths,
      current_company: t("company"),
      designation: t("designation"),
      salary_text: salaryText,
      salary_lakhs: salary,
      notice_period: t("notice"),
      resume_headline: t("headline"),
      ug_degree: t("ugDegree"),
      ug_specialization: t("ugSpec"),
      ug_institute: t("ugInstitute"),
      pg_degree: t("pgDegree"),
      pg_specialization: t("pgSpec"),
      pg_institute: t("pgInstitute"),
      doctorate: doctorate.degree || doctorate.specialization || doctorate.institute ? doctorate : null,
      gender: t("gender"),
      home_town: t("homeTown"),
      dob: dob ?? null,
      naukri_pipeline_stage: plainText(v("pipeline")),
      naukri_comments: Object.keys(comments).length ? comments : null,
      screening,
      profile_url: profileUrl,
      raw,
      name_norm: normaliseName(name),
      email_norm: normaliseEmail(email),
    };
    rows.push({ rowNumber: sheetRow.rowNumber, candidate, roleProblem: detected.problem, warnings });
  }

  // 5. Screening questions: "numeric" when most answers start with a number → range filter in the table.
  const questions = answerHeaders.map(({ question }) => {
    const answered = rows.filter((r) => r.candidate.screening[question]?.t !== null);
    const numeric = answered.filter((r) => r.candidate.screening[question]?.n !== null);
    return { question, is_numeric: answered.length > 0 && numeric.length / answered.length >= 0.8 };
  });

  return {
    rows,
    errors,
    questions,
    totalRows: rows.length + errors.length,
    emptyRowsSkipped,
    missingColumns: [],
    unknownColumns,
  };
}
