import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { FilterOptions, Interviewer, Role, Stage } from "@/lib/candidates/types";
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
export async function RolePage({ role }: { role: Role }) {
  const supabase = await createClient();
  const [stages, interviewers, options] = await Promise.all([
    supabase.from("stages").select("id, name, color, position, requires_interviewer").order("position"),
    supabase.from("interviewers").select("id, name, color, is_active").order("name"),
    supabase.rpc("candidate_filter_options", { p_role: role }),
  ]);

  if (options.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Couldn&apos;t load the {role} tab: {options.error.message}
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
        stages={(stages.data ?? []) as Stage[]}
        interviewers={(interviewers.data ?? []) as Interviewer[]}
        options={{ ...EMPTY_OPTIONS, ...((options.data ?? {}) as Partial<FilterOptions>) }}
      />
    </Suspense>
  );
}
