/** Role detection from Naukri's "Job Title", using the editable keyword rules in Settings. */
import type { Role } from "./types";

export interface RoleKeyword {
  role: Role;
  keyword: string;
  whole_word: boolean;
}

/** Used only if the rules could not be loaded; mirrors the seed data in 0001_init.sql. */
export const DEFAULT_ROLE_KEYWORDS: RoleKeyword[] = [
  { role: "ZBM", keyword: "Zonal Business Manager", whole_word: false },
  { role: "ZBM", keyword: "ZBM", whole_word: true },
  { role: "HOS", keyword: "Head of State", whole_word: false },
  { role: "HOS", keyword: "HOS", whole_word: true },
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matches(title: string, rule: RoleKeyword): boolean {
  const keyword = rule.keyword.trim();
  if (!keyword) return false;
  if (rule.whole_word) {
    // Letters/digits may not touch the keyword: "HOS" matches "HOS - Mumbai" but not "Hospital".
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(keyword)}($|[^a-z0-9])`, "i").test(title);
  }
  return title.toLowerCase().includes(keyword.toLowerCase());
}

/**
 * Returns the single role whose keywords match the title.
 * No match → problem "none"; matches for both roles → problem "ambiguous". Either way the row is "Unassigned".
 */
export function detectRole(
  title: string | null,
  rules: RoleKeyword[],
): { role: Role | null; problem: "none" | "ambiguous" | null } {
  if (!title) return { role: null, problem: "none" };
  const found = new Set<Role>();
  for (const rule of rules) if (matches(title, rule)) found.add(rule.role);
  if (found.size === 1) return { role: [...found][0], problem: null };
  return { role: null, problem: found.size === 0 ? "none" : "ambiguous" };
}
