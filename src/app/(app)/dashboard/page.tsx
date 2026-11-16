import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, Sparkles, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Dashboard · Candidate Tracker" };
export const dynamic = "force-dynamic";

type RoleStats = {
  total: number;
  new_today: number;
  new_week: number;
  stuck: number;
  stages: { id: number; name: string; color: string; position: number; requires_interviewer: boolean; count: number }[];
  interviewers: { id: number; name: string; color: string; count: number }[];
};

const ROLE_NAMES = { ZBM: "Zonal Business Manager", HOS: "Head of States" } as const;
const roleLink = (role: string, f: object) => `/${role.toLowerCase()}?f=${encodeURIComponent(JSON.stringify(f))}`;

/** Dashboard: one column per role with live counts. Every number links to the matching candidates. */
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_stats");

  return (
    <>
      <PageHeader title="Dashboard" description={`Live counts · ${formatDate(new Date())} (IST). "This week" starts on Monday.`} />
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          Couldn&apos;t load the dashboard: {error.message}
          {/does not exist/i.test(error.message) && (
            <p className="mt-2">Run <b>0005_dashboard_analytics.sql</b> in Supabase → SQL Editor, then reload.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {(["ZBM", "HOS"] as const).map((role) => (
            <RoleColumn key={role} role={role} s={(data as Record<string, RoleStats>)[role]} />
          ))}
        </div>
      )}
    </>
  );
}

function RoleColumn({ role, s }: { role: "ZBM" | "HOS"; s: RoleStats }) {
  const max = Math.max(1, ...s.stages.map((x) => x.count));
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {role} <span className="text-sm font-normal text-muted-foreground">· {ROLE_NAMES[role]}</span>
        </h2>
        <Link href={`/${role.toLowerCase()}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          Open {role} <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile href={`/${role.toLowerCase()}`} icon={Users} label="Total candidates" value={s.total} />
        <Tile href={roleLink(role, { created_from: today, created_to: today })} icon={Sparkles} label="New today" value={s.new_today} />
        <Tile href={roleLink(role, { created_from: weekStart(today), created_to: today })} icon={CalendarDays} label="New this week" value={s.new_week} />
        <Tile href="/analytics" icon={AlertTriangle} label="Stuck (over limit)" value={s.stuck} alert={s.stuck > 0} />
      </div>

      {/* Candidates per stage */}
      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidates in each stage</h3>
      <ul className="space-y-1">
        {s.stages.map((st) => (
          <li key={st.id}>
            <Link
              href={roleLink(role, { stage_ids: [st.id] })}
              className="group grid grid-cols-[minmax(0,15rem)_1fr_3rem] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/60"
              title={`${st.count} ${role} candidates in ${st.name}. Click to open them.`}
            >
              <span className="truncate"><Badge color={st.color}>{st.name}</Badge></span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-[#2a78d6]" style={{ width: `${(st.count / max) * 100}%` }} />
              </span>
              <span className="text-right text-sm font-semibold tabular-nums group-hover:text-primary">{st.count.toLocaleString("en-IN")}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* 1:1 Aligned per interviewer */}
      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1:1 Aligned per interviewer</h3>
      <div className="flex flex-wrap gap-2">
        {s.interviewers.map((i) => (
          <Link
            key={i.id}
            href={roleLink(role, { stage_ids: s.stages.filter((x) => x.requires_interviewer).map((x) => x.id), interviewer_ids: [String(i.id)] })}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-accent/60"
          >
            <Badge color={i.color}>{i.name}</Badge>
            <span className="text-lg font-semibold tabular-nums">{i.count}</span>
          </Link>
        ))}
        {!s.interviewers.length && <p className="text-sm text-muted-foreground">No active interviewers.</p>}
      </div>
    </section>
  );
}

function Tile({ href, icon: Icon, label, value, alert }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; value: number; alert?: boolean }) {
  return (
    <Link href={href} className={`rounded-lg border p-3 transition-colors hover:bg-accent/60 ${alert ? "border-red-200 bg-red-50/60" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`size-3.5 ${alert ? "text-[#d03b3b]" : ""}`} /> {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</div>
    </Link>
  );
}

/** Monday of the week containing `day` (YYYY-MM-DD). */
function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}
