// A Supabase-shaped client backed by a REAL PostgreSQL database, over psql.
//
// WHY THIS EXISTS
// ===============
// The ordinary checkout route reaches the database through
// `getSupabaseServiceRoleClient()`, which speaks HTTP to PostgREST. There is no
// PostgREST in this environment (Docker is unavailable on the host), and the
// HTTP layer is not what a checkout test is about — what matters is that the
// route's real logic runs against real migrated SQL: real prices, real
// reservations, real triggers, real entitlement stacking.
//
// So this implements the narrow slice of the client surface the checkout path
// actually uses, and executes every query with psql against a disposable
// database built from the real migration files.
//
// It is deliberately strict: an unsupported operation throws rather than
// returning an empty result a test might read as "allowed".
import { execFileSync } from "node:child_process"

const PSQL = process.env.RF_PSQL ?? "/opt/homebrew/opt/postgresql@16/bin/psql"
const SOCKET = process.env.RF_PGSOCKET ?? "/tmp/rfpg"

/**
 * @param options.role Run the statement AS this role, in a rolled-back
 *   transaction. Lets a test assert what `anon` or `authenticated` can actually
 *   reach — the boundary a signed-in browser hits when it calls PostgREST
 *   directly, with no application code in the way.
 */
export function sql(database, statement, options = {}) {
  const body = options.role
    ? `begin; set local role ${options.role}; ${statement}; rollback;`
    : statement
  const args = ["-h", SOCKET, "-U", "postgres", "-d", database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"]
  // `-q` suppresses the BEGIN/SET/ROLLBACK command tags the role wrapper adds,
  // so a role-scoped call returns the same shape as an ordinary one.
  if (options.role) {
    args.push("-q")
  }
  args.push("-c", body)
  return execFileSync(PSQL, args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" }
  }).trim()
}

/** Rows as objects, via json_agg so types survive the round trip. */
export function rows(database, statement) {
  const text = sql(database, `select coalesce(json_agg(t), '[]'::json) from (${statement}) t`)
  return JSON.parse(text || "[]")
}

/**
 * Same, for a data-modifying statement.
 *
 * Postgres will not accept `INSERT ... RETURNING` inside a plain subquery, so
 * this uses a CTE. Getting that wrong is silent until something actually
 * inserts — which is exactly how the first run of the real checkout route
 * failed, on `ensureProfileForUser`.
 */
export function writeRows(database, statement) {
  const text = sql(database, `with t as (${statement}) select coalesce(json_agg(t), '[]'::json) from t`)
  return JSON.parse(text || "[]")
}

function lit(value) {
  if (value === null || value === undefined) return "null"
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return String(value)
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * `select` lists may name embedded resources (`order_items(quantity)`), which
 * this adapter does not support. Strip them so a caller gets the plain columns
 * rather than a syntax error, and so an embedded shape can never silently
 * arrive as something else.
 */
function columns(list) {
  if (!list || list === "*") return "*"
  return (
    list
      .replace(/,?\s*[\w]+\([^)]*\)/g, "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .join(", ") || "*"
  )
}

export function createPgSupabaseClient(database, { onQuery } = {}) {
  const record = (kind, detail) => onQuery?.(kind, detail)

  return {
    async rpc(fn, args = {}) {
      const params = Object.entries(args)
        .map(([key, value]) => `${key} => ${lit(value)}`)
        .join(", ")
      record("rpc", { fn, args })
      try {
        const result = rows(database, `select * from public.${fn}(${params})`)

        // PostgREST returns a BARE SCALAR for a scalar-returning function, not
        // a row object. `select * from f()` gives `[{ f: 0 }]`, and a caller
        // doing `Number(data[0])` would get NaN and fail closed — which is what
        // happened the first time this adapter ran the real checkout route.
        // Table-returning functions keep their row shape.
        if (result.length === 1) {
          const keys = Object.keys(result[0])
          if (keys.length === 1 && keys[0] === fn) {
            return { data: result[0][fn], error: null }
          }
        }
        return { data: result, error: null }
      } catch (error) {
        return { data: null, error: { message: String(error.stderr ?? error.message).slice(0, 300) } }
      }
    },

    from(table) {
      const state = { table, columns: "*", filters: [], limit: null, order: null }

      const builder = {
        select(list) {
          state.columns = list ?? "*"
          return builder
        },
        eq(column, value) {
          state.filters.push(`${column} = ${lit(value)}`)
          return builder
        },
        in(column, values) {
          state.filters.push(`${column} in (${values.length ? values.map(lit).join(",") : "null"})`)
          return builder
        },
        order(column, options) {
          state.order = `${column} ${options?.ascending === false ? "desc" : "asc"}`
          return builder
        },
        limit(n) {
          state.limit = n
          return builder
        },

        /**
         * Chainable, like the real client: `.insert(x).select("id").single()`.
         * An `async` method would return a Promise here and `.select` would not
         * exist on it — which is precisely how this first failed against the
         * real `createPendingOrder`.
         */
        insert(payload) {
          const list = Array.isArray(payload) ? payload : [payload]
          let outcome = null

          const run = () => {
            if (outcome) return outcome
            if (list.length === 0) {
              outcome = { data: [], error: null }
              return outcome
            }
            const cols = [...new Set(list.flatMap((row) => Object.keys(row)))]
            const values = list.map((row) => `(${cols.map((c) => lit(row[c])).join(",")})`).join(",")
            record("insert", { table, count: list.length })
            try {
              outcome = {
                data: writeRows(
                  database,
                  `insert into public.${table} (${cols.join(",")}) values ${values} returning *`
                ),
                error: null
              }
            } catch (error) {
              outcome = { data: null, error: { message: String(error.stderr ?? error.message).slice(0, 300) } }
            }
            return outcome
          }

          const chain = {
            select() {
              return {
                async single() {
                  const done = run()
                  return {
                    data: done.data?.[0] ?? null,
                    error: done.error ?? (done.data?.length ? null : { message: "no rows" })
                  }
                },
                async maybeSingle() {
                  const done = run()
                  return { data: done.data?.[0] ?? null, error: done.error }
                },
                then(resolve, reject) {
                  return Promise.resolve(run()).then(resolve, reject)
                }
              }
            },
            then(resolve, reject) {
              return Promise.resolve(run()).then(resolve, reject)
            }
          }
          return chain
        },

        async upsert(payload, options) {
          const list = Array.isArray(payload) ? payload : [payload]
          const cols = [...new Set(list.flatMap((row) => Object.keys(row)))]
          const values = list.map((row) => `(${cols.map((c) => lit(row[c])).join(",")})`).join(",")
          const conflict = options?.onConflict ?? "id"
          const updates = cols.filter((c) => c !== conflict).map((c) => `${c} = excluded.${c}`)
          record("upsert", { table })
          try {
            writeRows(
              database,
              `insert into public.${table} (${cols.join(",")}) values ${values}
               on conflict (${conflict}) do ${updates.length ? `update set ${updates.join(",")}` : "nothing"}
               returning *`
            )
            return { data: null, error: null }
          } catch (error) {
            return { data: null, error: { message: String(error.stderr ?? error.message).slice(0, 300) } }
          }
        },

        update(values) {
          const assignments = Object.entries(values)
            .map(([key, value]) => `${key} = ${lit(value)}`)
            .join(", ")
          const runner = {
            eq(column, value) {
              state.filters.push(`${column} = ${lit(value)}`)
              return runner
            },
            async then(resolve, reject) {
              try {
                record("update", { table })
                const where = state.filters.length ? `where ${state.filters.join(" and ")}` : ""
                sql(database, `update public.${table} set ${assignments} ${where}`)
                resolve({ data: null, error: null })
              } catch (error) {
                resolve({ data: null, error: { message: String(error.stderr ?? error.message).slice(0, 300) } })
                void reject
              }
            }
          }
          return runner
        },

        async run() {
          // PostgREST embedded resources: `select("products(category)")`. The
          // checkout and fulfilment paths genuinely use these, so stripping
          // them silently returned rows with the embed missing — which made
          // `isGiftCardOrder` answer false and route a gift card through
          // ordinary product fulfilment. Resolved as a correlated json subquery
          // on the foreign key, which is what PostgREST does.
          const embeds = [...String(state.columns).matchAll(/(\w+)\(([^)]*)\)/g)]
          if (embeds.length > 0) {
            const where = state.filters.length ? `where ${state.filters.join(" and ")}` : ""
            const plain = columns(state.columns)
            const selects = embeds.map(([, child, childCols]) => {
              const cols = childCols
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean)
              const json = cols.map((c) => `'${c}', c.${c}`).join(", ")
              // Convention in this schema: the child is referenced by
              // `<singular>_id` on the parent row.
              const fk = `${child.replace(/s$/, "")}_id`
              return `(select json_build_object(${json}) from public.${child} c where c.id = public.${state.table}.${fk}) as ${child}`
            })
            const list = [plain === "*" ? null : plain, ...selects].filter(Boolean).join(", ")
            record("select", { table, embeds: embeds.length })
            try {
              return { data: rows(database, `select ${list} from public.${state.table} ${where}`), error: null }
            } catch (error) {
              return { data: [], error: { message: String(error.stderr ?? error.message).slice(0, 300) } }
            }
          }

          const where = state.filters.length ? `where ${state.filters.join(" and ")}` : ""
          const order = state.order ? `order by ${state.order}` : ""
          const cap = state.limit ? `limit ${state.limit}` : ""
          record("select", { table, where })
          try {
            return {
              data: rows(database, `select ${columns(state.columns)} from public.${table} ${where} ${order} ${cap}`),
              error: null
            }
          } catch (error) {
            return { data: [], error: { message: String(error.stderr ?? error.message).slice(0, 300) } }
          }
        },
        async maybeSingle() {
          const found = await builder.run()
          return { data: found.data?.[0] ?? null, error: found.error }
        },
        async single() {
          const found = await builder.run()
          return {
            data: found.data?.[0] ?? null,
            error: found.error ?? (found.data?.length ? null : { message: "no rows" })
          }
        },
        then(resolve, reject) {
          return builder.run().then(resolve, reject)
        }
      }

      return builder
    }
  }
}

