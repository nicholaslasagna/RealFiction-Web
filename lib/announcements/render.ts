// Rendering an announcement body.
//
// WHY NOT MARKDOWN
// ================
// The project does not otherwise need a Markdown renderer, and adding one to
// display staff paragraphs would mean auditing a dependency — and its raw-HTML
// escape hatch — for a feature that needs paragraphs, line breaks, and the
// occasional link. So the body is PLAIN STRUCTURED TEXT, parsed here into a
// small tree that React renders as text nodes and anchors it builds itself.
//
// There is no HTML path at all. Not a sanitizer that strips tags — no sink.
// `<script>` in a body is four text characters and an escape; it renders as
// literal text because React escapes text nodes, and this function never
// produces markup.
//
// THE FORMAT
// ==========
//   blank line   -> new paragraph
//   single break -> line break within a paragraph
//   https://…    -> a link, scheme-checked, rendered with the host as label
//
// That is the whole grammar. It is deliberately not extensible: every addition
// here is a new way for staff-authored text to change how a public page
// behaves.

/** One inline run: literal text, or a link we validated ourselves. */
export type Inline = { kind: "text"; value: string } | { kind: "link"; href: string; label: string }

export type Block = { kind: "paragraph"; lines: Inline[][] }

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"']+/g

/**
 * Splits one line into text and link runs.
 *
 * A URL is only emitted as a link when it parses AND its scheme is http(s).
 * Anything else — `javascript:`, `data:`, a malformed URL — stays literal text,
 * so the worst case is an unclickable string rather than a live hostile link.
 */
export function parseInline(line: string): Inline[] {
  const runs: Inline[] = []
  let cursor = 0

  for (const match of line.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0
    let parsed: URL | null = null
    try {
      parsed = new URL(match[0])
    } catch {
      parsed = null
    }

    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      continue
    }

    if (index > cursor) {
      runs.push({ kind: "text", value: line.slice(cursor, index) })
    }
    runs.push({ kind: "link", href: parsed.href, label: parsed.host.replace(/^www\./, "") })
    cursor = index + match[0].length
  }

  if (cursor < line.length) {
    runs.push({ kind: "text", value: line.slice(cursor) })
  }

  return runs.length > 0 ? runs : [{ kind: "text", value: line }]
}

/** Parses a body into paragraphs of lines. Never returns markup. */
export function parseAnnouncementBody(body: string): Block[] {
  const normalized = String(body ?? "")
    // Control characters, which have no business in a body and could confuse a
    // terminal or a log that later prints this.
    .split("")
    .filter((ch) => ch === "\n" || ch === "\t" || ch >= " ")
    .join("")
    .replace(/\r\n?/g, "\n")

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").filter((line) => line.trim().length > 0))
    .filter((lines) => lines.length > 0)
    .map((lines) => ({ kind: "paragraph" as const, lines: lines.map(parseInline) }))
}
