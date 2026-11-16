import { Suspense } from "react";
import { createClient, getCurrentProfile, toViewer } from "@/lib/supabase/server";
import type { Interviewer } from "@/lib/candidates/types";
import { PageHeader } from "@/components/page-header";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const [{ data }, profile] = await Promise.all([
    supabase.from("interviewers").select("id, name, color, is_active").order("name"),
    getCurrentProfile(),
  ]);
  const viewer = toViewer(profile);
  return (
    <>
      <PageHeader title="Analytics" description="Progress, funnel, time in each stage, and where candidates are getting stuck. All dates in IST." />
      <Suspense>
        <AnalyticsView interviewers={viewer.interviewerOnly ? [] : ((data ?? []) as Interviewer[])} />
      </Suspense>
    </>
  );
}
