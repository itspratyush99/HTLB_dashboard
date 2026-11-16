import { ComingSoon, PageHeader } from "@/components/page-header";

export const metadata = { title: "Activity Log · Candidate Tracker" };

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity Log" description="Who did what, and when (IST)" />
      <ComingSoon phase={4}>
        Every stage change, interviewer change, upload and export, filterable by user, date, role and action type.
        Changes are already being recorded in the database from Phase 1.
      </ComingSoon>
    </>
  );
}
