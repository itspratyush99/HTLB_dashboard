"use client";

import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/actions/auth";

/**
 * Log out reliably from anywhere (menus included).
 * 1. Clears the session in this browser (cookies) via Supabase.
 * 2. Clears it on the server too (server action), ignoring its redirect.
 * 3. Full page load to /login so no cached page shows the old user.
 */
export async function logout() {
  try {
    await createClient().auth.signOut({ scope: "local" });
  } catch {}
  try {
    await signOut();
  } catch {}
  window.location.replace("/login");
}
