/** Client-safe copy of the Viewer shape (the server helper lives in lib/supabase/server.ts). */
export interface Viewer {
  isAdmin: boolean;
  interviewerOnly: boolean;
  interviewerId: number | null;
  interviewerName: string | null;
}

export const FULL_VIEWER: Viewer = { isAdmin: false, interviewerOnly: false, interviewerId: null, interviewerName: null };
