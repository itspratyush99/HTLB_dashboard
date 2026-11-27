"use client";

import { AlertTriangle, Ban, CheckCircle2, Copy, FileWarning, HelpCircle, Info, Users } from "lucide-react";
import { normaliseName } from "@/lib/naukri/clean";
import type { Match } from "@/lib/naukri/dedupe";
import type { FlagDecision, Plan, PlannedRow, RoleDecision } from "@/lib/naukri/plan";
import type { ParseResult } from "@/lib/naukri/types";
import { formatDate } from "@/lib/dates";
import { ROLE_COLORS } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PREVIEW_LIMIT = 200; // long lists show the first 200 rows to keep the page fast

export interface UploadPreviewProps {
  parse: ParseResult;
  plan: Plan;
  roleDecisions: Record<number, RoleDecision>;
  flagDecisions: Record<number, FlagDecision>;
  onRoleDecision: (row: number, d: RoleDecision) => void;
  onFlagDecision: (row: number, d: FlagDecision) => void;
  onBulkRole: (d: RoleDecision) => void;
  onBulkFlag: (d: FlagDecision) => void;
}

export function UploadPreview(props: UploadPreviewProps) {
  const { parse, plan } = props;
  const warningsCount = plan.toImport.filter((r) => r.parsed.warnings.length).length;
  const needsAttention = plan.possibleRows.length ? "possible" : plan.unassignedRows.length ? "unassigned" : "new";

  return (
    <div className="flex flex-col gap-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Total rows" value={plan.counts.total} icon={Users} />
        <Stat label="ZBM rows" value={plan.counts.zbm} />
        <Stat label="HOS rows" value={plan.counts.hos} />
        <Stat label="New candidates" value={plan.newRows.length} tone="positive" icon={CheckCircle2} />
        <Stat label={plan.completeRows.length ? `Duplicates skipped · ${plan.completeRows.length} added-from-file completed` : "Duplicates skipped"} value={plan.exactRows.length + plan.completeRows.length} icon={Copy} />
        <Stat label="Possible duplicates" value={plan.possibleRows.length} tone={plan.possibleRows.length ? "warning" : undefined} icon={HelpCircle} />
        <Stat label="Unassigned role" value={plan.unassignedRows.length} tone={plan.unassignedRows.length ? "warning" : undefined} icon={AlertTriangle} />
        <Stat label="Rows with errors" value={plan.counts.errors} tone={plan.counts.errors ? "danger" : undefined} icon={Ban} />
      </div>

      {parse.emptyRowsSkipped > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">{parse.emptyRowsSkipped} completely empty row(s) were ignored.</p>
      )}

      <Tabs defaultValue={needsAttention}>
        <TabsList>
          <TabsTrigger value="new">New <Count n={plan.newRows.length} /></TabsTrigger>
          <TabsTrigger value="possible">Possible duplicates <Count n={plan.possibleRows.length} warn /></TabsTrigger>
          <TabsTrigger value="unassigned">Unassigned <Count n={plan.unassignedRows.length} warn /></TabsTrigger>
          <TabsTrigger value="exact">Duplicates skipped <Count n={plan.exactRows.length} /></TabsTrigger>
          {plan.completeRows.length > 0 && <TabsTrigger value="complete">Added earlier from a file <Count n={plan.completeRows.length} /></TabsTrigger>}
          <TabsTrigger value="errors">Errors <Count n={parse.errors.length} danger /></TabsTrigger>
          <TabsTrigger value="warnings">Warnings <Count n={warningsCount} /></TabsTrigger>
        </TabsList>

        <TabsContent value="new">
          <Explain>These candidates are new and will be added to <b>Shortlisted</b>.</Explain>
          <CandidateList rows={plan.newRows} />
        </TabsContent>

        <TabsContent value="possible">
          <Explain>
            The phone <b>or</b> email matches someone already in this role, but the other details differ. Choose for each
            row. <b>Skip</b> is the default.
          </Explain>
          {plan.possibleRows.length > 0 && (
            <BulkBar>
              <Button size="sm" variant="outline" onClick={() => props.onBulkFlag("skip")}>Skip all</Button>
              <Button size="sm" variant="outline" onClick={() => props.onBulkFlag("add")}>Add all as new</Button>
            </BulkBar>
          )}
          <PossibleList {...props} />
        </TabsContent>

        <TabsContent value="unassigned">
          <Explain>
            The role couldn&apos;t be detected from the Job Title. Choose ZBM or HOS, or skip the row. Keyword rules can be
            changed in Settings.
          </Explain>
          {plan.unassignedRows.length > 0 && (
            <BulkBar>
              <Button size="sm" variant="outline" onClick={() => props.onBulkRole("ZBM")}>All → ZBM</Button>
              <Button size="sm" variant="outline" onClick={() => props.onBulkRole("HOS")}>All → HOS</Button>
              <Button size="sm" variant="outline" onClick={() => props.onBulkRole("skip")}>Skip all</Button>
            </BulkBar>
          )}
          <UnassignedList {...props} />
        </TabsContent>

        <TabsContent value="exact">
          <Explain>
            Name, phone and email all match a saved candidate in the same role. They are skipped, and the existing
            candidate&apos;s stage and history are not touched.
          </Explain>
          <ExactList rows={plan.exactRows} />
        </TabsContent>

        <TabsContent value="complete">
          <Explain>
            These people were added earlier from a test-results file or interviewer list (same role and mobile). They are not added again:
            their missing details are filled in from this file, and their stage, tags and history stay as they are.
          </Explain>
          <CompleteList rows={plan.completeRows} />
        </TabsContent>

        <TabsContent value="errors">
          <Explain>These rows can&apos;t be imported. Fix them in Naukri and upload again if needed.</Explain>
          <Empty show={!parse.errors.length}>No errors.</Empty>
          {parse.errors.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Problem</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {parse.errors.map((e) => (
                  <TableRow key={e.rowNumber}>
                    <TableCell className="text-muted-foreground">{e.rowNumber}</TableCell>
                    <TableCell>{e.name ?? "—"}</TableCell>
                    <TableCell className="text-red-700">{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="warnings">
          <Explain>These candidates will be imported, but something in their row needs a look.</Explain>
          <Empty show={!warningsCount}>No warnings.</Empty>
          {warningsCount > 0 && (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Note</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {plan.toImport
                  .filter((r) => r.parsed.warnings.length)
                  .map((r) => (
                    <TableRow key={r.parsed.rowNumber}>
                      <TableCell className="text-muted-foreground">{r.parsed.rowNumber}</TableCell>
                      <TableCell>{r.parsed.candidate.name}</TableCell>
                      <TableCell className="text-amber-800">{r.parsed.warnings.join(" · ")}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ lists

function CandidateList({ rows }: { rows: PlannedRow[] }) {
  if (!rows.length) return <Empty show>No new candidates in this file.</Empty>;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Experience</TableHead>
            <TableHead>Salary (L)</TableHead>
            <TableHead>Applied</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, PREVIEW_LIMIT).map((r) => {
            const c = r.parsed.candidate;
            return (
              <TableRow key={r.parsed.rowNumber}>
                <TableCell className="text-muted-foreground">{r.parsed.rowNumber}</TableCell>
                <TableCell><RoleBadge role={r.role} /></TableCell>
                <TableCell className="font-medium">
                  {c.name}
                  {r.parsed.warnings.length > 0 && (
                    <span title={r.parsed.warnings.join("\n")}>
                      <Info className="ml-1 inline size-3.5 text-amber-600" />
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{c.primary_phone ?? <span className="text-red-600">invalid</span>}</TableCell>
                <TableCell className="max-w-52 truncate">{c.email ?? "—"}</TableCell>
                <TableCell>{c.current_location ?? "—"}</TableCell>
                <TableCell>{c.total_exp_months !== null ? `${(c.total_exp_months / 12).toFixed(1)} yrs` : "—"}</TableCell>
                <TableCell>{c.salary_lakhs ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(c.applied_on)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <MoreNote shown={Math.min(rows.length, PREVIEW_LIMIT)} total={rows.length} />
    </>
  );
}

function PossibleList({ plan, flagDecisions, onFlagDecision }: UploadPreviewProps) {
  if (!plan.possibleRows.length) return <Empty show>No possible duplicates.</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Row</TableHead>
          <TableHead>In this file</TableHead>
          <TableHead>Already in the tracker</TableHead>
          <TableHead>What matches</TableHead>
          <TableHead className="text-right">Decision</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {plan.possibleRows.map((r) => {
          const c = r.parsed.candidate;
          const matches = r.classification?.kind === "possible" ? r.classification.matches : [];
          const decision = flagDecisions[r.parsed.rowNumber] ?? "skip";
          return (
            <TableRow key={r.parsed.rowNumber} className={cn(decision === "add" && "bg-emerald-50/60")}>
              <TableCell className="align-top text-muted-foreground">{r.parsed.rowNumber}</TableCell>
              <TableCell className="align-top">
                <div className="font-medium">{c.name} <RoleBadge role={r.role} /></div>
                <div className="font-mono text-xs text-muted-foreground">{c.primary_phone ?? "no mobile"}</div>
                <div className="text-xs text-muted-foreground">{c.email ?? "no email"}</div>
              </TableCell>
              <TableCell className="align-top">
                {matches.map((m, i) => <MatchCell key={i} m={m} />)}
              </TableCell>
              <TableCell className="align-top">
                {matches.map((m, i) => (
                  <div key={i} className="mb-1 flex flex-wrap gap-1">
                    {m.primary_phone && m.primary_phone === c.primary_phone && <Badge color="#0284c7">same phone</Badge>}
                    {m.email_norm && m.email_norm === c.email_norm && <Badge color="#7c3aed">same email</Badge>}
                    {m.primary_phone !== c.primary_phone && <Badge color="#d97706">phone differs</Badge>}
                    {m.email_norm !== c.email_norm && <Badge color="#d97706">email differs</Badge>}
                    {normaliseName(m.name) !== c.name_norm && <Badge color="#d97706">name differs</Badge>}
                  </div>
                ))}
              </TableCell>
              <TableCell className="text-right align-top">
                <Segmented<FlagDecision>
                  value={decision}
                  onChange={(d) => onFlagDecision(r.parsed.rowNumber, d)}
                  options={[
                    { value: "skip", label: "Skip" },
                    { value: "add", label: "Add as new", tone: "positive" },
                  ]}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function MatchCell({ m }: { m: Match }) {
  if (m.source === "file") {
    return (
      <div className="mb-1">
        <div className="font-medium">{m.name}</div>
        <div className="text-xs text-muted-foreground">Earlier row {m.rowNumber} of this same file</div>
      </div>
    );
  }
  return (
    <div className="mb-1">
      <div className="font-medium">{m.name}</div>
      <div className="font-mono text-xs text-muted-foreground">{m.primary_phone ?? "no mobile"}</div>
      <div className="text-xs text-muted-foreground">{m.email_norm ?? "no email"}</div>
      <div className="mt-0.5 text-xs">
        Stage: <b>{m.stage_name}</b> · added {formatDate(m.created_at)}
      </div>
    </div>
  );
}

function UnassignedList({ plan, roleDecisions, onRoleDecision }: UploadPreviewProps) {
  if (!plan.unassignedRows.length) return <Empty show>Every row&apos;s role was detected.</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Row</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Job Title</TableHead>
          <TableHead>Why</TableHead>
          <TableHead>Then</TableHead>
          <TableHead className="text-right">Assign to</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {plan.unassignedRows.map((r) => {
          const decision = roleDecisions[r.parsed.rowNumber] ?? "skip";
          const k = r.classification?.kind;
          return (
            <TableRow key={r.parsed.rowNumber}>
              <TableCell className="text-muted-foreground">{r.parsed.rowNumber}</TableCell>
              <TableCell className="font-medium">{r.parsed.candidate.name}</TableCell>
              <TableCell className="max-w-72 truncate" title={r.parsed.candidate.job_title ?? ""}>
                {r.parsed.candidate.job_title ?? "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.parsed.roleProblem === "ambiguous" ? "Matches both ZBM and HOS keywords" : "No keyword matched"}
              </TableCell>
              <TableCell className="text-xs">
                {k === "new" && <span className="text-emerald-700">will be added</span>}
                {k === "exact" && <span className="text-muted-foreground">exact duplicate — skipped</span>}
                {k === "possible" && <span className="text-amber-700">possible duplicate — see that tab</span>}
                {!k && <span className="text-muted-foreground">skipped</span>}
              </TableCell>
              <TableCell className="text-right">
                <Segmented<RoleDecision>
                  value={decision}
                  onChange={(d) => onRoleDecision(r.parsed.rowNumber, d)}
                  options={[
                    { value: "skip", label: "Skip" },
                    { value: "ZBM", label: "ZBM", tone: "positive" },
                    { value: "HOS", label: "HOS", tone: "positive" },
                  ]}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function CompleteList({ rows }: { rows: PlannedRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Row</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Mobile</TableHead>
          <TableHead>Stage now</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, PREVIEW_LIMIT).map((r) => (
          <TableRow key={r.parsed.rowNumber}>
            <TableCell className="text-muted-foreground">{r.parsed.rowNumber}</TableCell>
            <TableCell><RoleBadge role={r.role} /></TableCell>
            <TableCell>{r.parsed.candidate.name}</TableCell>
            <TableCell className="font-mono text-xs">{r.parsed.candidate.primary_phone ?? "—"}</TableCell>
            <TableCell>{r.classification?.kind === "complete" ? r.classification.candidate.stage_name : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExactList({ rows }: { rows: PlannedRow[] }) {
  if (!rows.length) return <Empty show>No exact duplicates.</Empty>;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Already in the tracker as</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, PREVIEW_LIMIT).map((r) => {
            const c = r.parsed.candidate;
            const m = r.classification?.kind === "exact" ? r.classification.match : null;
            return (
              <TableRow key={r.parsed.rowNumber}>
                <TableCell className="text-muted-foreground">{r.parsed.rowNumber}</TableCell>
                <TableCell><RoleBadge role={r.role} /></TableCell>
                <TableCell>{c.name}</TableCell>
                <TableCell className="font-mono text-xs">{c.primary_phone ?? "—"}</TableCell>
                <TableCell>{c.email ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {m?.source === "database" ? (
                    <>Stage <b>{m.stage_name}</b> · added {formatDate(m.created_at)}</>
                  ) : m?.source === "file" ? (
                    <>Same as row {m.rowNumber} of this file</>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <MoreNote shown={Math.min(rows.length, PREVIEW_LIMIT)} total={rows.length} />
    </>
  );
}

// ------------------------------------------------------------------ small pieces

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: "positive" | "warning" | "danger";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={cn(
        "glass rounded-2xl p-3",
        tone === "positive" && "border-emerald-200 bg-emerald-50",
        tone === "warning" && "border-amber-200 bg-amber-50",
        tone === "danger" && "border-red-200 bg-red-50",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "positive" && "text-emerald-700",
          tone === "warning" && "text-amber-700",
          tone === "danger" && "text-red-700",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Count({ n, warn, danger }: { n: number; warn?: boolean; danger?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-[11px] tabular-nums",
        n && danger ? "bg-red-100 text-red-700" : n && warn ? "bg-amber-100 text-amber-800" : "bg-background",
      )}
    >
      {n}
    </span>
  );
}

export function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <Badge>—</Badge>;
  return <Badge color={ROLE_COLORS[role]}>{role}</Badge>;
}

function Explain({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm text-muted-foreground">{children}</p>;
}
function BulkBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap gap-2">{children}</div>;
}
function Empty({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="glass flex items-center gap-2 rounded-2xl border-dashed p-6 text-sm text-muted-foreground">
      <FileWarning className="size-4" /> {children}
    </div>
  );
}
function MoreNote({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null;
  return <p className="mt-2 text-xs text-muted-foreground">Showing the first {shown} of {total} rows. All {total} are included.</p>;
}
