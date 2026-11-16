import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ComingSoon, PageHeader } from "@/components/page-header";

const ROLE_NAMES = { ZBM: "Zonal Business Manager", HOS: "Head of States" } as const;

/**
 * Phase 1 version of a role tab: shows live candidate counts per stage
 * (proves the database connection). The full table arrives in Phase 3.
 */
export async function RoleTabPlaceholder({ role }: { role: "ZBM" | "HOS" }) {
  const supabase = await createClient();
  const { data: stages } = await supabase.from("stages").select("id, name, color").order("position");
  // One cheap "count only" query per stage (no rows are downloaded).
  const counts = new Map<number, number>();
  await Promise.all(
    (stages ?? []).map(async (s) => {
      const { count } = await supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("role", role)
        .eq("stage_id", s.id);
      counts.set(s.id, count ?? 0);
    }),
  );

  return (
    <>
      <PageHeader title={`${role} candidates`} description={ROLE_NAMES[role]} />
      <div className="mb-6 flex flex-wrap gap-2">
        {stages?.map((s) => (
          <Badge key={s.id} color={s.color} className="px-3 py-1 text-sm">
            {s.name}: {counts.get(s.id) ?? 0}
          </Badge>
        ))}
      </div>
      <ComingSoon phase={3}>
        The candidate table with filters, sorting, column picker, selection and the bulk-sender export.
      </ComingSoon>
    </>
  );
}
