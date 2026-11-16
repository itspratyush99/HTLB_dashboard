import { LogOut, ShieldAlert } from "lucide-react";
import { getCurrentProfile, toViewer } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";

/** Shell for every logged-in page: top navigation + page content. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  // Logged in, but no active team profile (e.g. deactivated by an admin).
  if (!profile) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <ShieldAlert className="size-10 text-destructive" />
        <h1 className="text-lg font-semibold">Your access is switched off</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your login exists, but it is not an active team account. Ask your admin to turn your access back on.
        </p>
        <form action={signOut}>
          <Button variant="outline" type="submit">
            <LogOut /> Log out
          </Button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <AppNav user={profile} viewer={toViewer(profile)} />
      <main className="mx-auto max-w-[1600px] px-3 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
