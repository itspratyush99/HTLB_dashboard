import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import { ROLE_COLORS } from "@/lib/brand";
import { formatInterviewTime } from "@/lib/interview-list/parse";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Person = { id?: string; name: string | null; file_name?: string | null; matched_by?: string; reason?: string; role?: string; phone: string; stage?: string; interviewer?: string | null; when?: string | null; old_when?: string | null; row?: number; existing?: { phone: string | null; stage: string }[] };
interface Summary {
  interviewer?: string;
  stage?: string;
  reassign?: boolean;
  mark_rescheduled?: boolean;
  added_role?: string | null;
  assigned?: Person[];
  other_interviewer?: Person[];
  already?: Person[];
  further?: Person[];
  similar?: Person[];
  include_similar?: boolean;
  ambiguous?: Person[];
  time_changed?: Person[];
  added?: Person[];
  same_name?: Person[];
  not_found?: Person[];
}

/** Upload History → one interviewer-list upload. */
export function InterviewListDetail({ upload }: { upload: Record<string, unknown> & { summary: Summary; uploader?: { full_name: string } | null } }) {
  const s = upload.summary ?? {};
  const role = (r?: string) => (r ? <Badge color={ROLE_COLORS[r]}>{r}</Badge> : "—");
  const t = formatInterviewTime;
  const tabs: [string, string, Person[], string[], (p: Person) => React.ReactNode[], string?][] = [
    ["assigned", "Moved", s.assigned ?? [], ["Name", "Role", "Found by", "Mobile", "Stage before", "1:1 time"], (p) => [p.name, role(p.role), p.matched_by ?? "mobile", p.phone, p.stage, t(p.when)]],
    ["similar", s.include_similar ? "Similar name · included" : "Similar name · not changed", s.similar ?? [], ["Name in file", "Name in tracker", "Role", "Stage"], (p) => [p.file_name, p.name, role(p.role), p.stage]],
    ["ambiguous", "More than one match", s.ambiguous ?? [], ["Name in file", "People in tracker"], (p) => [p.name, (p.existing ?? []).map((e) => `${e.stage} · ${e.phone ?? "no mobile"}`).join("  |  ")]],
    ["added", `Added${s.added_role ? ` to ${s.added_role}` : ""}`, s.added ?? [], ["Name", "Role", "Mobile", "1:1 time"], (p) => [p.name, role(p.role), p.phone, t(p.when)]],
    ["other", s.reassign ? "Moved from another interviewer" : "Left with another interviewer", s.other_interviewer ?? [], ["Name", "Role", "Mobile", "Interviewer before"], (p) => [p.name, role(p.role), p.phone, p.interviewer]],
    ["time", s.mark_rescheduled ? "New time · marked Rescheduled" : "New booking time", s.time_changed ?? [], ["Name", "Role", "Interviewer", "Old time", "New time"], (p) => [p.name, role(p.role), p.interviewer, t(p.old_when), t(p.when)]],
    ["already", `Already with ${s.interviewer ?? "them"}`, s.already ?? [], ["Name", "Role", "Mobile", "1:1 time"], (p) => [p.name, role(p.role), p.phone, t(p.when ?? p.old_when)]],
    ["further", "Further along", s.further ?? [], ["Name", "Role", "Mobile", "Stage"], (p) => [p.name, role(p.role), p.phone, p.stage]],
    ["same", "Same name in tracker", s.same_name ?? [], ["Name", "Mobile in file", "Already in tracker"], (p) => [p.name, p.phone, (p.existing ?? []).map((e) => `${e.phone ?? "no mobile"} · ${e.stage}`).join(", ")]],
    ["notfound", "Not in tracker, not added", s.not_found ?? [], ["Row", "Name", "Mobile", "Why"], (p) => [p.row, p.name, p.phone, p.reason]],
  ];
  const shown = tabs.filter(([key, , list]) => list.length || key === "assigned");
  return (
    <>
      <PageHeader
        title={String(upload.file_name)}
        description={`Interviewer list for ${s.interviewer ?? "—"} · uploaded ${formatDateTime(String(upload.uploaded_at))} by ${upload.uploader?.full_name ?? "—"} · moved to ${s.stage ?? "—"}`}
        actions={<Button asChild variant="ghost" size="sm"><Link href="/uploads"><ArrowLeft /> Upload History</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {([
          ["Rows in file", upload.total_rows],
          [`Now with ${s.interviewer ?? "—"}`, upload.new_added, "text-emerald-700"],
          ["Already with them", upload.duplicates_skipped],
          ["Not added", upload.unassigned_count],
          ["No valid mobile", upload.error_count],
        ] as [string, unknown, string?][]).map(([label, value, cls]) => (
          <div key={label} className="glass rounded-2xl p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${cls ?? ""}`}>{String(value ?? 0)}</div>
          </div>
        ))}
      </div>
      <Tabs defaultValue="assigned">
        <TabsList className="flex-wrap">
          {shown.map(([key, label, list]) => <TabsTrigger key={key} value={key}>{label} ({list.length})</TabsTrigger>)}
        </TabsList>
        {shown.map(([key, , list, head, row]) => (
          <TabsContent key={key} value={key}>
            {list.length ? (
              <div className="glass overflow-hidden rounded-2xl">
                <Table>
                  <TableHeader><TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{list.map((p, i) => <TableRow key={i}>{row(p).map((c, j) => <TableCell key={j}>{c ?? "—"}</TableCell>)}</TableRow>)}</TableBody>
                </Table>
              </div>
            ) : (
              <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">None.</div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
