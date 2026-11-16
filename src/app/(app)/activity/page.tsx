import { createClient, getCurrentProfile, toViewer } from "@/lib/supabase/server";
import type { Interviewer, Stage } from "@/lib/candidates/types";
import { PageHeader } from "@/components/page-header";
import { ActivityFeed } from "@/components/activity/activity-feed";

export const metadata = { title: "Activity Log" };

export default async function ActivityPage() {
  const supabase = await createClient();
  const [profile, profiles, stages, interviewers] = await Promise.all([
    getCurrentProfile(),
    supabase.from("profiles").select("id, full_name").order("full_name"),
    supabase.from("stages").select("id, name, color, position, requires_interviewer").order("position"),
    supabase.from("interviewers").select("id, name, color, is_active").order("name"),
  ]);
  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Every upload, export, stage move, interviewer change and settings change, with who did it and when (IST). Bulk actions are grouped."
      />
      <ActivityFeed
        users={(profiles.data ?? []) as { id: string; full_name: string }[]}
        stages={(stages.data ?? []) as Stage[]}
        interviewers={(interviewers.data ?? []) as Interviewer[]}
        viewer={toViewer(profile)}
      />
    </>
  );
}
