"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserPlus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/dates";
import { detectRole, type RoleKeyword } from "@/lib/naukri/roles";
import { ROLE_COLORS } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { createTeamUser, resetTeamUserPassword } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SettingsData {
  me: { id: string; is_admin: boolean };
  stages: { id: number; name: string; color: string; position: number; is_default: boolean; requires_interviewer: boolean; candidates: number }[];
  interviewers: { id: number; name: string; color: string; is_active: boolean; candidates: number }[];
  keywords: { id: number; role: "ZBM" | "HOS"; keyword: string; whole_word: boolean }[];
  thresholds: { maxDays: number; minConversion: number };
  team: { id: string; email: string; full_name: string; is_admin: boolean; is_active: boolean; created_at: string; access: "full" | "interviewer"; interviewer_id: number | null }[];
  canCreateUsers: boolean;
}

/** Colours offered for stages and interviewers (any other colour can be picked too). */
const SWATCHES = ["#64748b", "#0284c7", "#7c3aed", "#d97706", "#059669", "#db2777", "#1f4d36", "#9a7a12", "#dc2626", "#0d9488", "#2563eb", "#c026d3"];

/** Shared helper: run a Supabase call, show a toast, reload the page data. */
function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = async (op: () => PromiseLike<{ error: { message: string; code?: string } | null }>, success: string) => {
    const { error } = await op();
    if (error) {
      toast.error(
        error.code === "23505" ? "That name already exists." : error.code === "23514" ? "The name can't be empty." : error.message,
      );
      return false;
    }
    toast.success(success);
    start(() => router.refresh());
    return true;
  };
  return { save, pending };
}

export function SettingsView({ data }: { data: SettingsData }) {
  return (
    <Tabs defaultValue="stages">
      <TabsList>
        <TabsTrigger value="stages">Stages</TabsTrigger>
        <TabsTrigger value="interviewers">Interviewers</TabsTrigger>
        <TabsTrigger value="keywords">Role keywords</TabsTrigger>
        <TabsTrigger value="limits">Bottleneck limits</TabsTrigger>
        <TabsTrigger value="team">Team users</TabsTrigger>
      </TabsList>
      <TabsContent value="stages"><Stages data={data} /></TabsContent>
      <TabsContent value="interviewers"><Interviewers data={data} /></TabsContent>
      <TabsContent value="keywords"><Keywords data={data} /></TabsContent>
      <TabsContent value="limits"><Limits data={data} /></TabsContent>
      <TabsContent value="team"><Team data={data} /></TabsContent>
    </Tabs>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="glass max-w-3xl rounded-3xl p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("flex size-6 items-center justify-center rounded-full ring-offset-2 transition", value.toLowerCase() === c ? "ring-2 ring-gold" : "hover:scale-110")}
          style={{ backgroundColor: c }}
          aria-label={`Colour ${c}`}
        >
          {value.toLowerCase() === c && <Check className="size-3.5 text-white" />}
        </button>
      ))}
      <label className="relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-black/30" title="Any colour">
        <Plus className="size-3 text-muted-foreground" />
        <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

/** Text field that saves when you press Enter or leave it, if the text changed. */
function InlineName({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  const commit = () => {
    const t = text.trim();
    if (!t) return setText(value);
    if (t !== value) onSave(t);
  };
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className={cn("h-8 bg-transparent font-medium shadow-none hover:bg-white/70 focus-visible:bg-white", className)}
    />
  );
}

// ------------------------------------------------------------------ Stages

function Stages({ data }: { data: SettingsData }) {
  const supabase = useMemo(() => createClient(), []);
  const { save, pending } = useSave();
  const [editingColor, setEditingColor] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(SWATCHES[6]);
  const stages = data.stages;

  const move = (index: number, dir: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    save(() => supabase.rpc("reorder_stages", { p_ids: ids }), "Order saved");
  };

  return (
    <Panel
      title="Hiring stages"
      description="In funnel order. Candidates can be moved to any stage. Renaming a stage keeps all history; a stage can only be deleted when no candidate is in it."
    >
      <ol className="space-y-2">
        {stages.map((s, i) => (
          <li key={s.id} className="rounded-2xl border border-black/[0.06] bg-white/60 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-col">
                <button className="rounded p-0.5 text-muted-foreground hover:bg-black/5 disabled:opacity-25" disabled={i === 0 || pending} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></button>
                <button className="rounded p-0.5 text-muted-foreground hover:bg-black/5 disabled:opacity-25" disabled={i === stages.length - 1 || pending} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></button>
              </div>
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
              <button
                type="button"
                className="size-6 shrink-0 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: s.color }}
                onClick={() => setEditingColor(editingColor === s.id ? null : s.id)}
                aria-label="Change colour"
              />
              <InlineName value={s.name} className="min-w-0 flex-1 basis-40" onSave={(name) => save(() => supabase.from("stages").update({ name }).eq("id", s.id), `Renamed to ${name}`)} />
              <Badge color={s.color} className="hidden sm:inline-flex">{s.name}</Badge>
              <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{s.candidates} candidate{s.candidates === 1 ? "" : "s"}</span>
            </div>
            {editingColor === s.id && (
              <div className="mt-2 pl-12">
                <ColorPicker value={s.color} onChange={(color) => save(() => supabase.from("stages").update({ color }).eq("id", s.id), "Colour saved")} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 pl-12 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="default-stage"
                  className="accent-[var(--primary)]"
                  checked={s.is_default}
                  onChange={() => save(() => supabase.rpc("set_default_stage", { p_id: s.id }), `New candidates now start in ${s.name}`)}
                />
                New candidates start here
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={s.requires_interviewer}
                  onCheckedChange={(v) =>
                    save(() => supabase.from("stages").update({ requires_interviewer: v === true }).eq("id", s.id), v ? `${s.name} now asks for an interviewer` : `${s.name} no longer asks for an interviewer`)
                  }
                />
                Ask for an interviewer
              </label>
              <button
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-destructive hover:bg-red-50 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
                disabled={s.candidates > 0 || s.is_default || pending}
                title={s.is_default ? "Make another stage the default first" : s.candidates > 0 ? `Move the ${s.candidates} candidates out of this stage first` : "Delete this stage"}
                onClick={() => {
                  if (window.confirm(`Delete the stage "${s.name}"? Its history stays readable.`))
                    save(() => supabase.from("stages").delete().eq("id", s.id), `${s.name} deleted`);
                }}
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
            </div>
          </li>
        ))}
      </ol>

      <form
        className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-black/15 p-3 sm:flex-row sm:items-center"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return toast.error("Type a name for the new stage.");
          const position = Math.max(0, ...stages.map((s) => s.position)) + 1;
          if (await save(() => supabase.from("stages").insert({ name: newName.trim(), color: newColor, position }), `${newName.trim()} added at the end`)) setNewName("");
        }}
      >
        <Input placeholder="New stage name" value={newName} onChange={(e) => setNewName(e.target.value)} className="sm:max-w-60" />
        <ColorPicker value={newColor} onChange={setNewColor} />
        <Button type="submit" size="sm" disabled={pending} className="sm:ml-auto"><Plus /> Add stage</Button>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------------ Interviewers

function Interviewers({ data }: { data: SettingsData }) {
  const supabase = useMemo(() => createClient(), []);
  const { save, pending } = useSave();
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(SWATCHES[1]);
  const [editingColor, setEditingColor] = useState<number | null>(null);

  async function remove(id: number, name: string) {
    if (!window.confirm(`Remove ${name}?`)) return;
    const { data: result, error } = await supabase.rpc("remove_interviewer", { p_id: id });
    if (error) return toast.error(error.message);
    toast.success(result === "deleted" ? `${name} removed` : `${name} switched off: they still have candidates, so their tags and history are kept`);
    router.refresh();
  }

  return (
    <Panel
      title="Interviewers"
      description="Chosen when candidates move to a stage that asks for an interviewer (1:1 Aligned). Removing someone who still has candidates switches them off instead, so history is kept."
    >
      <ul className="space-y-2">
        {data.interviewers.map((i) => (
          <li key={i.id} className={cn("rounded-2xl border border-black/[0.06] bg-white/60 p-2.5", !i.is_active && "opacity-60")}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="size-6 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: i.color }} onClick={() => setEditingColor(editingColor === i.id ? null : i.id)} aria-label="Change colour" />
              <InlineName value={i.name} className="min-w-0 flex-1 basis-32" onSave={(name) => save(() => supabase.from("interviewers").update({ name }).eq("id", i.id), `Renamed to ${name}`)} />
              <Badge color={i.color}>{i.name}</Badge>
              <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{i.candidates} candidate{i.candidates === 1 ? "" : "s"}</span>
              <Segmented<"on" | "off">
                size="xs"
                value={i.is_active ? "on" : "off"}
                onChange={(v) => save(() => supabase.from("interviewers").update({ is_active: v === "on" }).eq("id", i.id), v === "on" ? `${i.name} switched on` : `${i.name} switched off`)}
                options={[{ value: "on", label: "Active", tone: "positive" }, { value: "off", label: "Off" }]}
              />
              <button className="rounded-full p-1.5 text-destructive hover:bg-red-50" onClick={() => remove(i.id, i.name)} aria-label={`Remove ${i.name}`} disabled={pending}>
                <Trash2 className="size-4" />
              </button>
            </div>
            {editingColor === i.id && (
              <div className="mt-2 pl-8">
                <ColorPicker value={i.color} onChange={(color) => save(() => supabase.from("interviewers").update({ color }).eq("id", i.id), "Colour saved")} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-black/15 p-3 sm:flex-row sm:items-center"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return toast.error("Type the interviewer's name.");
          if (await save(() => supabase.from("interviewers").insert({ name: newName.trim(), color: newColor }), `${newName.trim()} added`)) setNewName("");
        }}
      >
        <Input placeholder="New interviewer name" value={newName} onChange={(e) => setNewName(e.target.value)} className="sm:max-w-60" />
        <ColorPicker value={newColor} onChange={setNewColor} />
        <Button type="submit" size="sm" disabled={pending} className="sm:ml-auto"><Plus /> Add interviewer</Button>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------------ Role keywords

function Keywords({ data }: { data: SettingsData }) {
  const supabase = useMemo(() => createClient(), []);
  const { save, pending } = useSave();
  const [role, setRole] = useState<"ZBM" | "HOS">("ZBM");
  const [keyword, setKeyword] = useState("");
  const [wholeWord, setWholeWord] = useState(false);
  const [test, setTest] = useState("Zonal Business Manager (CTC 24 lac p.a)");
  const result = detectRole(test, data.keywords as RoleKeyword[]);

  return (
    <Panel
      title="Role detection keywords"
      description={`Matched against the "Job Title" column of each Naukri file, ignoring letter case. "Whole word" means letters can't touch it: HOS matches "HOS - Mumbai" but not "Hospital".`}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {(["ZBM", "HOS"] as const).map((r) => (
          <div key={r} className="rounded-2xl border border-black/[0.06] bg-white/60 p-3">
            <div className="mb-2 flex items-center gap-2"><Badge color={ROLE_COLORS[r]}>{r}</Badge><span className="text-xs text-muted-foreground">{r === "ZBM" ? "Zonal Business Manager" : "Head of States"}</span></div>
            <ul className="space-y-1.5">
              {data.keywords.filter((k) => k.role === r).map((k) => (
                <li key={k.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">&quot;{k.keyword}&quot;</span>
                  <Segmented<"word" | "contains">
                    size="xs"
                    value={k.whole_word ? "word" : "contains"}
                    onChange={(v) => save(() => supabase.from("role_keywords").update({ whole_word: v === "word" }).eq("id", k.id), "Saved")}
                    options={[{ value: "contains", label: "Contains" }, { value: "word", label: "Whole word" }]}
                  />
                  <button className="rounded-full p-1 text-destructive hover:bg-red-50" disabled={pending} aria-label={`Delete ${k.keyword}`} onClick={() => save(() => supabase.from("role_keywords").delete().eq("id", k.id), `"${k.keyword}" removed`)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
              {!data.keywords.some((k) => k.role === r) && <li className="text-xs text-amber-700">No keywords: every {r} row will be &quot;Unassigned&quot;.</li>}
            </ul>
          </div>
        ))}
      </div>

      <form
        className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-black/15 p-3 sm:flex-row sm:flex-wrap sm:items-center"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!keyword.trim()) return toast.error("Type a keyword.");
          if (await save(() => supabase.from("role_keywords").insert({ role, keyword: keyword.trim(), whole_word: wholeWord }), `"${keyword.trim()}" added to ${role}`)) setKeyword("");
        }}
      >
        <Segmented<"ZBM" | "HOS"> value={role} onChange={setRole} options={[{ value: "ZBM", label: "ZBM" }, { value: "HOS", label: "HOS" }]} />
        <Input placeholder='e.g. "Zonal Manager"' value={keyword} onChange={(e) => setKeyword(e.target.value)} className="sm:max-w-56" />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={wholeWord} onCheckedChange={(v) => setWholeWord(v === true)} /> Whole word</label>
        <Button type="submit" size="sm" disabled={pending} className="sm:ml-auto"><Plus /> Add keyword</Button>
      </form>

      <div className="mt-4 rounded-2xl bg-black/[0.03] p-3">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Wand2 className="size-4 text-gold-deep" /> Try a job title</p>
        <Input value={test} onChange={(e) => setTest(e.target.value)} />
        <p className="mt-2 text-sm">
          {result.role ? (
            <>Detected as <Badge color={ROLE_COLORS[result.role]}>{result.role}</Badge></>
          ) : result.problem === "ambiguous" ? (
            <span className="text-amber-700">Matches both roles → goes to &quot;Unassigned&quot; in the upload preview</span>
          ) : (
            <span className="text-amber-700">No keyword matches → goes to &quot;Unassigned&quot; in the upload preview</span>
          )}
        </p>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ Limits

function Limits({ data }: { data: SettingsData }) {
  const supabase = useMemo(() => createClient(), []);
  const { save, pending } = useSave();
  const [maxDays, setMaxDays] = useState(String(data.thresholds.maxDays));
  const [minConv, setMinConv] = useState(String(data.thresholds.minConversion));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const d = Number(maxDays), c = Number(minConv);
    if (!Number.isInteger(d) || d < 1 || d > 90) return toast.error("Max days in a stage must be a whole number from 1 to 90.");
    if (!(c >= 1 && c <= 100)) return toast.error("Minimum conversion must be from 1 to 100%.");
    await save(
      () => supabase.from("app_settings").upsert([{ key: "lag_max_days_in_stage", value: d }, { key: "lag_min_conversion_pct", value: c }]),
      "Limits saved. Analytics and the Dashboard use them straight away.",
    );
  }

  return (
    <Panel title="Bottleneck limits" description="Used by Analytics and the Dashboard to flag problems in red.">
      <form onSubmit={submit} className="grid max-w-md gap-4">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Max days in a stage</span>
          <span className="text-xs text-muted-foreground">Candidates in the same stage for longer are &quot;stuck&quot;. Default 3.</span>
          <div className="flex items-center gap-2"><Input type="number" min={1} max={90} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} className="w-28" /> days</div>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Minimum conversion to the next stage</span>
          <span className="text-xs text-muted-foreground">Below this, the stage is flagged as a bottleneck (only when at least 5 candidates entered it). Default 30%.</span>
          <div className="flex items-center gap-2"><Input type="number" min={1} max={100} value={minConv} onChange={(e) => setMinConv(e.target.value)} className="w-28" /> %</div>
        </label>
        <Button type="submit" disabled={pending} className="justify-self-start">{pending && <Loader2 className="animate-spin" />} Save limits</Button>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------------ Team users

type AccessChoice = "admin" | "full" | "interviewer";

function AccessBadge({ p, interviewers }: { p: SettingsData["team"][number]; interviewers: SettingsData["interviewers"] }) {
  if (!p.is_active) return <Badge color="#d03b3b">Switched off</Badge>;
  if (p.is_admin) return <Badge color="#9a7a12"><ShieldCheck className="mr-1 size-3" />Admin</Badge>;
  if (p.access === "interviewer")
    return <Badge color="#1f4d36">Interviewer: {interviewers.find((i) => i.id === p.interviewer_id)?.name ?? "not linked"}</Badge>;
  return <Badge>Team member</Badge>;
}

const randomPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

function Team({ data }: { data: SettingsData }) {
  const supabase = useMemo(() => createClient(), []);
  const { save, pending } = useSave();
  const router = useRouter();
  const admin = data.me.is_admin;
  const [form, setForm] = useState<{ fullName: string; email: string; password: string; access: AccessChoice; interviewerId: number | null }>({
    fullName: "", email: "", password: randomPassword(), access: "full", interviewerId: null,
  });
  const activeInterviewers = data.interviewers.filter((i) => i.is_active);
  /** "Parul Sharma" → the interviewer called Parul, if there is one. */
  const guessInterviewer = (name: string) =>
    activeInterviewers.find((i) => name.trim().toLowerCase().split(/\s+/)[0] === i.name.trim().toLowerCase().split(/\s+/)[0])?.id ?? activeInterviewers[0]?.id ?? null;
  const setAccess = (p: SettingsData["team"][number], choice: AccessChoice, interviewerId?: number | null) => {
    if (choice === "interviewer") {
      const iv = interviewerId ?? p.interviewer_id ?? guessInterviewer(p.full_name);
      if (!iv) return toast.error("Add an interviewer in the Interviewers tab first.");
      const name = data.interviewers.find((i) => i.id === iv)?.name;
      return save(() => supabase.from("profiles").update({ is_admin: false, access: "interviewer", interviewer_id: iv }).eq("id", p.id), `${p.full_name} now sees only ${name}'s candidates`);
    }
    return save(
      () => supabase.from("profiles").update({ is_admin: choice === "admin", access: "full", interviewer_id: null }).eq("id", p.id),
      choice === "admin" ? `${p.full_name} is now an admin` : `${p.full_name} is now a team member (sees all candidates)`,
    );
  };
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [resetFor, setResetFor] = useState<{ id: string; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await createTeamUser(form);
    setCreating(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.message);
    setCreated({ email: form.email.trim().toLowerCase(), password: form.password });
    setForm({ fullName: "", email: "", password: randomPassword(), access: "full", interviewerId: null });
    router.refresh();
  }

  return (
    <Panel
      title="Team users"
      description={
        admin
          ? "Choose each person's access: Admin (everything, manages people, can delete), Team member (all candidates), or Interviewer (only candidates tagged with their interviewer name). Switch someone off to lock them out; their history stays."
          : "Only admins can add people or change access. You can change your own display name."
      }
    >
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium">Access</th>
              <th className="pb-2 font-medium">Added</th>
              {admin && <th className="pb-2" />}
            </tr>
          </thead>
          <tbody>
            {data.team.map((p) => {
              const self = p.id === data.me.id;
              return (
                <tr key={p.id} className={cn("border-t border-black/[0.06]", !p.is_active && "opacity-60")}>
                  <td className="py-2 pr-2">
                    {admin || self ? (
                      <InlineName value={p.full_name} className="min-w-40" onSave={(full_name) => save(() => supabase.from("profiles").update({ full_name }).eq("id", p.id), "Name saved")} />
                    ) : (
                      <span className="font-medium">{p.full_name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-muted-foreground">{p.email}</td>
                  <td className="py-2 pr-2">
                    {admin && !self && p.is_active ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          className="h-8 rounded-lg border border-black/10 bg-white/80 px-2 text-sm"
                          value={p.is_admin ? "admin" : p.access}
                          disabled={pending}
                          onChange={(e) => setAccess(p, e.target.value as AccessChoice)}
                          aria-label={`Access for ${p.full_name}`}
                        >
                          <option value="admin">Admin</option>
                          <option value="full">Team member: all candidates</option>
                          <option value="interviewer">Interviewer: own candidates only</option>
                        </select>
                        {!p.is_admin && p.access === "interviewer" && (
                          <select
                            className="h-8 rounded-lg border border-black/10 bg-white/80 px-2 text-sm"
                            value={p.interviewer_id ?? ""}
                            disabled={pending}
                            onChange={(e) => setAccess(p, "interviewer", Number(e.target.value))}
                            aria-label={`Interviewer for ${p.full_name}`}
                          >
                            {!p.interviewer_id && <option value="">Choose…</option>}
                            {data.interviewers.map((i) => <option key={i.id} value={i.id} disabled={!i.is_active}>{i.name}</option>)}
                          </select>
                        )}
                      </div>
                    ) : (
                      <AccessBadge p={p} interviewers={data.interviewers} />
                    )}
                    {self && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-2 text-muted-foreground">{formatDate(p.created_at)}</td>
                  {admin && (
                    <td className="py-2 text-right">
                      {!self && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={pending} className={p.is_active ? "text-destructive" : ""} onClick={() => save(() => supabase.from("profiles").update({ is_active: !p.is_active }).eq("id", p.id), p.is_active ? `${p.full_name} switched off` : `${p.full_name} switched back on`)}>
                            {p.is_active ? "Switch off" : "Switch on"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setResetFor({ id: p.id, name: p.full_name }); setNewPassword(randomPassword()); }} aria-label={`New password for ${p.full_name}`}>
                            <KeyRound />
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {admin && (
        <form onSubmit={create} className="mt-5 grid gap-3 rounded-2xl border border-dashed border-black/15 p-4 sm:grid-cols-2">
          <p className="flex items-center gap-1.5 font-medium sm:col-span-2"><UserPlus className="size-4" /> Add a team member</p>
          {!data.canCreateUsers && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2">
              To add people from here, add the <b>SUPABASE_SERVICE_ROLE_KEY</b> setting in Vercel (README → &quot;Team users&quot;). Until then, add them in Supabase → Authentication → Users.
            </p>
          )}
          <Input placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input placeholder="Email" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="flex gap-2">
            <Input placeholder="Password (8+ characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono" />
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setForm({ ...form, password: randomPassword() })}>New</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-lg border border-black/10 bg-white/80 px-2 text-sm"
              value={form.access}
              onChange={(e) => {
                const access = e.target.value as AccessChoice;
                setForm({ ...form, access, interviewerId: access === "interviewer" ? form.interviewerId ?? guessInterviewer(form.fullName) : null });
              }}
              aria-label="Access"
            >
              <option value="full">Team member: all candidates</option>
              <option value="interviewer">Interviewer: own candidates only</option>
              <option value="admin">Admin</option>
            </select>
            {form.access === "interviewer" && (
              <select
                className="h-9 rounded-lg border border-black/10 bg-white/80 px-2 text-sm"
                value={form.interviewerId ?? ""}
                onChange={(e) => setForm({ ...form, interviewerId: Number(e.target.value) || null })}
                aria-label="Interviewer"
              >
                <option value="">Which interviewer?</option>
                {activeInterviewers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          </div>
          <Button type="submit" disabled={creating || !data.canCreateUsers} className="sm:col-span-2 sm:justify-self-start">
            {creating ? <Loader2 className="animate-spin" /> : <UserPlus />} Add team member
          </Button>
          {created && (
            <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 sm:col-span-2">
              Share these privately (e.g. WhatsApp to the person only): <b>{created.email}</b> / <span className="font-mono">{created.password}</span>. They can log in now.
            </p>
          )}
        </form>
      )}

      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New password for {resetFor?.name}</DialogTitle>
            <DialogDescription>They&apos;ll use it the next time they log in. Share it privately.</DialogDescription>
          </DialogHeader>
          <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="font-mono" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetFor(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!resetFor) return;
                const res = await resetTeamUserPassword(resetFor.id, newPassword);
                if (!res.ok) return toast.error(res.error);
                toast.success(res.message);
                setResetFor(null);
              }}
            >
              Set password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
