import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { createClient, requireFullMember } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { FlaggedRecord, NoteRecord, UnassignedRecord } from "@/lib/naukri/import";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoleBadge } from "@/components/upload/upload-preview";
import { UploadStatus } from "@/components/upload/upload-status";
import { InterviewListDetail } from "@/components/upload/interview-list-detail";
import { TestResultsDetail } from "@/components/upload/test-results-detail";

export const metadata = { title: "Upload details" };

const PAGE_SIZE = 100;

export default async function UploadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireFullMember(); // interviewers can't open this page
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const supabase = await createClient();

  const [{ data: upload }, { data: candidates, count }] = await Promise.all([
    supabase
      .from("uploads")
      .select("*, uploader:profiles!uploads_uploaded_by_fkey(full_name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("candidates")
      .select(
        "id, role, name, primary_phone, email, current_location, total_exp_months, salary_lakhs, applied_on, profile_url, stage:stages(name, color), interviewer:interviewers(name, color)",
        { count: "exact" },
      )
      .eq("upload_id", id)
      .order("name")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);
  if (!upload) notFound();
  if (upload.kind === "test_results") return <TestResultsDetail upload={upload} />;
  if (upload.kind === "interviewer_list") return <InterviewListDetail upload={upload} />;

  const flagged = (upload.flagged ?? []) as FlaggedRecord[];
  const unassigned = (upload.unassigned ?? []) as UnassignedRecord[];
  const errors = (upload.errors ?? []) as NoteRecord[];
  const warnings = (upload.warnings ?? []) as NoteRecord[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const stats: [string, number | string, string?][] = [
    ["Total rows", upload.total_rows],
    ["ZBM rows", upload.zbm_rows],
    ["HOS rows", upload.hos_rows],
    ["New added", upload.new_added, "text-emerald-700"],
    ["Duplicates skipped", upload.duplicates_skipped],
    ["Possible duplicates", `${upload.flagged_count} (${upload.flagged_added} added)`],
    ["Unassigned role", upload.unassigned_count],
    ["Errors", upload.error_count, upload.error_count ? "text-red-700" : undefined],
  ];

  return (
    <>
      <PageHeader
        title={upload.file_name}
        description={`Uploaded ${formatDateTime(upload.uploaded_at)} by ${upload.uploader?.full_name ?? "—"}`}
        actions={
          <>
            {(["ZBM", "HOS"] as const)
              .filter((r) => (r === "ZBM" ? upload.zbm_rows : upload.hos_rows) > 0)
              .map((r) => (
                <Button key={r} asChild variant="outline" size="sm">
                  <Link href={`/${r.toLowerCase()}?f=${encodeURIComponent(JSON.stringify({ upload_id: id }))}`}>
                    Open in {r} tab
                  </Link>
                </Button>
              ))}
            <Button asChild variant="ghost" size="sm">
              <Link href="/uploads"><ArrowLeft /> Upload History</Link>
            </Button>
          </>
        }
      />

      <div className="mb-2 flex items-center gap-2"><UploadStatus status={upload.status} /></div>
      {upload.failure_message && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-900">
            {upload.failure_message}. Uploading the same file again will add only the missing candidates.
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {stats.map(([label, value, cls]) => (
          <div key={label} className="glass rounded-2xl p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${cls ?? ""}`}>{value}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="added">
        <TabsList>
          <TabsTrigger value="added">Candidates added ({count ?? 0})</TabsTrigger>
          <TabsTrigger value="flagged">Possible duplicates ({flagged.length})</TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned ({unassigned.length})</TabsTrigger>
          <TabsTrigger value="errors">Errors ({errors.length})</TabsTrigger>
          <TabsTrigger value="warnings">Warnings ({warnings.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="added">
          <div className="glass overflow-hidden rounded-2xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead>Salary (L)</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Current stage</TableHead>
                  <TableHead>Profile</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(candidates ?? []).map((c) => {
                  const stage = c.stage as unknown as { name: string; color: string } | null;
                  const interviewer = c.interviewer as unknown as { name: string; color: string } | null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell><RoleBadge role={c.role} /></TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="font-mono text-xs">{c.primary_phone ?? <span className="text-red-600">invalid</span>}</TableCell>
                      <TableCell className="max-w-52 truncate">{c.email ?? "—"}</TableCell>
                      <TableCell>{c.current_location ?? "—"}</TableCell>
                      <TableCell>{c.total_exp_months !== null ? `${(c.total_exp_months / 12).toFixed(1)} yrs` : "—"}</TableCell>
                      <TableCell>{c.salary_lakhs ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(c.applied_on)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {stage && <Badge color={stage.color}>{stage.name}</Badge>}{" "}
                        {interviewer && <Badge color={interviewer.color}>{interviewer.name}</Badge>}
                      </TableCell>
                      <TableCell>
                        {c.profile_url ? (
                          <a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            View <ExternalLink className="size-3" />
                          </a>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!candidates?.length && (
                  <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No candidates were added by this upload.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button asChild variant="outline" size="sm" className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
                <Link href={`/uploads/${id}?page=${page - 1}`}><ChevronLeft /> Previous</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className={page >= totalPages ? "pointer-events-none opacity-50" : ""}>
                <Link href={`/uploads/${id}?page=${page + 1}`}>Next <ChevronRight /></Link>
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="flagged">
          <SimpleTable
            empty="No possible duplicates in this file."
            head={["Row", "Name", "Mobile", "Email", "Role", "Matched", "Outcome"]}
            rows={flagged.map((f) => [
              f.row,
              f.name,
              f.phone ?? "—",
              f.email ?? "—",
              f.role,
              f.matched.map((m) => (m.from_file_row ? `${m.name} (row ${m.from_file_row} of this file)` : `${m.name} — ${m.stage}`)).join("; "),
              f.decision === "add" ? <Badge color="#059669">Added as new</Badge> : <Badge>Skipped</Badge>,
            ])}
          />
        </TabsContent>

        <TabsContent value="unassigned">
          <SimpleTable
            empty="Every row's role was detected."
            head={["Row", "Name", "Job Title", "Outcome"]}
            rows={unassigned.map((u) => [
              u.row,
              u.name,
              u.job_title ?? "—",
              u.decision === "skip" ? <Badge>Skipped</Badge> : <Badge color="#059669">Assigned to {u.decision}</Badge>,
            ])}
          />
        </TabsContent>

        <TabsContent value="errors">
          <SimpleTable empty="No errors." head={["Row", "Name", "Problem"]} rows={errors.map((e) => [e.row, e.name ?? "—", e.message])} />
        </TabsContent>

        <TabsContent value="warnings">
          <SimpleTable empty="No warnings." head={["Row", "Name", "Note"]} rows={warnings.map((w) => [w.row, w.name ?? "—", w.message])} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <div className="glass rounded-2xl border-dashed p-6 text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <Table>
        <TableHeader>
          <TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>{r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
