import Image from "next/image"

import { parseAnnouncementBody } from "@/lib/announcements/render"

/**
 * Renders a staff-authored announcement body.
 *
 * THE SECURITY PROPERTY
 * =====================
 * There is no HTML sink here. Not a sanitizer, not an allowlist of tags — no
 * path at all from the body string to markup. `parseAnnouncementBody` produces
 * text runs and link runs; text runs become React text nodes (escaped by
 * React), and link runs become anchors whose `href` this component builds from
 * a URL that was already parsed and scheme-checked.
 *
 * So `<script>alert(1)</script>` in a body renders as those literal characters
 * on the page. It is not stripped, because it never needed to be.
 */
export function AnnouncementBody({
  body,
  imageUrl
}: {
  body: string
  imageUrl?: string | null
}) {
  const blocks = parseAnnouncementBody(body)
  // Only our own images. An arbitrary remote host would be an open image proxy
  // and a tracking vector on a page anyone can read.
  const image = imageUrl && imageUrl.startsWith("/") ? imageUrl : null

  return (
    <div>
      {image ? (
        <Image
          src={image}
          alt=""
          aria-hidden
          width={1200}
          height={630}
          className="mb-6 h-auto w-full border border-white/10"
        />
      ) : null}

      {blocks.map((block, blockIndex) => (
        <p key={blockIndex} className="mb-4 text-base leading-8 text-slate-200/95">
          {block.lines.map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {line.map((run, runIndex) =>
                run.kind === "link" ? (
                  <a
                    key={runIndex}
                    href={run.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className="text-amber-100 underline underline-offset-4"
                  >
                    {run.label}
                  </a>
                ) : (
                  // A plain text node. React escapes it; nothing here is markup.
                  <span key={runIndex}>{run.value}</span>
                )
              )}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
