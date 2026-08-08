import "server-only"

// Staff authorization for the announcement admin.
//
// THE CHECK IS SERVER-SIDE AND ASKS THE DATABASE
// ==============================================
// `is_admin()` is a SECURITY DEFINER function that reads `profiles.role` for
// `auth.uid()`. Calling it through the RLS-scoped SESSION client means the
// answer is derived from the caller's own cookie-backed session — the client
// cannot assert a role, because it never supplies one.
//
// This deliberately does NOT use the shared-secret pattern from
// /api/admin/economy/import. That endpoint is machine-to-machine; this is a
// human with a browser, and a shared secret pasted into a browser is a secret
// that leaks into history, extensions, and screenshots.

import { createSupabaseServerClient, getAuthenticatedUser } from "@/lib/supabase/server"

export type StaffCheck =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; reason: "signed_out" | "not_staff" | "unavailable" }

/**
 * Whether the CURRENT session belongs to staff, admin, or owner.
 *
 * Fails CLOSED. An unreachable database is not permission.
 */
export async function requireStaff(): Promise<StaffCheck> {
  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return { ok: false, reason: "signed_out" }
  }

  try {
    const supabase = await createSupabaseServerClient()
    // Scoped to the caller's session: is_admin() resolves auth.uid() itself, so
    // there is no id parameter a client could tamper with.
    const { data, error } = await supabase.rpc("is_admin")
    if (error) {
      console.error("staff_check_unavailable", { code: error.code ?? "unknown" })
      return { ok: false, reason: "unavailable" }
    }
    return data === true
      ? { ok: true, userId: user.id, email: user.email ?? null }
      : { ok: false, reason: "not_staff" }
  } catch {
    return { ok: false, reason: "unavailable" }
  }
}
