"use client"

import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import { rules } from "@/lib/data"

/**
 * The rules handbook.
 *
 * WHAT CHANGED AND WHY
 * ====================
 * Every category used to be a card with a "N policies" badge and its rules as
 * body text — five large panels in a two-column grid. That reads as a dashboard
 * widget, not a document, and the badge counted something nobody needs to know.
 *
 * A handbook wants: a way in (the index), stable numbering you can cite
 * ("2.3"), and enough restraint that the text is the thing you notice. So the
 * cards are gone, replaced by numbered sections separated by rules — the
 * horizontal kind — and an index that tracks alongside on desktop.
 *
 * Search behaviour is unchanged.
 */

const slug = (category: string) =>
  category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export function RulesExplorer() {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return rules
    }
    return rules
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${group.category} ${item}`.toLowerCase().includes(normalized)
        )
      }))
      .filter((group) => group.items.length > 0)
  }, [query])

  const total = rules.reduce((sum, group) => sum + group.items.length, 0)
  const showing = filtered.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr] lg:gap-12">
      {/* ---- Index ---------------------------------------------------------
          Horizontal chips on mobile, a tracking column on desktop. Same links,
          so there is one navigation model rather than two. */}
      <nav aria-label="Rule categories" className="lg:sticky lg:top-28 lg:self-start">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Sections</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 lg:flex-col lg:gap-y-2">
          {rules.map((group, index) => (
            <li key={group.category}>
              <a
                href={`#${slug(group.category)}`}
                className="flex items-baseline gap-2 text-sm text-muted-foreground transition hover:text-amber-100"
              >
                <span className="font-mono text-xs text-amber-200/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {group.category}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-10"
            placeholder="Search the rules"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the rules"
          />
        </div>

        {/* Live region: a filtered list that silently shrinks is invisible to a
            screen-reader user, who has no way to tell searching from breaking. */}
        <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          {query.trim()
            ? `${showing} of ${total} rules match "${query.trim()}"`
            : `${total} rules across ${rules.length} sections`}
        </p>

        {filtered.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            Nothing matches that. Try a broader term, or{" "}
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-amber-100 underline underline-offset-4"
            >
              clear the search
            </button>
            .
          </p>
        ) : null}

        {filtered.map((group) => {
          // Numbered from the FULL list, so a rule keeps its number while a
          // search is active — "3.2" has to mean the same thing either way.
          const sectionNumber = rules.findIndex((entry) => entry.category === group.category) + 1

          return (
            <section
              key={group.category}
              id={slug(group.category)}
              className="mt-9 scroll-mt-28 first:mt-8"
            >
              <h2 className="flex items-baseline gap-3 border-b border-amber-200/20 pb-2">
                <span className="font-mono text-sm text-amber-200/70">
                  {String(sectionNumber).padStart(2, "0")}
                </span>
                <span className="display-font text-xl font-semibold text-white md:text-2xl">
                  {group.category}
                </span>
              </h2>

              <ol className="mt-1">
                {group.items.map((item) => {
                  const ruleNumber =
                    rules[sectionNumber - 1].items.findIndex((entry) => entry === item) + 1
                  return (
                    <li
                      key={item}
                      className="flex gap-3 border-b border-white/[0.05] py-2.5 text-sm leading-6 sm:gap-4"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                        {sectionNumber}.{ruleNumber}
                      </span>
                      <span className="text-slate-200">{item}</span>
                    </li>
                  )
                })}
              </ol>
            </section>
          )
        })}
      </div>
    </div>
  )
}
