"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { ExistingCandidate } from "@/lib/naukri/dedupe";
import { fetchExistingMatches, fetchRoleRules, runImport, type ImportResult } from "@/lib/naukri/import";
import { parseNaukriRows } from "@/lib/naukri/parse";
import { buildPlan, toImportRequest, type FlagDecision, type RoleDecision } from "@/lib/naukri/plan";
import { readSheet } from "@/lib/naukri/read";
import type { ParseResult } from "@/lib/naukri/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dropzone } from "./dropzone";
import { UploadPreview } from "./upload-preview";

type Step =
  | { name: "pick" }
  | { name: "reading"; file: File; message: string }
  | { name: "rejected"; file: File; message: string }
  | { name: "preview"; file: File; parse: ParseResult; existing: ExistingCandidate[] }
  | { name: "importing"; file: File; done: number; total: number }
  | { name: "done"; file: File; result: ImportResult };

const sizeLabel = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

/** Upload flow: pick file → read & check in the browser → preview with decisions → import in batches → done. */
export function UploadWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "pick" });
  const [roleDecisions, setRoleDecisions] = useState<Record<number, RoleDecision>>({});
  const [flagDecisions, setFlagDecisions] = useState<Record<number, FlagDecision>>({});

  const preview = step.name === "preview" ? step : null;
  const plan = useMemo(
    () => (preview ? buildPlan(preview.parse, preview.existing, roleDecisions, flagDecisions) : null),
    [preview, roleDecisions, flagDecisions],
  );

  function reset() {
    setStep({ name: "pick" });
    setRoleDecisions({});
    setFlagDecisions({});
  }

  async function handleFile(file: File) {
    reset();
    setStep({ name: "reading", file, message: "Reading the file…" });
    try {
      const supabase = createClient();
      const [buffer, rules] = await Promise.all([file.arrayBuffer(), fetchRoleRules(supabase)]);
      const sheet = readSheet(buffer, file.name);
      const parse = parseNaukriRows(sheet, rules);

      if (parse.missingColumns.length) {
        setStep({
          name: "rejected",
          file,
          message: `This doesn't look like a Naukri candidate export. Missing column(s): ${parse.missingColumns.join(", ")}.`,
        });
        return;
      }
      if (!parse.totalRows) {
        setStep({ name: "rejected", file, message: "The file has a header row but no candidates." });
        return;
      }

      setStep({ name: "reading", file, message: `Checking ${parse.totalRows} rows for duplicates…` });
      const existing = await fetchExistingMatches(
        supabase,
        parse.rows.map((r) => r.candidate.primary_phone ?? ""),
        parse.rows.map((r) => r.candidate.email_norm ?? ""),
      );
      setStep({ name: "preview", file, parse, existing });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStep({ name: "rejected", file, message: `Couldn't read this file: ${message}` });
    }
  }

  async function handleImport() {
    if (!preview || !plan) return;
    const request = toImportRequest(plan, preview.parse, preview.file, flagDecisions);
    const file = preview.file;
    setStep({ name: "importing", file, done: 0, total: request.candidates.length });
    try {
      const result = await runImport(createClient(), request, (done, total) =>
        setStep({ name: "importing", file, done, total }),
      );
      setStep({ name: "done", file, result });
      if (result.failed) toast.error("Import stopped part-way", { description: result.failed });
      else toast.success(`${result.inserted} new candidate${result.inserted === 1 ? "" : "s"} added`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setStep(preview); // back to the preview so nothing is lost
    }
  }

  // ---------------------------------------------------------------- render

  if (step.name === "pick") {
    return <Dropzone onFile={handleFile} onReject={(m) => toast.error(m)} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <FileBar file={step.file} onReset={step.name === "importing" ? undefined : reset} />

      {step.name === "reading" && (
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-sm">
            <Loader2 className="size-5 animate-spin text-primary" /> {step.message}
          </CardContent>
        </Card>
      )}

      {step.name === "rejected" && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-start gap-3 p-6 text-sm text-red-800">
            <XCircle className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">Nothing was imported.</p>
              <p className="mt-1">{step.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step.name === "preview" && plan && (
        <>
          <UploadPreview
            parse={step.parse}
            plan={plan}
            roleDecisions={roleDecisions}
            flagDecisions={flagDecisions}
            onRoleDecision={(row, d) => setRoleDecisions((s) => ({ ...s, [row]: d }))}
            onFlagDecision={(row, d) => setFlagDecisions((s) => ({ ...s, [row]: d }))}
            onBulkRole={(d) =>
              setRoleDecisions(Object.fromEntries(plan.unassignedRows.map((r) => [r.parsed.rowNumber, d])))
            }
            onBulkFlag={(d) =>
              setFlagDecisions(Object.fromEntries(plan.possibleRows.map((r) => [r.parsed.rowNumber, d])))
            }
          />
          <div className="glass glass-strong sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 rounded-none border-x-0 border-b-0 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <p className="text-sm">
              Ready to add <b>{plan.toImport.length}</b> candidate{plan.toImport.length === 1 ? "" : "s"}
              {plan.toImport.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  (ZBM {plan.counts.importZbm} · HOS {plan.counts.importHos})
                </span>
              )}
              . Existing candidates are never changed.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={handleImport} disabled={!plan.toImport.length}>
                Import {plan.toImport.length} candidate{plan.toImport.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </>
      )}

      {step.name === "importing" && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-8">
            <div className="flex items-center gap-3 text-sm">
              <Loader2 className="size-5 animate-spin text-primary" />
              Saving candidates… {step.done} of {step.total}. Please keep this tab open.
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${step.total ? (step.done / step.total) * 100 : 100}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {step.name === "done" && (
        <Card className={step.result.failed ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className={step.result.failed ? "size-6 text-amber-600" : "size-6 text-emerald-600"} />
              <div>
                <p className="font-semibold">
                  {step.result.inserted} new candidate{step.result.inserted === 1 ? "" : "s"} added to Shortlisted
                </p>
                <p className="text-sm text-muted-foreground">
                  ZBM {step.result.insertedByRole.ZBM} · HOS {step.result.insertedByRole.HOS}
                </p>
                {step.result.failed && (
                  <p className="mt-2 text-sm text-amber-800">
                    {step.result.failed}. Upload the same file again: the candidates already saved will be skipped
                    as exact duplicates.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link href={`/uploads/${step.result.uploadId}`}>View upload details</Link></Button>
              {step.result.insertedByRole.ZBM > 0 && <Button asChild variant="outline"><Link href="/zbm">Go to ZBM</Link></Button>}
              {step.result.insertedByRole.HOS > 0 && <Button asChild variant="outline"><Link href="/hos">Go to HOS</Link></Button>}
              <Button onClick={reset}>Upload another file</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FileBar({ file, onReset }: { file: File; onReset?: () => void }) {
  return (
    <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <FileSpreadsheet className="size-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">{sizeLabel(file.size)}</p>
        </div>
      </div>
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw /> Choose another file
        </Button>
      )}
    </div>
  );
}
