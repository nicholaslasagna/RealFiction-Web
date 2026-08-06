// Points the application's service-role client at the disposable database named
// by RF_TARGET_DB, read at CALL time so one process can drive several databases.
import { createDbClient } from "./db.mjs"

export function getSupabaseServiceRoleClient() {
  const database = process.env.RF_TARGET_DB
  if (!database) {
    throw new Error("RF_TARGET_DB is not set")
  }
  return createDbClient(database)
}
