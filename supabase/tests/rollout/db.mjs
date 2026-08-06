// A Supabase-client stand-in backed by a real PostgreSQL database.
//
// WHY NOT THE REAL CLIENT: supabase-js speaks HTTP to PostgREST, and there is no
// PostgREST in this environment (Docker is unavailable on the host). The HTTP
// layer is also identical in all three application/database combinations, so it
// is not what a rollout-compatibility test is about.
//
// What IS exercised is everything that differs between the combinations: the
// application's own resolution, validation and guard code, running against a
// real database built from the real migration files at a real point in time.
// Every query below is executed by `psql` against that database.
//
// Implements only the surface the checkout path actually uses.
import { execFileSync } from "node:child_process"

const PSQL = process.env.RF_PSQL ?? "/opt/homebrew/opt/postgresql@16/bin/psql"
const SOCKET = process.env.RF_PGSOCKET ?? "/tmp/rfpg"

export function sql(database, statement) {
  const out = execFileSync(
    PSQL,
    ["-h", SOCKET, "-U", "postgres", "-d", database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }
  )
  return out.trim()
}

/** Runs a query and returns rows as objects, via json_agg. */
export function rows(database, statement) {
  const text = sql(database, `select coalesce(json_agg(t), '[]'::json) from (${statement}) t`)
  return JSON.parse(text || "[]")
}

function quote(value) {
  if (value === null || value === undefined) return "null"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Minimal PostgREST-shaped query builder over `psql`.
 *
 * Deliberately narrow: it supports exactly the operations the checkout and
 * fulfilment paths perform, and throws on anything else rather than silently
 * returning an empty result that a test might read as "allowed".
 */
export function createDbClient(database) {
  return {
    from(table) {
      const state = { table, columns: "*", filters: [], limit: null }
      const builder = {
        select(columns) {
          state.columns = columns ?? "*"
          return builder
        },
        eq(column, value) {
          state.filters.push(`${column} = ${quote(value)}`)
          return builder
        },
        in(column, values) {
          const list = values.length ? values.map(quote).join(",") : "null"
          state.filters.push(`${column} in (${list})`)
          return builder
        },
        order() {
          return builder
        },
        limit(n) {
          state.limit = n
          return builder
        },
        async maybeSingle() {
          const found = await builder.run()
          return { data: found.data[0] ?? null, error: found.error }
        },
        async single() {
          return builder.maybeSingle()
        },
        async run() {
          const where = state.filters.length ? `where ${state.filters.join(" and ")}` : ""
          const cap = state.limit ? `limit ${state.limit}` : ""
          // PostgREST's embedded-resource syntax is not supported here; strip it
          // so a caller cannot get a silently wrong shape.
          const columns = state.columns.replace(/,?\s*\w+\([^)]*\)/g, "") || "*"
          try {
            return { data: rows(database, `select ${columns} from public.${state.table} ${where} ${cap}`), error: null }
          } catch (error) {
            return { data: [], error: { message: String(error.stderr ?? error.message).slice(0, 300) } }
          }
        },
        then(resolve, reject) {
          return builder.run().then(resolve, reject)
        }
      }
      return builder
    },

    async rpc(fn, args = {}) {
      const params = Object.entries(args)
        .map(([key, value]) => `${key} => ${quote(value)}`)
        .join(", ")
      try {
        return { data: rows(database, `select * from public.${fn}(${params})`), error: null }
      } catch (error) {
        return {
          data: null,
          error: { message: String(error.stderr ?? error.message).slice(0, 300) }
        }
      }
    }
  }
}
