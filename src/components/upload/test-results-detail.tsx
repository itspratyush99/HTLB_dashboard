import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import { ROLE_COLORS } from "@/lib/brand";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Person = { id?: string; name: string | null; role?: string; phone: string; city?: string | null; existing?: { phone: string | null; stage: string }[]; from_tag?: string | null; percentage?: number | null; stage?: string; row?: number; in_tracker?: boolean };
interface Summary {
  target_stage?: string;
  pass_mark?: number | null;
  moved?: Person[];
  already_moved?: Person[];
  other_stage?: Person[];
  below_pass_mark?: Person[];
  not_found?: Person[];
  added?: Person[];
  added_role?: string | null;
  same_name?: Person[];
  duplicates_in_file?: number;
}

/** Upload History → one test-results upload: who moved (and from which tag), who was skipped and why. */
export function TestResultsDetail({ upload }: { upload: Record<string, unknown> & { summary: Summary; uploader?: { full_name: string } | null } }) {
  const s = upload.summary ?? {};
  const moved = s.moved ?? [];
  const byTag = new Map<string, number>();
  moved.forEach((m) => byTag.set(m.from_tag ?? "No tag", (byTag.get(m.from_tag ?? "No tag") ?? 0) + 1));
  const pct = (p?: number | null) => (p === null || p === undefined ? "—" : `${p}%`);
  const role = (r?: string) => (r ? <Badge color={ROLE_COLORS[r]}>{r}</Badge> : "—");

  return (
    <>
      <PageHeader
        title={String(upload.file_name)}
        description={`Test results · uploaded ${formatDateTime(String(upload.uploaded_at))} by ${upload.uploader?.full_name ?? "—"} · moved to ${s.target_stage ?? "—"}${s.pass_mark != null ? ` · pass mark ${s.pass_mark}%` : ""}`}
        actions={<Button asChild variant="ghost" size="sm"><Link href="/uploads"><ArrowLeft /> Upload History</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {([
          ["Rows in file", upload.total_rows],
          ["Moved", moved.length, "text-emerald-700"],
          [`Added${s.added_role ? ` to ${s.added_role}` : ""}`, s.added?.length ?? 0, "text-emerald-700"],
          ["Already moved / further", (s.already_moved?.length ?? 0) + (s.other_stage?.length ?? 0)],
          [s.added ? "Not added" : "Not in tracker", upload.unassigned_count],
          ["No valid mobile", upload.error_count],
        ] as [string, unknown, string?][]).map(([label, value, cls]) => (
          <div key={label} className="glass rounded-2xl p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${cls ?? ""}`}>{String(value ?? 0)}</div>
          </div>
        ))}
      </div>
      {byTag.size > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          Tag they had when moved: {[...byTag.entries()].sort(([a], [b]) => tagRank(a) - tagRank(b)).map(([t, n]) => `${t} ${n}`).join(" · ")}
        </p>
      )}
      <Tabs defaultValue="moved">
        <TabsList>
          <TabsTrigger value="moved">Moved ({moved.length})</TabsTrigger>
          {s.added && <TabsTrigger value="added">Added ({s.added.length})</TabsTrigger>}
          {s.same_name && s.same_name.length > 0 && <TabsTrigger value="same">Same name in tracker ({s.same_name.length})</TabsTrigger>}
          <TabsTrigger value="already">Already moved ({(s.already_moved?.length ?? 0) + (s.other_stage?.length ?? 0)})</TabsTrigger>
          <TabsTrigger value="notfound">{s.added ? "No name" : "Not in tracker"} ({s.not_found?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="below">Below pass mark ({s.below_pass_mark?.length ?? 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="moved"><Simple head={["Name", "Role", "Mobile", "Score", "Tag when moved"]} rows={moved.map((m) => [m.name, role(m.role), m.phone, pct(m.percentage), m.from_tag ?? "No tag"])} /></TabsContent>
        <TabsContent value="added"><Simple head={["Name", "Role", "Mobile", "Score", "City"]} rows={(s.added ?? []).map((m) => [m.name, role(m.role), m.phone, pct(m.percentage), m.city])} /></TabsContent>
        <TabsContent value="same">
          <p className="mb-3 text-sm text-muted-foreground">Not in the tracker by mobile, but the same name was already in {s.added_role}. Added only if &quot;Add these anyway&quot; was ticked.</p>
          <Simple head={["Name", "Mobile in test file", "Score", "Already in tracker", "Added?"]} rows={(s.same_name ?? []).map((m) => [m.name, m.phone, pct(m.percentage), (m.existing ?? []).map((e) => `${e.phone ?? "no mobile"} · ${e.stage}`).join(", "), (s.added ?? []).some((a) => a.phone === m.phone) ? "Yes" : "No"])} />
        </TabsContent>
        <TabsContent value="already"><Simple head={["Name", "Role", "Mobile", "Stage at upload"]} rows={[...(s.already_moved ?? []), ...(s.other_stage ?? [])].map((m) => [m.name, role(m.role), m.phone, m.stage])} /></TabsContent>
        <TabsContent value="notfound"><Simple head={["Row", "Name", "Mobile", "Score"]} rows={(s.not_found ?? []).map((m) => [m.row, m.name, m.phone, pct(m.percentage)])} /></TabsContent>
        <TabsContent value="below"><Simple head={["Name", "Mobile", "Score", "In tracker"]} rows={(s.below_pass_mark ?? []).map((m) => [m.name, m.phone, pct(m.percentage), m.in_tracker ? "Yes" : "No"])} /></TabsContent>
      </Tabs>
    </>
  );
}

function Simple({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">None.</div>;
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <Table>
        <TableHeader><TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j}>{c ?? "—"}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  );
}

/** Same order as the daily cycle: No tag, then the longest wait first (72h, 48h, 24h), then anything else (Hold). */
function tagRank(name: string) {
  if (name === "No tag") return -1;
  const hours = parseInt(name, 10);
  return Number.isFinite(hours) ? 1000 - hours : 2000;
}
