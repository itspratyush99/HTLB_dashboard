import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for server components, server actions and route handlers.
 * It acts as the logged-in user (via their session cookie), so Row Level Security applies.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a server component: cookies are read-only there. The middleware refreshes them.
          }
        },
      },
    },
  );
}

export interface CurrentProfile {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  access: "full" | "interviewer";
  interviewer_id: number | null;
  interviewer_name: string | null;
}

/**
 * The logged-in team member's profile, or null if not logged in / not an active member.
 * Wrapped in cache(): the layout and the page share one lookup per page load.
 */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const supabase = await createClient();
  // The middleware has already checked the login; getClaims() verifies the token again, normally without
  // a round trip to Supabase.
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;
  // Profile + interviewer name in one query.
  const first = await supabase
    .from("profiles")
    .select("id, email, full_name, is_admin, is_active, access, interviewer_id, interviewer:interviewers(name)")
    .eq("id", userId)
    .maybeSingle();
  let data = first.data as (Record<string, unknown> & { is_active?: boolean; access?: string; interviewer_id?: number | null; interviewer?: { name: string } | null }) | null;
  if (first.error) {
    // Before 0007_access_levels_and_delete.sql is run, the access columns don't exist yet.
    ({ data } = await supabase.from("profiles").select("id, email, full_name, is_admin, is_active").eq("id", userId).maybeSingle());
  }
  if (!data || !data.is_active) return null;
  const access = (data.access ?? "full") as CurrentProfile["access"];
  const { interviewer, ...rest } = data;
  return {
    ...rest,
    access,
    interviewer_id: data.interviewer_id ?? null,
    interviewer_name: access === "interviewer" ? (interviewer?.name ?? null) : null,
  } as CurrentProfile;
});

/** What the logged-in person may see and do. Passed from server pages to client components. */
export type { Viewer } from "@/lib/viewer";
import type { Viewer } from "@/lib/viewer";

/** What the logged-in person may see and do (see lib/viewer.ts). */
export function toViewer(p: CurrentProfile | null): Viewer {
  const interviewerOnly = !!p && !p.is_admin && p.access === "interviewer";
  return {
    isAdmin: !!p?.is_admin,
    interviewerOnly,
    interviewerId: interviewerOnly ? p!.interviewer_id : null,
    interviewerName: interviewerOnly ? p!.interviewer_name : null,
  };
}

/** For pages interviewers may not open (uploads, settings): send them to the Dashboard. */
export async function requireFullMember() {
  const { redirect } = await import("next/navigation");
  const viewer = toViewer(await getCurrentProfile());
  if (viewer.interviewerOnly) redirect("/dashboard");
  return viewer;
}
