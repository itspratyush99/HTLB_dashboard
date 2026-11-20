"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ClipboardCheck, FileSpreadsheet, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { readSheet } from "@/lib/naukri/read";
import { applyTestResults, findByPhones, loadTestSettings, type ApplyResult } from "@/lib/test-results/apply";
import { parseTestFile, planTestResults, type FoundCandidate, type TestFile } from "@/lib/test-results/parse";
import { ROLE_COLORS } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dropzone } from "./dropzone";

type Stage = { id: number; name: string; color: string; position: number; is_default: boolean };
type Loaded = { file: File; data: TestFile; found: FoundCandidate[]; stages: Stage[]; shortlistedStageId: number };
type Step = { name: "pick" } | { name: "reading"; file: File } | { name: "rejected"; file: File; message: string } | { name: "preview"; loaded: Loaded } | { name: "done"; file: File; result: ApplyResult; stage: string };

/**
 * Upload the assessment export: everyone in it who is in Shortlisted (any tag) moves to the
 * "test cleared" stage. Preview first, then Apply.
 */
export function TestResultsWizard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<Step>({ name: "pick" });
  const [targetId, setTargetId] = useState<number | null>(null);
  const [passMark, setPassMark] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File) {
    setStep({ name: "reading", file });
    try {
      const [buffer, settings] = await Promise.all([file.arrayBuffer(), loadTestSettings(supabase)]);
      const data = parseTestFile(readSheet(buffer, file.name));
      if (data.missingColumns.length) return setStep({ name: "rejected", file, message: "No Mobile column found. The test file needs a column called Mobile (or Phone)." });
      if (!data.rows.length) return setStep({ name: "rejected", file, message: "No rows with a valid mobile number." });
      const found = await findByPhones(supabase, data.rows.map((r) => r.phone));
      setTargetId(settings.targetStageId);
      setStep({ name: "preview", loaded: { file, data, found, stages: settings.stages, shortlistedStageId: settings.shortlistedStageId } });
    } catch (e) {
      setStep({ name: "rejected", file, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const loaded = step.name === "preview" ? step.loaded : null;
  const target = loaded?.stages.find((s) => s.id === targetId) ?? null;
  const mark = passMark.trim() === "" ? null : Number(passMark);
  const plan = useMemo(
    () =>
      loaded && target
        ? planTestResults(loaded.data, loaded.found, { shortlistedStageId: loaded.shortlistedStageId, targetStage: target, passMark: Number.isFinite(mark) ? mark : null })
        : null,
    [loaded, target, mark],
  );

  async function apply() {
    if (!loaded || !plan || !target) return;
    setSaving(true);
    try {
      const result = await applyTestResults(supabase, { fileName: loaded.file.name, fileSize: loaded.file.size, file: loaded.data, plan, targetStage: target, passMark: mark });
      toast.success(`${result.moved} candidate${result.moved === 1 ? "" : "s"} moved to ${target.name}`);
      setStep({ name: "done", file: loaded.file, result, stage: target.name });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (step.name === "pick") {
    return (
      <div className="space-y-3">
        <Dropzone onFile={handleFile} onReject={(m) => toast.error(m)} />
        <p className="text-center text-xs text-muted-foreground">
          Use the assessment export (e.g. HTLB-ZBM-assessment-results.csv). People are matched by mobile number, in both ZBM and HOS.
        </p>
      </div>
    );
  }

  const file = step.name === "preview" ? step.loaded.file : step.file;
  return (
    <div className="flex flex-col gap-6">
      <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <FileSpreadsheet className="size-5 shrink-0 text-emerald-600" />
          <p className="truncate text-sm font-medium">{file.name}</p>
        </div>
        {step.name !== "done" && (
          <Button variant="ghost" size="sm" onClick={() => setStep({ name: "pick" })}><RotateCcw /> Choose another file</Button>
        )}
      </div>

      {step.name === "reading" && (
        <Card><CardContent className="flex items-center gap-3 p-8 text-sm"><Loader2 className="size-5 animate-spin text-primary" /> Reading the file and finding candidates…</CardContent></Card>
      )}

      {step.name === "rejected" && (
        <Card className="border-red-200 bg-red-50/80"><CardContent className="flex items-start gap-3 p-6 text-sm text-red-800"><XCircle className="mt-0.5 size-5 shrink-0" /><div><p className="font-medium">Nothing was changed.</p><p className="mt-1">{step.message}</p></div></CardContent></Card>
      )}

      {step.name === "preview" && plan && loaded && (
        <>
          <div className="glass flex flex-wrap items-end gap-4 rounded-2xl p-4">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Move them to
              <select className="h-9 min-w-56 rounded-lg border border-black/10 bg-white/80 px-2 text-sm font-normal" value={targetId ?? ""} onChange={(e) => setTargetId(Number(e.target.value))}>
                {loaded.stages.filter((s) => !s.is_default).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Pass mark (optional)
              <span className="flex items-center gap-1.5">
                <Input type="number" min={0} max={100} placeholder="none" className="h-9 w-24" value={passMark} onChange={(e) => setPassMark(e.target.value)} />
                <span className="text-sm font-normal text-muted-foreground">%</span>
              </span>
            </label>
            <p className="max-w-md pb-1 text-xs text-muted-foreground">
              Leave the pass mark empty to move <b>everyone</b> in the file, as agreed. Fill it in (e.g. 60) to move only people who scored at least that much.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Rows in file" value={loaded.data.rows.length + loaded.data.errors.length + loaded.data.duplicatesInFile} />
            <Stat label={`Will move to ${target?.name ?? "—"}`} value={plan.toMove.length} tone="positive" />
            <Stat label="Already moved / further" value={plan.alreadyMoved.length} />
            <Stat label="Not in the tracker" value={plan.notFound.length} tone={plan.notFound.length ? "warning" : undefined} />
            <Stat label="Below pass mark" value={plan.belowPassMark.length} />
            <Stat label="No valid mobile" value={loaded.data.errors.length} tone={loaded.data.errors.length ? "danger" : undefined} />
          </div>

          <Tabs defaultValue="move">
            <TabsList>
              <TabsTrigger value="move">Will move ({plan.toMove.length})</TabsTrigger>
              <TabsTrigger value="already">Already moved ({plan.alreadyMoved.length + plan.otherStage.length})</TabsTrigger>
              <TabsTrigger value="notfound">Not in tracker ({plan.notFound.length})</TabsTrigger>
              {mark !== null && <TabsTrigger value="below">Below pass mark ({plan.belowPassMark.length})</TabsTrigger>}
              <TabsTrigger value="errors">No valid mobile ({loaded.data.errors.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="move">
              <p className="mb-3 text-sm text-muted-foreground">In Shortlisted now (any tag: none, 72h, 48h, 24h or Hold). Their tag is removed when they move.</p>
              <List
                head={["Name", "Role", "Mobile", "Score", "Tag now"]}
                rows={plan.toMove.map((m) => [m.candidate.name, <RoleTag key="r" role={m.candidate.role} />, m.row.phone, pctText(m.row.percentage), m.candidate.tag_name ?? "No tag"])}
                empty="Nobody in this file is in Shortlisted."
              />
            </TabsContent>
            <TabsContent value="already">
              <p className="mb-3 text-sm text-muted-foreground">Already in {target?.name} or a later stage. Nothing changes for them, so uploading the same file again is safe.</p>
              <List head={["Name", "Role", "Mobile", "Stage now"]} rows={[...plan.alreadyMoved, ...plan.otherStage].map((m) => [m.candidate.name, <RoleTag key="r" role={m.candidate.role} />, m.row.phone, m.candidate.stage_name])} empty="None." />
            </TabsContent>
            <TabsContent value="notfound">
              <p className="mb-3 text-sm text-muted-foreground">Their mobile number isn&apos;t in the tracker (maybe they used another number on Naukri). Search their name in ZBM / HOS and move them by hand if needed.</p>
              <List head={["Row", "Name", "Mobile", "Score"]} rows={plan.notFound.map((r) => [r.rowNumber, r.name ?? "—", r.phone, pctText(r.percentage)])} empty="Everyone was found." />
            </TabsContent>
            {mark !== null && (
              <TabsContent value="below">
                <List head={["Name", "Mobile", "Score", "In tracker"]} rows={plan.belowPassMark.map((m) => [m.row.name ?? "—", m.row.phone, pctText(m.row.percentage), m.candidate ? "Yes, stays in Shortlisted" : "No"])} empty="None." />
              </TabsContent>
            )}
            <TabsContent value="errors">
              <List head={["Row", "Name", "Problem"]} rows={loaded.data.errors.map((e) => [e.rowNumber, e.name ?? "—", e.message])} empty="None." />
            </TabsContent>
          </Tabs>

          <div className="glass glass-strong sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 rounded-none border-x-0 border-b-0 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <p className="text-sm">
              Move <b>{plan.toMove.length}</b> candidate{plan.toMove.length === 1 ? "" : "s"} from Shortlisted to <b>{target?.name}</b>?
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep({ name: "pick" })}>Cancel</Button>
              <Button onClick={apply} disabled={saving || !plan.toMove.length || !target}>
                {saving ? <Loader2 className="animate-spin" /> : <ArrowRight />} Move {plan.toMove.length}
              </Button>
            </div>
          </div>
        </>
      )}

      {step.name === "done" && (
        <Card className="border-emerald-200 bg-emerald-50/80">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="size-6 text-emerald-600" />
              <div>
                <p className="font-semibold">{step.result.moved} candidate{step.result.moved === 1 ? "" : "s"} moved to {step.stage}</p>
                <p className="text-sm text-muted-foreground">Saved in Upload History and the Activity Log. Next: send the reminders (24h → Hold, 48h → 24h, 72h → 48h).</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link href={`/uploads/${step.result.uploadId}`}>View details</Link></Button>
              <Button asChild variant="outline"><Link href="/zbm">Go to ZBM</Link></Button>
              <Button asChild variant="outline"><Link href="/hos">Go to HOS</Link></Button>
              <Button onClick={() => setStep({ name: "pick" })}><ClipboardCheck /> Upload another test file</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const pctText = (p: number | null) => (p === null ? "—" : `${p}%`);

function RoleTag({ role }: { role: string }) {
  return <Badge color={ROLE_COLORS[role]}>{role}</Badge>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "positive" | "warning" | "danger" }) {
  return (
    <div className={cn("glass rounded-2xl p-3", tone === "positive" && "bg-emerald-50/80", tone === "warning" && "bg-amber-50/80", tone === "danger" && "bg-red-50/80")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "positive" && "text-emerald-700", tone === "warning" && "text-amber-700", tone === "danger" && "text-red-700")}>{value}</div>
    </div>
  );
}

function List({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <div className="glass rounded-2xl border-dashed p-6 text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <Table>
        <TableHeader><TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.slice(0, 500).map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
      {rows.length > 500 && <p className="p-3 text-xs text-muted-foreground">Showing 500 of {rows.length}. All are included.</p>}
    </div>
  );
}
