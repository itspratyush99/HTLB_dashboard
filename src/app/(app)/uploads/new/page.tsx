import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { UploadWizard } from "@/components/upload/upload-wizard";

export const metadata = { title: "Upload Naukri file · Candidate Tracker" };

export default function NewUploadPage() {
  return (
    <>
      <PageHeader
        title="Upload Naukri file"
        description="Both roles can be in one file. New candidates start in Shortlisted; existing candidates are never changed."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/uploads"><ArrowLeft /> Upload History</Link>
          </Button>
        }
      />
      <UploadWizard />
    </>
  );
}
