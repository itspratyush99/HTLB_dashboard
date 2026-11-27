"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarCheck, CheckCircle2, FileSpreadsheet, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { readSheet } from "@/lib/naukri/read";
import { normaliseName } from "@/lib/naukri/clean";
import type { Role } from "@/lib/naukri/types";
import { findByNames } from "@/lib/test-results/apply";
import { planNewPeople, roleFromFileName, type SameNameCandidate } from "@/lib/test-results/parse";
import { applyInterviewList, findPeopleByPhones, type ListApplyResult } from "@/lib/interview-list/apply";
import { formatInterviewTime, interviewerFromFileName, parseInterviewFile, planInterviewList, type FoundPerson, type ListFile } from "@/lib/interview-list/parse";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dropzone } from "./dropzone";
import { List, RoleTag, Stat } from "./test-results-wizard";

type Stage = { id: number; name: string; position: number; requires_interviewer: boolean };
type Interviewer = { id: number; name: string; color: string };
type Loaded = { file: File; data: ListFile; found: FoundPerson[]; oneToOne: Stage; interviewers: Interviewer[]; sameNames: Record<Role, SameNameCandidate[]> };
type Step =
  | { name: "pick" }
  | { name: "reading"; file: File }
  | { name: "rejected"; file: File; message: string }
  | { name: "preview"; loaded: Loaded }
  | { name: "done"; file: File; result: ListApplyResult; interviewer: string; stage: string };

/**
 * Upload a booking export of everyone aligned with one interviewer. The tracker finds them by mobile,
 * asks whose candidates they are, and moves them to 1:1 Aligned with that interviewer.
 */
export function InterviewListWizard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<Step>({ name: "pick" });
  const [interviewerId, setInterviewerId] = useState<number | null>(null);
  const [reassign, setReassign] = useState(false);
  const [markRescheduled, setMarkRescheduled] = useState(true);
  const [addNew, setAddNew] = useState(true);
  const [addRole, setAddRole] = useState<Role | null>(null);
  const [includeSameName, setIncludeSameName] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File) {
    setStep({ name: "reading", file });
    try {
      const [buffer, stagesRes, ivRes] = await Promise.all([
        file.arrayBuffer(),
        supabase.from("stages").select("id, name, position, requires_interviewer").order("position"),
        supabase.from("interviewers").select("id, name, color").eq("is_active", true).order("name"),
      ]);
      if (stagesRes.error) throw new Error(stagesRes.error.message);
      if (ivRes.error) throw new Error(ivRes.error.message);
      const oneToOne = ((stagesRes.data ?? []) as Stage[]).find((s) => s.requires_interviewer);
      if (!oneToOne) return setStep({ name: "rejected", file, message: "No stage asks for an interviewer (Settings → Hiring stages)." });
      const interviewers = (ivRes.data ?? []) as Interviewer[];
      if (!interviewers.length) return setStep({ name: "rejected", file, message: "No active interviewers. Add one in Settings → Interviewers first." });

      const data = parseInterviewFile(readSheet(buffer, file.name));
      if (data.missingColumns.length) return setStep({ name: "rejected", file, message: "No mobile column found. The file needs a column with the phone / mobile number." });
      if (!data.rows.length) return setStep({ name: "rejected", file, message: "No rows with a valid mobile number." });
      const found = await findPeopleByPhones(supabase, data.rows.map((r) => r.phone));
      const foundPhones = new Set(found.map((c) => c.primary_phone));
      const missingNames = data.rows.filter((r) => !foundPhones.has(r.phone) && r.name).map((r) => normaliseName(r.name!));
      const [zbm, hos] = await Promise.all([findByNames(supabase, "ZBM", missingNames), findByNames(supabase, "HOS", missingNames)]);

      setInterviewerId(interviewerFromFileName(file.name, interviewers)?.id ?? null);
      setAddRole(roleFromFileName(file.name) ?? (found.length && found.every((c) => c.role === found[0].role) ? found[0].role : null));
      setReassign(false);
      setMarkRescheduled(true);
      setAddNew(true);
      setIncludeSameName(false);
      setStep({ name: "preview", loaded: { file, data, found, oneToOne, interviewers, sameNames: { ZBM: zbm, HOS: hos } } });
    } catch (e) {
      setStep({ name: "rejected", file, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const loaded = step.name === "preview" ? step.loaded : null;
  const interviewer = loaded?.interviewers.find((i) => i.id === interviewerId) ?? null;
  const plan = useMemo(
    () => (loaded && interviewer ? planInterviewList(loaded.data, loaded.found, { oneToOne: loaded.oneToOne, interviewerId: interviewer.id }) : null),
    [loaded, interviewer],
  );
  const people = useMemo(
    () => (plan && loaded && addNew && addRole ? planNewPeople(plan.notFound, loaded.sameNames[addRole], includeSameName) : null),
    [plan, loaded, addNew, addRole, includeSameName],
  );
  const toAddCount = people?.toAdd.length ?? 0;
  const needsRole = addNew && !addRole && (plan?.notFound.length ?? 0) > 0;
  const moveCount = plan ? plan.toAssign.length + (reassign ? plan.otherInterviewer.length : 0) : 0;
  const reschedCount = plan && markRescheduled ? plan.timeChanged.filter((p) => reassign || p.candidate.interviewer_id === interviewer?.id).length : 0;
  const notAdded = plan ? (people ? plan.notFound.length - toAddCount : plan.notFound.length) : 0;
  const hasTimes = !!(loaded && (loaded.data.columns.when || loaded.data.columns.date));
  const nothingToDo = !moveCount && !toAddCount && !reschedCount && !(hasTimes && plan?.already.some((p) => p.row.when));

  async function apply() {
    if (!loaded || !plan || !interviewer) return;
    setSaving(true);
    try {
      const result = await applyInterviewList(supabase, {
        fileName: loaded.file.name,
        fileSize: loaded.file.size,
        file: loaded.data,
        plan,
        interviewer,
        oneToOne: loaded.oneToOne,
        reassign,
        markRescheduled,
        add: people && addRole ? { role: addRole, people } : null,
      });
      toast.success(`${result.assigned + result.added} now with ${interviewer.name} in ${loaded.oneToOne.name}`);
      setStep({ name: "done", file: loaded.file, result, interviewer: interviewer.name, stage: loaded.oneToOne.name });
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
          A booking / calendar export (CSV or Excel) of everyone aligned with one interviewer. People are matched by mobile number, in both ZBM and HOS.
          Put the interviewer&apos;s name in the file name (e.g. <i>Parul_bookings.csv</i>) and they&apos;re picked for you.
        </p>
      </div>
    );
  }

  const file = step.name === "preview" ? step.loaded.file : step.file;
  const when = (iso: string | null) => formatInterviewTime(iso);
  return (
    <div className="flex flex-col gap-6">
      <div className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <FileSpreadsheet className="size-5 shrink-0 text-emerald-600" />
          <p className="truncate text-sm font-medium">{file.name}</p>
        </div>
        {step.name !== "done" && <Button variant="ghost" size="sm" onClick={() => setStep({ name: "pick" })}><RotateCcw /> Choose another file</Button>}
      </div>

      {step.name === "reading" && (
        <Card><CardContent className="flex items-center gap-3 p-8 text-sm"><Loader2 className="size-5 animate-spin text-primary" /> Reading the file and finding candidates…</CardContent></Card>
      )}
      {step.name === "rejected" && (
        <Card className="border-red-200 bg-red-50/80"><CardContent className="flex items-start gap-3 p-6 text-sm text-red-800"><XCircle className="mt-0.5 size-5 shrink-0" /><div><p className="font-medium">Nothing was changed.</p><p className="mt-1">{step.message}</p></div></CardContent></Card>
      )}

      {step.name === "preview" && loaded && (
        <>
          {/* 1. Whose candidates are these? */}
          <div className={cn("glass flex flex-col gap-3 rounded-2xl p-4", !interviewer && "ring-2 ring-[#c9a227]")}>
            <p className="text-sm font-semibold">
              {loaded.data.rows.length} people in this file. Whose 1:1 are they?
            </p>
            <div className="flex flex-wrap gap-2">
              {loaded.interviewers.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setInterviewerId(i.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                    interviewerId === i.id ? "border-primary bg-primary text-white" : "border-black/10 bg-white/70 hover:bg-white",
                  )}
                >
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: interviewerId === i.id ? "#fff" : i.color }} />
                  {i.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              They move to <b>{loaded.oneToOne.name}</b> with this interviewer.
              {hasTimes
                ? <> The booking time (column <i>{loaded.data.columns.when ?? `${loaded.data.columns.date}${loaded.data.columns.time ? ` + ${loaded.data.columns.time}` : ""}`}</i>) is saved as their 1:1 date.</>
                : " No booking date/time column found, so no 1:1 dates are saved."}
            </p>
          </div>

          {!interviewer && <p className="text-center text-sm text-muted-foreground">Choose the interviewer to see who moves.</p>}

          {plan && interviewer && (
            <>
              <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl p-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="size-4 accent-[#1f4d36]" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} />
                  Add people who aren&apos;t in the tracker
                </label>
                {addNew && (
                  <label className="flex items-center gap-2 text-sm">
                    as
                    <select
                      className={cn("h-9 rounded-lg border bg-white/80 px-2 text-sm", needsRole ? "border-amber-500" : "border-black/10")}
                      value={addRole ?? ""}
                      onChange={(e) => setAddRole((e.target.value || null) as Role | null)}
                    >
                      <option value="">Choose role…</option>
                      <option value="ZBM">ZBM</option>
                      <option value="HOS">HOS</option>
                    </select>
                  </label>
                )}
                <p className="w-full text-xs text-muted-foreground">
                  {addNew
                    ? <>They&apos;re added with the name, mobile and email from this file, straight into <b>{loaded.oneToOne.name}</b> with {interviewer.name}. A later Naukri upload fills in their other details.</>
                    : "Only people already in the tracker are moved."}
                  {needsRole && " Choose ZBM or HOS for them."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <Stat label="Rows in file" value={loaded.data.rows.length + loaded.data.errors.length + loaded.data.duplicatesInFile} />
                <Stat label={`Will move to ${interviewer.name}`} value={moveCount} tone={moveCount ? "positive" : undefined} />
                <Stat label={`Will be added${addRole && addNew ? ` to ${addRole}` : ""}`} value={toAddCount} tone={toAddCount ? "positive" : undefined} />
                <Stat label={`Already with ${interviewer.name}`} value={plan.already.length} />
                <Stat label="With another interviewer" value={plan.otherInterviewer.length} tone={plan.otherInterviewer.length && !reassign ? "warning" : undefined} />
                <Stat label="Not changed / not added" value={plan.further.length + notAdded + loaded.data.errors.length} tone={notAdded ? "warning" : undefined} />
              </div>

              <Tabs defaultValue="move">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="move">Will move ({plan.toAssign.length})</TabsTrigger>
                  {people && <TabsTrigger value="add">Will add ({toAddCount})</TabsTrigger>}
                  {plan.otherInterviewer.length > 0 && <TabsTrigger value="other">With another interviewer ({plan.otherInterviewer.length})</TabsTrigger>}
                  {plan.timeChanged.length > 0 && <TabsTrigger value="time">New booking time ({plan.timeChanged.length})</TabsTrigger>}
                  <TabsTrigger value="already">Already with {interviewer.name} ({plan.already.length})</TabsTrigger>
                  {plan.further.length > 0 && <TabsTrigger value="further">Further along ({plan.further.length})</TabsTrigger>}
                  {people && people.sameName.length > 0 && <TabsTrigger value="same">Same name in tracker ({people.sameName.length})</TabsTrigger>}
                  <TabsTrigger value="notfound">{people ? `No name (${people.noName.length})` : `Not in tracker (${plan.notFound.length})`}</TabsTrigger>
                  {loaded.data.errors.length > 0 && <TabsTrigger value="errors">No valid mobile ({loaded.data.errors.length})</TabsTrigger>}
                </TabsList>

                <TabsContent value="move">
                  <List
                    head={["Name", "Role", "Mobile", "Stage now", "1:1 time"]}
                    rows={plan.toAssign.map((p) => [p.candidate.name, <RoleTag key="r" role={p.candidate.role} />, p.row.phone, p.candidate.stage_name, when(p.row.when)])}
                    empty="Nobody to move."
                  />
                </TabsContent>
                {people && (
                  <TabsContent value="add">
                    <List
                      head={["Name", "Mobile", "Email", "1:1 time"]}
                      rows={people.toAdd.map((r) => [r.name ?? "—", r.phone, r.email ?? "—", when(r.when)])}
                      empty="Nobody new to add."
                    />
                  </TabsContent>
                )}
                <TabsContent value="other">
                  <label className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="size-4 accent-[#1f4d36]" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
                    Move these {plan.otherInterviewer.length} to {interviewer.name}
                  </label>
                  <p className="mb-3 text-xs text-muted-foreground">Not changed unless ticked.</p>
                  <List
                    head={["Name", "Role", "Mobile", "Interviewer now", "1:1 time in file"]}
                    rows={plan.otherInterviewer.map((p) => [p.candidate.name, <RoleTag key="r" role={p.candidate.role} />, p.row.phone, p.candidate.interviewer_name ?? "—", when(p.row.when)])}
                    empty="None."
                  />
                </TabsContent>
                <TabsContent value="time">
                  <label className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="size-4 accent-[#1f4d36]" checked={markRescheduled} onChange={(e) => setMarkRescheduled(e.target.checked)} />
                    Mark them <b>Rescheduled</b>
                  </label>
                  <p className="mb-3 text-xs text-muted-foreground">Already in {loaded.oneToOne.name}, and the file has a different booking time from the one saved. The new time is saved either way.</p>
                  <List
                    head={["Name", "Role", "Interviewer", "Saved time", "New time"]}
                    rows={plan.timeChanged.map((p) => [p.candidate.name, <RoleTag key="r" role={p.candidate.role} />, p.candidate.interviewer_name ?? "—", when(p.candidate.interview_at), when(p.row.when)])}
                    empty="None."
                  />
                </TabsContent>
                <TabsContent value="already">
                  <List
                    head={["Name", "Role", "Mobile", "1:1 time"]}
                    rows={plan.already.map((p) => [p.candidate.name, <RoleTag key="r" role={p.candidate.role} />, p.row.phone, when(p.row.when ?? p.candidate.interview_at)])}
                    empty="None."
                  />
                </TabsContent>
                <TabsContent value="further">
                  <p className="mb-3 text-xs text-muted-foreground">Already past {loaded.oneToOne.name}, so they&apos;re not moved back.</p>
                  <List head={["Name", "Role", "Mobile", "Stage now"]} rows={plan.further.map((p) => [p.candidate.name, <RoleTag key="r" role={p.candidate.role} />, p.row.phone, p.candidate.stage_name])} empty="None." />
                </TabsContent>
                {people && people.sameName.length > 0 && (
                  <TabsContent value="same">
                    <p className="mb-3 text-sm text-muted-foreground">
                      Mobile not in the tracker, but the <b>same name</b> is already in {addRole}: usually the same person with another number. Not added unless ticked; check them and move the existing person by hand.
                    </p>
                    <label className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" className="size-4 accent-[#1f4d36]" checked={includeSameName} onChange={(e) => setIncludeSameName(e.target.checked)} />
                      Add these {people.sameName.length} as new people anyway
                    </label>
                    <List
                      head={["Name", "Mobile in file", "Already in tracker"]}
                      rows={people.sameName.map((x) => [x.row.name ?? "—", x.row.phone, x.matches.map((m) => `${m.primary_phone ?? "no mobile"} · ${m.stage_name}`).join(", ")])}
                      empty="None."
                    />
                  </TabsContent>
                )}
                <TabsContent value="notfound">
                  <List head={["Row", "Name", "Mobile"]} rows={(people ? people.noName : plan.notFound).map((r) => [r.rowNumber, r.name ?? "—", r.phone])} empty="None." />
                </TabsContent>
                <TabsContent value="errors">
                  <List head={["Row", "Name", "Problem"]} rows={loaded.data.errors.map((e) => [e.rowNumber, e.name ?? "—", e.message])} empty="None." />
                </TabsContent>
              </Tabs>

              <div className="glass sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
                <p className="text-sm">
                  {needsRole ? (
                    <span className="text-amber-700">Choose ZBM or HOS for the people being added.</span>
                  ) : (
                    <>
                      Move <b>{moveCount}</b>{toAddCount ? <> and add <b>{toAddCount}</b></> : null} to <b>{interviewer.name}</b> in {loaded.oneToOne.name}
                      {reschedCount ? <>, mark <b>{reschedCount}</b> Rescheduled</> : null}?
                    </>
                  )}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep({ name: "pick" })} disabled={saving}>Cancel</Button>
                  <Button onClick={apply} disabled={saving || needsRole || nothingToDo}>
                    {saving ? <Loader2 className="animate-spin" /> : <ArrowRight />} Assign to {interviewer.name}
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {step.name === "done" && (
        <Card className="border-emerald-200 bg-emerald-50/80">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="size-6 text-emerald-600" />
              <div>
                <p className="font-semibold">
                  {step.result.assigned} moved{step.result.added ? ` and ${step.result.added} added` : ""} — now with {step.interviewer} in {step.stage}
                </p>
                <p className="text-sm text-muted-foreground">
                  {step.result.timesSaved} 1:1 time{step.result.timesSaved === 1 ? "" : "s"} saved{step.result.rescheduled ? ` · ${step.result.rescheduled} marked Rescheduled` : ""}. Saved in Upload History and the Activity Log.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link href={`/uploads/${step.result.uploadId}`}>View details</Link></Button>
              <Button asChild variant="outline"><Link href="/zbm">Go to ZBM</Link></Button>
              <Button asChild variant="outline"><Link href="/hos">Go to HOS</Link></Button>
              <Button onClick={() => setStep({ name: "pick" })}><CalendarCheck /> Upload another interviewer list</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
