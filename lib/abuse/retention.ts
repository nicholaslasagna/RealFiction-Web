// Retention for the abuse counters.
//
// The counters only need to exist for as long as the rule that reads them looks
// back. Keeping them longer would turn a set of short-lived decision inputs into
// a durable behavioural record, which is exactly what this system is not.
//
//   ip hashes    7 days   the longest IP rule looks back one hour
//   everything  45 days   the longest rule window is 30 days
//
// Runs on the EXISTING Cron alongside the other scheduled work. Never throws:
// a purge that fails is a retention problem to fix, not a reason to fail email
// delivery or payment reconciliation.

import { createClient } from "@supabase/supabase-js"

export type RetentionEnv = {
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

export type PurgeResult = { ipRows: number; otherRows: number }

export async function purgeAbuseEvents(env: RetentionEnv): Promise<PurgeResult> {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { ipRows: 0, otherRows: 0 }
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc("purge_abuse_events")

  if (error) {
    console.error("abuse_purge_failed", { code: error.code ?? "unknown" })
    return { ipRows: 0, otherRows: 0 }
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ip_rows?: number; other_rows?: number }
    | null
  return { ipRows: Number(row?.ip_rows ?? 0), otherRows: Number(row?.other_rows ?? 0) }
}
