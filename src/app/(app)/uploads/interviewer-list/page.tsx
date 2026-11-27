import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireFullMember } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { InterviewListWizard } from "@/components/upload/interview-list-wizard";

export const metadata = { title: "Upload interviewer list" };

export default async function InterviewerListPage() {
  await requireFullMember(); // interviewer logins can't open this page
  return (
    <>
      <PageHeader
        title="Upload interviewer list"
        description="Everyone in the file moves to 1:1 Aligned with the interviewer you choose. You see a preview first."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/uploads"><ArrowLeft /> Upload History</Link>
          </Button>
        }
      />
      <InterviewListWizard />
    </>
  );
}
