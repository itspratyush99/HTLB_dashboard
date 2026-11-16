import { createClient, getCurrentProfile, requireFullMember } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { SettingsView, type SettingsData } from "@/components/settings/settings-view";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireFullMember(); // interviewers can't open this page
  const supabase = await createClient();
  const [me, stages, interviewers, keywords, settings, team, stageCounts] = await Promise.all([
    getCurrentProfile(),
    supabase.from("stages").select("id, name, color, position, is_default, requires_interviewer").order("position"),
    supabase.from("interviewers").select("id, name, color, is_active").order("name"),
    supabase.from("role_keywords").select("id, role, keyword, whole_word").order("role").order("keyword"),
    supabase.from("app_settings").select("key, value"),
    supabase.from("profiles").select("id, email, full_name, is_admin, is_active, created_at, access, interviewer_id").order("created_at"),
    supabase.rpc("dashboard_stats"),
  ]);

  // Candidates per stage (both roles), from the dashboard function.
  const perStage: Record<number, number> = {};
  for (const role of Object.values((stageCounts.data ?? {}) as Record<string, { stages: { id: number; count: number }[] }>))
    for (const s of role.stages) perStage[s.id] = (perStage[s.id] ?? 0) + s.count;
  // Candidates currently tagged with each interviewer (count-only queries; no rows downloaded).
  const perInterviewer: Record<number, number> = {};
  await Promise.all(
    (interviewers.data ?? []).map(async (i) => {
      const { count } = await supabase.from("candidates").select("id", { count: "exact", head: true }).eq("interviewer_id", i.id);
      perInterviewer[i.id] = count ?? 0;
    }),
  );

  const setting = (key: string, fallback: number) => Number(settings.data?.find((s) => s.key === key)?.value ?? fallback);

  const data: SettingsData = {
    me: me ? { id: me.id, is_admin: me.is_admin } : { id: "", is_admin: false },
    stages: (stages.data ?? []).map((s) => ({ ...s, candidates: perStage[s.id] ?? 0 })),
    interviewers: (interviewers.data ?? []).map((i) => ({ ...i, candidates: perInterviewer[i.id] ?? 0 })),
    keywords: keywords.data ?? [],
    thresholds: { maxDays: setting("lag_max_days_in_stage", 3), minConversion: setting("lag_min_conversion_pct", 30) },
    team: (team.data ?? []).map((p) => ({ ...p, access: p.access ?? "full", interviewer_id: p.interviewer_id ?? null })),
    canCreateUsers: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  return (
    <>
      <PageHeader title="Settings" description="Stages, interviewers, role detection, bottleneck limits and team users. Every change is saved in the Activity Log." />
      <SettingsView data={data} />
    </>
  );
}
