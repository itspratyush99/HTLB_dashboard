"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Admin-only permanent delete. Shows who will be deleted, needs the number typed to confirm,
 * and can also remove the names from old history lines (for a candidate's data-removal request).
 */
export function DeleteDialog({
  open,
  onOpenChange,
  ids,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  onDeleted: (deletedIds: string[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [people, setPeople] = useState<{ id: string; name: string; role: string; stage_name: string }[] | null>(null);
  const [erase, setErase] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPeople(null);
    setErase(false);
    setTyped("");
    let cancelled = false;
    supabase.rpc("candidates_for_export", { p_ids: ids }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast.error(error.message);
      setPeople((data ?? []) as { id: string; name: string; role: string; stage_name: string }[]);
    });
    return () => {
      cancelled = true;
    };
    // The ids are read when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supabase]);

  const n = people?.length ?? 0;
  const confirmed = typed.trim() === String(n) && n > 0;

  async function remove() {
    setBusy(true);
    const { data, error } = await supabase.rpc("delete_candidates", { p_ids: people!.map((p) => p.id), p_erase_names: erase });
    setBusy(false);
    if (error) return toast.error("Couldn't delete", { description: error.message });
    const deleted = (data as { deleted: number }).deleted;
    toast.success(`${deleted} candidate${deleted === 1 ? "" : "s"} deleted permanently`);
    onDeleted(people!.map((p) => p.id));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-5" /> Delete {n || ""} candidate{n === 1 ? "" : "s"} permanently?
          </DialogTitle>
          <DialogDescription>This can&apos;t be undone. Their details are removed from the tracker for everyone.</DialogDescription>
        </DialogHeader>

        {!people ? (
          <Loader2 className="mx-auto my-4 size-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <ul className="max-h-40 overflow-y-auto rounded-xl border border-black/[0.06] bg-white/70 p-2 text-sm">
              {people.slice(0, 50).map((p) => (
                <li key={p.id} className="flex justify-between gap-2 py-0.5">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.role} · {p.stage_name}</span>
                </li>
              ))}
              {people.length > 50 && <li className="pt-1 text-xs text-muted-foreground">…and {people.length - 50} more</li>}
            </ul>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={erase} onCheckedChange={(v) => setErase(v === true)} />
              <span>
                Also remove their names from the Activity Log
                <span className="block text-xs text-muted-foreground">
                  Use this when a candidate asks for their data to be removed. Otherwise the log keeps their names for your records.
                </span>
              </span>
            </label>

            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <AlertTriangle className="size-4 shrink-0" />
              <p>The free Supabase plan has no backups. Export them first if you might need them again.</p>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span>Type <b className="font-mono">{n}</b> to confirm</span>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" autoFocus />
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" onClick={remove} disabled={!confirmed || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete {n} permanently
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
