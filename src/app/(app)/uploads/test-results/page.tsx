import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireFullMember } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TestResultsWizard } from "@/components/upload/test-results-wizard";

export const metadata = { title: "Upload test results" };

export default async function TestResultsPage() {
  await requireFullMember(); // interviewers can't open this page
  return (
    <>
      <PageHeader
        title="Upload test results"
        description="Everyone in the file who is in Shortlisted (any tag) moves to the test-cleared stage. You see a preview first."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/uploads"><ArrowLeft /> Upload History</Link>
          </Button>
        }
      />
      <TestResultsWizard />
    </>
  );
}
