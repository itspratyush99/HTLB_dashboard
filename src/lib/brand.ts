/**
 * HTLB brand settings in one place. Change a colour here and it changes everywhere.
 * (The page-wide theme colours live in src/app/globals.css as CSS variables.)
 */
export const APP_NAME = "HTLB Candidate Tracker";
export const COMPANY = "HTLB Systems";
export const TAGLINE = "Enriching Knowledge, Empowering Nation";

export const BRAND = {
  forest: "#1f4d36", // primary: buttons, active navigation, ZBM
  forestLight: "#2f6f4f", // charts and bars
  gold: "#c9a227", // accent: highlights, selection, focus rings
  goldDeep: "#9a7a12", // gold used for text/badges (readable on white): HOS
};

/** Colour used for each role's badge. */
export const ROLE_COLORS: Record<string, string> = {
  ZBM: BRAND.forest,
  HOS: BRAND.goldDeep,
};
