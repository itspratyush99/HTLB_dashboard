"use server";

/**
 * Team-user actions that need Supabase's secret "service role" key.
 * They run only on the server (never in the browser) and only for admins.
 * The key comes from the SUPABASE_SERVICE_ROLE_KEY environment variable in Vercel.
 */
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";

type Result = { ok: true; message: string } | { ok: false; error: string };

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentProfile();
  if (!me) return "Please log in again.";
  if (!me.is_admin) return "Only admins can manage team users.";
  return null;
}

const NO_KEY =
  "Adding users from the panel needs the SUPABASE_SERVICE_ROLE_KEY setting in Vercel (see README → Team users). Until then, add users in Supabase → Authentication → Users.";

export async function createTeamUser(input: {
  fullName: string;
  email: string;
  password: string;
  access: "admin" | "full" | "interviewer";
  interviewerId: number | null;
}): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const admin = adminClient();
  if (!admin) return { ok: false, error: NO_KEY };

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName) return { ok: false, error: "Enter the person's name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (input.password.length < 8) return { ok: false, error: "The password must be at least 8 characters." };
  if (input.access === "interviewer" && !input.interviewerId) return { ok: false, error: "Choose which interviewer this login belongs to." };

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // no confirmation email needed; they can log in straight away
    user_metadata: { full_name: fullName },
  });
  if (error) {
    return { ok: false, error: /already|registered|exists/i.test(error.message) ? `${email} already has an account.` : error.message };
  }
  // The database creates their profile automatically; set the name/admin flag explicitly.
  await admin
    .from("profiles")
    .update({
      full_name: fullName,
      is_admin: input.access === "admin",
      access: input.access === "interviewer" ? "interviewer" : "full",
      interviewer_id: input.access === "interviewer" ? input.interviewerId : null,
    })
    .eq("id", data.user.id);
  revalidatePath("/settings");
  return { ok: true, message: `${fullName} can now log in with ${email}.` };
}

export async function resetTeamUserPassword(userId: string, password: string): Promise<Result> {
  const denied = await requireAdmin();
  if (denied) return { ok: false, error: denied };
  const admin = adminClient();
  if (!admin) return { ok: false, error: NO_KEY };
  if (password.length < 8) return { ok: false, error: "The password must be at least 8 characters." };
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Password changed. Share it with them privately." };
}
