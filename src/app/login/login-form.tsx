"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Email + password login. There is deliberately no "sign up" link:
 * accounts are created by an admin (Supabase dashboard or Settings → Users).
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoading(false);
      if (error.message === "Invalid login credentials") {
        toast.error("Wrong email or password.");
      } else if (/fetch|network/i.test(error.message)) {
        toast.error("Can't reach the database.", {
          description:
            "Check your internet connection. If it's fine, the Supabase project may be paused — restore it from supabase.com.",
        });
      } else {
        toast.error(error.message);
      }
      return;
    }
    // Only allow redirects inside this app.
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm rounded-3xl p-2">
      <CardHeader className="items-center pb-2 text-center">
        <Image src="/brand/htlb-logo.png" alt="HTLB Systems: Enriching Knowledge, Empowering Nation" width={160} height={168} priority className="mx-auto mb-2 rounded-2xl" />
        <CardTitle className="text-2xl font-semibold tracking-tight">Candidate Tracker</CardTitle>
        <CardDescription>Sign in with your HTLB team account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading} className="mt-1 h-11">
            {loading && <Loader2 className="animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            No account? Ask your admin to add you.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
