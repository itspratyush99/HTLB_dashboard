/** "Rescheduled" marker for 1:1 interviews (stages that ask for an interviewer). */
export const RESCHEDULED_COLOR = "#7c3aed";

/** Badge text for candidates added from a file instead of Naukri. */
export function sourceLabel(source: string): string {
  return source === "test_file" ? "From test file" : source === "interview_file" ? "From interviewer list" : source === "manual" ? "Added by hand" : source;
}
