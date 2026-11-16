import { ComingSoon, PageHeader } from "@/components/page-header";

export const metadata = { title: "Upload History · Candidate Tracker" };

export default function UploadsPage() {
  return (
    <>
      <PageHeader title="Upload History" description="Every Naukri file imported into the tracker" />
      <ComingSoon phase={2}>
        Drag-and-drop upload with a preview (new, duplicates, possible duplicates, unassigned, errors), and one row per upload.
      </ComingSoon>
    </>
  );
}
