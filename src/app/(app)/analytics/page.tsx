import { ComingSoon, PageHeader } from "@/components/page-header";

export const metadata = { title: "Analytics · Candidate Tracker" };

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader title="Analytics" description="Progress, funnel, time-in-stage and bottlenecks" />
      <ComingSoon phase={5}>
        Daily progress charts, stage funnel with conversion ratios, time-in-stage, lag alerts and the stuck-candidates list.
      </ComingSoon>
    </>
  );
}
