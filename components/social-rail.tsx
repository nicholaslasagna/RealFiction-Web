import Link from "next/link"

import { socials } from "@/lib/data"

function SocialIcon({ label }: { label: string }) {
  const name = label.toLowerCase()

  if (name === "discord") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" role="img">
        <path
          fill="currentColor"
          d="M19.7 5.2A16.7 16.7 0 0 0 15.6 4l-.2.4c1.4.4 2 .9 2.7 1.4A13.3 13.3 0 0 0 12 4.6c-2.1 0-4.1.4-6.1 1.2.7-.5 1.5-1 2.8-1.4L8.5 4c-1.5.3-2.9.7-4.2 1.2C1.6 9.2.9 13 .9 16.7a16.6 16.6 0 0 0 5.1 2.6l.9-1.5c-.5-.2-1-.5-1.5-.8l.4-.3c2.9 1.3 6 1.3 8.8 0l.4.3c-.5.3-1 .6-1.5.8l.9 1.5a16.5 16.5 0 0 0 5.1-2.6c.2-4.3-.7-8-2.8-11.5ZM8.3 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8c.9 0 1.7.8 1.6 1.8 0 1-.7 1.8-1.6 1.8Zm7.4 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8c.9 0 1.7.8 1.6 1.8 0 1-.7 1.8-1.6 1.8Z"
        />
      </svg>
    )
  }

  if (name === "youtube") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" role="img">
        <path
          fill="currentColor"
          d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"
        />
      </svg>
    )
  }

  if (name === "x") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" role="img">
        <path
          fill="currentColor"
          d="M18.9 2.5h3.3l-7.2 8.2 8.4 10.8h-6.6l-5.2-6.6-5.9 6.6H2.4l7.7-8.7-8-10.3h6.8l4.7 6 5.3-6Zm-1.2 17.1h1.8L7.9 4.3H6L17.7 19.6Z"
        />
      </svg>
    )
  }

  return (
    <svg aria-hidden viewBox="0 0 24 24" role="img">
      <path
        fill="currentColor"
        d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9Zm9.9 2.1a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM12 7.3A4.7 4.7 0 1 1 12 16.7 4.7 4.7 0 0 1 12 7.3Zm0 2A2.7 2.7 0 1 0 12 14.7 2.7 2.7 0 0 0 12 9.3Z"
      />
    </svg>
  )
}

export function SocialRail() {
  return (
    <nav className="rf-social-rail" aria-label="RealFiction community links">
      {socials.map((item) => (
        <Link key={item.href} href={item.href} aria-label={item.label}>
          <SocialIcon label={item.label} />
        </Link>
      ))}
    </nav>
  )
}
