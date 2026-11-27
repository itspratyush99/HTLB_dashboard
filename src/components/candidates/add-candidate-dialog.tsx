"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { normaliseEmail, normaliseName, parsePhones } from "@/lib/naukri/clean";
import type { Interviewer, Role, RoleScope, ShortlistTag, Stage } from "@/lib/candidates/types";
import { findPeopleForList } from "@/lib/interview-list/apply";
import type { FoundPerson, ListRow } from "@/lib/interview-list/parse";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Form = Record<
  | "name" | "mobile" | "altMobile" | "email" | "city" | "preferred" | "hometown" | "company" | "designation"
  | "expYears" | "expMonths" | "ctc" | "notice" | "gender" | "ug" | "pg" | "headline" | "profileUrl" | "notes" | "oneToOneAt",
  string
>;
const EMPTY: Form = {
  name: "", mobile: "", altMobile: "", email: "", city: "", preferred: "", hometown: "", company: "", designation: "",
  expYears: "", expMonths: "", ctc: "", notice: "", gender: "", ug: "", pg: "", headline: "", profileUrl: "", notes: "", oneToOneAt: "",
};
const NOTICE = ["15 Days or less", "1 Month", "2 Months", "3 Months", "More than 3 Months", "Serving Notice Period"];

/**
 * Add one candidate by hand. Only the name is required. The tracker checks for people who may already be
 * in it (same name, mobile or email) before saving.
 */
export function AddCandidateDialog({
  open,
  onOpenChange,
  role,
  stages,
  interviewers,
  tags,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleScope;
  stages: Stage[];
  interviewers: Interviewer[];
  tags: ShortlistTag[];
  onAdded: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const defaultStage = stages.find((s) => s.is_default) ?? stages[0];
  const [form, setForm] = useState<Form>(EMPTY);
  const [pickedRole, setPickedRole] = useState<Role | "">(role === "ALL" ? "" : role);
  const [stageId, setStageId] = useState<number | null>(defaultStage?.id ?? null);
  const [interviewerId, setInterviewerId] = useState<number | null>(null);
  const [tagId, setTagId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [dupes, setDupes] = useState<FoundPerson[] | null>(null); // shown once; saving again = "Add anyway"
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setPickedRole(role === "ALL" ? "" : role);
    setStageId(defaultStage?.id ?? null);
    setInterviewerId(null);
    setTagId(null);
    setDupes(null);
    setShowMore(false);
  }, [open, role, defaultStage?.id]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (k === "name" || k === "mobile" || k === "email") setDupes(null);
  };
  const stage = stages.find((s) => s.id === stageId) ?? null;
  const mobile = form.mobile.trim() ? parsePhones(form.mobile).primary : null;
  const altMobile = form.altMobile.trim() ? parsePhones(form.altMobile).primary : null;
  const emailNorm = normaliseEmail(form.email.trim() || null);
  const problems = [
    !form.name.trim() && "Name is required",
    !pickedRole && "Choose ZBM or HOS",
    form.mobile.trim() && !mobile && "Mobile must be a 10-digit Indian number",
    form.altMobile.trim() && !altMobile && "Other mobile must be a 10-digit Indian number",
    form.email.trim() && !emailNorm && "Email doesn't look right",
    stage?.requires_interviewer && !interviewerId && `${stage.name} needs an interviewer`,
    form.ctc.trim() && !(Number(form.ctc) > 0) && "CTC must be a number of lakhs, e.g. 8.5",
  ].filter(Boolean) as string[];

  async function save() {
    if (problems.length || !pickedRole) return;
    setSaving(true);
    try {
      // 1. Possible duplicates (same name, mobile or email in this role) → show them once.
      if (dupes === null) {
        const row: ListRow = {
          rowNumber: 0, name: form.name.trim(), phone: mobile, email: form.email.trim() || null,
          nameNorm: normaliseName(form.name), emailNorm, whenText: null, when: null, raw: {},
        };
        const found = (await findPeopleForList(supabase, [row])).filter(
          (c) => c.role === pickedRole && (c.name_norm === row.nameNorm || (mobile && c.primary_phone === mobile) || (emailNorm && c.email_norm === emailNorm)),
        );
        if (found.length) {
          setDupes(found);
          return;
        }
      }
      // 2. Save.
      const years = Number(form.expYears) || 0;
      const months = Number(form.expMonths) || 0;
      const hasExp = form.expYears.trim() !== "" || form.expMonths.trim() !== "";
      const ctc = form.ctc.trim() ? Math.round(Number(form.ctc) * 100) / 100 : null;
      const t = (v: string) => v.trim() || null;
      const data = {
        name: form.name.trim().replace(/\s+/g, " "),
        name_norm: normaliseName(form.name),
        primary_phone: mobile,
        phone_raw: t(form.mobile),
        alternate_phone: altMobile,
        email: t(form.email),
        email_norm: emailNorm,
        current_location: t(form.city),
        preferred_locations: t(form.preferred),
        home_town: t(form.hometown),
        current_company: t(form.company),
        designation: t(form.designation),
        total_exp_months: hasExp ? years * 12 + months : null,
        total_exp_text: hasExp ? `${years} Year(s) ${months} Month(s)` : null,
        salary_lakhs: ctc,
        salary_text: ctc !== null ? `₹ ${ctc} Lacs` : null,
        notice_period: t(form.notice),
        gender: t(form.gender),
        ug_degree: t(form.ug),
        pg_degree: t(form.pg),
        resume_headline: t(form.headline),
        naukri_comments: t(form.notes),
        profile_url: t(form.profileUrl),
      };
      const { data: id, error } = await supabase.rpc("add_manual_candidate", {
        p_role: pickedRole,
        p_data: data,
        p_stage_id: stageId,
        p_interviewer_id: stage?.requires_interviewer ? interviewerId : null,
        p_interview_at: stage?.requires_interviewer && form.oneToOneAt ? new Date(`${form.oneToOneAt}:00+05:30`).toISOString() : null,
      });
      if (error) throw new Error(error.message);
      if (tagId && stage?.is_default) {
        const r = await supabase.rpc("set_shortlist_tag", { p_ids: [id], p_tag_id: tagId });
        if (r.error) toast.error("Added, but the tag wasn't set", { description: r.error.message });
      }
      toast.success(`${data.name} added to ${pickedRole}`);
      onOpenChange(false);
      onAdded(id as string);
    } catch (e) {
      toast.error("Couldn't add the candidate", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, k: keyof Form, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`add-${k}`} className="text-xs">{label}</Label>
      <Input id={`add-${k}`} value={form[k]} onChange={set(k)} {...props} />
    </div>
  );
  const select = "h-9 w-full rounded-lg border border-black/10 bg-white/80 px-2 text-sm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add candidate</DialogTitle>
          <DialogDescription>Only the name is required. Fill in whatever you know; you can leave the rest empty.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Role *</Label>
              <div className="flex gap-2">
                {(["ZBM", "HOS"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setPickedRole(r)}
                    className={cn(
                      "h-9 flex-1 rounded-lg border text-sm font-medium transition-colors",
                      pickedRole === r ? "border-primary bg-primary text-white" : "border-black/10 bg-white/70 hover:bg-white",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {field("Name *", "name", { autoFocus: true, placeholder: "Full name" })}
            {field("Mobile", "mobile", { inputMode: "tel", placeholder: "10-digit mobile" })}
            {field("Email", "email", { type: "email", placeholder: "name@example.com" })}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            {field("Current company", "company")}
            {field("Designation", "designation")}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Experience</Label>
              <div className="flex items-center gap-2">
                <Input value={form.expYears} onChange={set("expYears")} inputMode="numeric" placeholder="Years" aria-label="Experience years" />
                <Input value={form.expMonths} onChange={set("expMonths")} inputMode="numeric" placeholder="Months" aria-label="Experience months" />
              </div>
            </div>
            {field("Current CTC (lakhs)", "ctc", { inputMode: "decimal", placeholder: "e.g. 8.5" })}
            {field("Current city", "city")}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-notice" className="text-xs">Notice period</Label>
              <select id="add-notice" className={select} value={form.notice} onChange={set("notice")}>
                <option value="">—</option>
                {NOTICE.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
          </section>

          <section className="grid gap-3 rounded-2xl border border-black/[0.06] bg-white/50 p-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-stage" className="text-xs">Stage</Label>
              <select id="add-stage" className={select} value={stageId ?? ""} onChange={(e) => setStageId(Number(e.target.value) || null)}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {stage?.is_default && tags.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-tag" className="text-xs">Shortlisted tag</Label>
                <select id="add-tag" className={select} value={tagId ?? ""} onChange={(e) => setTagId(Number(e.target.value) || null)}>
                  <option value="">No tag</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            {stage?.requires_interviewer && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="add-iv" className="text-xs">Interviewer *</Label>
                  <select id="add-iv" className={select} value={interviewerId ?? ""} onChange={(e) => setInterviewerId(Number(e.target.value) || null)}>
                    <option value="">Choose…</option>
                    {interviewers.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                {field("1:1 date & time", "oneToOneAt", { type: "datetime-local" })}
              </>
            )}
          </section>

          {!showMore ? (
            <button type="button" className="self-start text-sm font-medium text-primary hover:underline" onClick={() => setShowMore(true)}>
              + More details (other mobile, education, notes…)
            </button>
          ) : (
            <section className="grid gap-3 sm:grid-cols-2">
              {field("Other mobile", "altMobile", { inputMode: "tel" })}
              {field("Preferred locations", "preferred")}
              {field("Home town", "hometown")}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-gender" className="text-xs">Gender</Label>
                <select id="add-gender" className={select} value={form.gender} onChange={set("gender")}>
                  <option value="">—</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </div>
              {field("UG degree", "ug")}
              {field("PG degree", "pg")}
              {field("Resume headline", "headline")}
              {field("Profile / resume link", "profileUrl", { type: "url", placeholder: "https://" })}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="add-notes" className="text-xs">Notes</Label>
                <textarea
                  id="add-notes"
                  rows={3}
                  value={form.notes}
                  onChange={set("notes")}
                  className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm"
                  placeholder="e.g. Referred by Umer, call after 6 pm"
                />
              </div>
            </section>
          )}

          {dupes && dupes.length > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-3 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" /> Already in {pickedRole}? {dupes.length === 1 ? "This person matches" : "These people match"}:
              </p>
              <ul className="mt-2 space-y-1">
                {dupes.map((d) => (
                  <li key={d.id}>
                    <b>{d.name}</b> · {d.primary_phone ?? "no mobile"} · {d.stage_name}
                    {d.interviewer_name ? ` · ${d.interviewer_name}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">Check before adding. Click <b>Add anyway</b> if this is a different person.</p>
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-2">
          {problems.length > 0 && form.name.trim() !== "" && <p className="mr-auto text-xs text-amber-700">{problems[0]}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || problems.length > 0}>
            {saving ? <Loader2 className="animate-spin" /> : <UserPlus />} {dupes?.length ? "Add anyway" : "Add candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
