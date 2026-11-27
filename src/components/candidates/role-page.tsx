import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { createClient, getCurrentProfile, toViewer } from "@/lib/supabase/server";
import { roleParam, type FilterOptions, type Interviewer, type RoleScope, type ShortlistTag, type Stage } from "@/lib/candidates/types";
import { RoleTab } from "./role-tab";

const EMPTY_OPTIONS: FilterOptions = {
  current_locations: [],
  home_towns: [],
  notice_periods: [],
  genders: [],
  ug_degrees: [],
  pg_degrees: [],
  questions: [],
};

/** Server part of a role tab: loads stages, interviewers and filter pick-lists, then hands over to the table. */
export async function RolePage({ role }: { role: RoleScope }) {
  const supabase = await createClient();
  const [profile, stages, interviewers, options, tags] = await Promise.all([
    getCurrentProfile(),
    supabase.from("stages").select("id, name, color, position, requires_interviewer, is_default").order("position"),
    supabase.from("interviewers").select("id, name, color, is_active").order("name"),
    supabase.rpc("candidate_filter_options", { p_role: roleParam(role) }),
    supabase.from("shortlist_tags").select("id, name, color, position").order("position"),
  ]);

  if (options.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Couldn&apos;t load the {role === "ALL" ? "All" : role} tab: {options.error.message}
        {/function .* does not exist/i.test(options.error.message) && (
          <p className="mt-2">
            It looks like <b>0003_candidate_search.sql</b> hasn&apos;t been run yet. Run it in Supabase → SQL Editor, then reload.
          </p>
        )}
      </div>
    );
  }

  return (
    <Suspense fallback={<Loader2 className="mx-auto mt-16 size-5 animate-spin text-muted-foreground" />}>
      <RoleTab
        role={role}
        viewer={toViewer(profile)}
        tags={(tags.data ?? []) as ShortlistTag[]}
        stages={(stages.data ?? []) as Stage[]}
        interviewers={(interviewers.data ?? []) as Interviewer[]}
        options={{ ...EMPTY_OPTIONS, ...((options.data ?? {}) as Partial<FilterOptions>) }}
      />
    </Suspense>
  );
}
