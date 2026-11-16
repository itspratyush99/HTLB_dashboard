import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Interviewer } from "@/lib/candidates/types";
import { PageHeader } from "@/components/page-header";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("interviewers").select("id, name, color, is_active").order("name");
  return (
    <>
      <PageHeader title="Analytics" description="Progress, funnel, time in each stage, and where candidates are getting stuck. All dates in IST." />
      <Suspense>
        <AnalyticsView interviewers={(data ?? []) as Interviewer[]} />
      </Suspense>
    </>
  );
}
