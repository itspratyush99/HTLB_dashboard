import Link from "next/link";
import { ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UploadStatus } from "@/components/upload/upload-status";

export const metadata = { title: "Upload History" };

const PAGE_SIZE = 50;

export default async function UploadsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const supabase = await createClient();
  const { data: uploads, count, error } = await supabase
    .from("uploads")
    .select("*, uploader:profiles!uploads_uploaded_by_fkey(full_name)", { count: "exact" })
    .order("uploaded_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Upload History"
        description="One row per Naukri file imported. Click a row to see the candidates it added."
        actions={
          <Button asChild>
            <Link href="/uploads/new"><Upload /> Upload Naukri file</Link>
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-red-700">Couldn&apos;t load uploads: {error.message}</p>}

      {!uploads?.length ? (
        <div className="glass rounded-2xl border-dashed p-12 text-center">
          <p className="font-medium">No uploads yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Upload today&apos;s Naukri export to add your first candidates.</p>
          <Button asChild className="mt-4"><Link href="/uploads/new"><Upload /> Upload Naukri file</Link></Button>
        </div>
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; time (IST)</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead className="text-right">ZBM</TableHead>
                <TableHead className="text-right">HOS</TableHead>
                <TableHead className="text-right">Total rows</TableHead>
                <TableHead className="text-right">New added</TableHead>
                <TableHead className="text-right">Duplicates skipped</TableHead>
                <TableHead>Possible duplicates</TableHead>
                <TableHead className="text-right">Unassigned</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploads.map((u) => {
                const href = `/uploads/${u.id}`;
                const cell = (content: React.ReactNode, className = "") => (
                  <TableCell className={className}>
                    <Link href={href} className="block">{content}</Link>
                  </TableCell>
                );
                return (
                  <TableRow key={u.id} className="cursor-pointer">
                    {cell(formatDateTime(u.uploaded_at), "whitespace-nowrap")}
                    {cell(<span title={u.file_name}>{u.file_name}</span>, "max-w-64 truncate font-medium text-primary")}
                    {cell(u.uploader?.full_name ?? "—")}
                    {cell(u.zbm_rows, "text-right tabular-nums")}
                    {cell(u.hos_rows, "text-right tabular-nums")}
                    {cell(u.total_rows, "text-right tabular-nums")}
                    {cell(<b className="text-emerald-700">{u.new_added}</b>, "text-right tabular-nums")}
                    {cell(u.duplicates_skipped, "text-right tabular-nums")}
                    {cell(
                      u.flagged_count ? (
                        <span className="whitespace-nowrap text-xs">
                          {u.flagged_count} · <Badge color="#059669">{u.flagged_added} added</Badge>{" "}
                          <Badge>{u.flagged_skipped} skipped</Badge>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      ),
                    )}
                    {cell(u.unassigned_count, "text-right tabular-nums")}
                    {cell(
                      u.error_count ? <span className="text-red-700">{u.error_count}</span> : 0,
                      "text-right tabular-nums",
                    )}
                    {cell(<UploadStatus status={u.status} />)}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <Button asChild variant="outline" size="sm" className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
            <Link href={`/uploads?page=${page - 1}`}><ChevronLeft /> Newer</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className={page >= totalPages ? "pointer-events-none opacity-50" : ""}>
            <Link href={`/uploads?page=${page + 1}`}>Older <ChevronRight /></Link>
          </Button>
        </div>
      )}
    </>
  );
}
