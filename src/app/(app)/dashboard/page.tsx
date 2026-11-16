import { ComingSoon, PageHeader } from "@/components/page-header";

export const metadata = { title: "Dashboard · Candidate Tracker" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="ZBM and HOS at a glance" />
      <ComingSoon phase={5}>
        Stat cards per role: candidates in each stage, totals, new today and this week, and 1:1 Aligned per interviewer.
      </ComingSoon>
    </>
  );
}
