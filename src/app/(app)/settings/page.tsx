import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Settings · Candidate Tracker" };

/**
 * Phase 1: read-only view of everything the migration set up, so you can confirm
 * the database is connected. Editing arrives in Phase 6.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const [stages, interviewers, keywords, settings, team] = await Promise.all([
    supabase.from("stages").select("*").order("position"),
    supabase.from("interviewers").select("*").order("name"),
    supabase.from("role_keywords").select("*").order("role").order("keyword"),
    supabase.from("app_settings").select("*"),
    supabase.from("profiles").select("*").order("created_at"),
  ]);
  const setting = (key: string) => settings.data?.find((s) => s.key === key)?.value;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Read-only for now — editing stages, interviewers, keywords, thresholds and users comes in Phase 6."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hiring stages</CardTitle>
            <CardDescription>In funnel order. New candidates start in the default stage.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {stages.data?.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-right text-muted-foreground">{s.position}.</span>
                  <Badge color={s.color}>{s.name}</Badge>
                  {s.is_default && <span className="text-xs text-muted-foreground">default</span>}
                  {s.requires_interviewer && (
                    <span className="text-xs text-muted-foreground">asks for interviewer</span>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Interviewers</CardTitle>
            <CardDescription>Assigned when candidates move to 1:1 Aligned.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {interviewers.data?.map((i) => (
              <Badge key={i.id} color={i.color} className={i.is_active ? "" : "opacity-50"}>
                {i.name}
                {!i.is_active && " (inactive)"}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role detection keywords</CardTitle>
            <CardDescription>Matched against Naukri&apos;s &quot;Job Title&quot;, ignoring letter case.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {keywords.data?.map((k) => (
                  <tr key={k.id} className="border-b last:border-0">
                    <td className="py-1.5 font-medium">{k.role}</td>
                    <td className="py-1.5">&quot;{k.keyword}&quot;</td>
                    <td className="py-1.5 text-muted-foreground">{k.whole_word ? "whole word" : "contains"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lag thresholds</CardTitle>
            <CardDescription>Used by Analytics to flag bottlenecks.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <div>
              Max days in a stage: <strong>{String(setting("lag_max_days_in_stage") ?? "—")}</strong>
            </div>
            <div>
              Minimum conversion: <strong>{String(setting("lag_min_conversion_pct") ?? "—")}%</strong>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Team users</CardTitle>
            <CardDescription>Add people in Supabase → Authentication → Users (see the setup guide).</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Name</th>
                  <th className="py-1.5 font-medium">Email</th>
                  <th className="py-1.5 font-medium">Access</th>
                  <th className="py-1.5 font-medium">Added</th>
                </tr>
              </thead>
              <tbody>
                {team.data?.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1.5">{p.full_name}</td>
                    <td className="py-1.5">{p.email}</td>
                    <td className="py-1.5">
                      {!p.is_active ? (
                        <Badge color="#dc2626">Switched off</Badge>
                      ) : p.is_admin ? (
                        <Badge color="#059669">Admin</Badge>
                      ) : (
                        <Badge>Member</Badge>
                      )}
                    </td>
                    <td className="py-1.5">{formatDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
