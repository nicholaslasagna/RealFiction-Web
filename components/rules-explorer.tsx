"use client"

import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { rules } from "@/lib/data"

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

  return (
    <div className="space-y-6">
      <div className="relative max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-10"
          placeholder="Search rules, categories, or policies"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {filtered.map((group) => (
          <Card key={group.category} className="minecraft-card">
            <CardHeader>
              <Badge variant="outline">{group.items.length} policies</Badge>
              <CardTitle>{group.category}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-3">
                {group.items.map((item, index) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                    <span className="font-mono text-amber-100">{String(index + 1).padStart(2, "0")}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
