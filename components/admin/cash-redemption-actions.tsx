"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"

/**
 * The reject control for one open cash-redemption review.
 *
 * TWO STEPS, ALWAYS. The first click only opens the dialog — it sends nothing
 * and mutates nothing. Releasing a customer's held money is not a single-click
 * action, and the amount is shown in the dialog so the operator confirms
 * against a number rather than a row they think they clicked.
 *
 * This component is trusted with nothing. The endpoint re-checks staff,
 * re-checks origin, re-validates the note, and hard-codes both the target state
 * and the payout amount. Nothing here can name a state or an amount.
 */

type Props = {
  requestId: string
  requester: string
  requestedCents: number
  frozenCents: number
}

export function CashRedemptionActions({ requestId, requester, requestedCents, frozenCents }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)

  const shortRef = requestId.slice(0, 8)

  // Focus moves INTO the dialog on open and RETURNS to the opener on close.
  // Without the return, a keyboard user is dropped at the top of the document
  // and has to tab back through the whole queue.
  useEffect(() => {
    if (open) {
      noteRef.current?.focus()
    } else {
      openerRef.current?.focus()
    }
  }, [open])

  // Escape closes, and a focus trap keeps Tab inside. Both are hand-rolled
  // because this project has no dialog primitive; `window.confirm` cannot carry
  // an amount or a required note.
  useEffect(() => {
    if (!open) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Escape must never submit. It closes and changes nothing.
        event.preventDefault()
        if (!busy) {
          close()
        }
        return
      }

      if (event.key !== "Tab") {
        return
      }

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, [href], input, select, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable || focusable.length === 0) {
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, busy])

  function close() {
    setOpen(false)
    setNote("")
    setError(null)
  }

  async function reject() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/admin/cash-redemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", requestId, reviewNote: note })
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
        outcome?: string
      }

      if (!response.ok) {
        // The dialog STAYS OPEN so the message is readable and the note is not
        // lost. Closing on failure is how an operator concludes nothing
        // happened when something did.
        setError(result.error ?? "That review could not be closed.")
        return
      }

      close()
      // The server is authoritative. Re-render from it rather than patching
      // local state, so the badge count and the row state cannot drift.
      router.refresh()
    } catch {
      setError("That review could not be closed. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        data-testid="cash-redemption-reject-open"
        className="border border-rose-300/35 bg-rose-300/10 px-2.5 py-1 text-xs font-bold text-rose-100 transition hover:bg-rose-300/20"
      >
        Reject &amp; Release Hold
      </button>
    )
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`reject-title-${requestId}`}
      aria-describedby={`reject-desc-${requestId}`}
      data-testid="cash-redemption-reject-dialog"
      className="mt-2 max-w-md border border-rose-300/30 bg-rose-300/[0.06] p-3"
    >
      <h3 id={`reject-title-${requestId}`} className="text-sm font-bold text-rose-100">
        Reject this review and release the hold?
      </h3>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-200">
        <dt className="text-muted-foreground">Requester</dt>
        <dd>{requester}</dd>
        <dt className="text-muted-foreground">Requested</dt>
        <dd className="font-mono">{formatCurrency(requestedCents)}</dd>
        <dt className="text-muted-foreground">On hold</dt>
        <dd className="font-mono" data-testid="reject-frozen-amount">
          {formatCurrency(frozenCents)}
        </dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="font-mono">{shortRef}</dd>
      </dl>

      <p id={`reject-desc-${requestId}`} className="mt-2 text-xs leading-5 text-rose-100/90">
        Rejecting this review releases the customer&rsquo;s held store credit. No cash payout will
        occur. The request stays in history.
      </p>

      <label className="mt-3 block">
        <span className="text-xs text-slate-200">Review note (required)</span>
        <textarea
          ref={noteRef}
          value={note}
          rows={3}
          maxLength={500}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          data-testid="cash-redemption-reject-note"
          className="mt-1 block w-full border border-white/12 bg-black/30 px-2 py-1.5 text-sm text-slate-200"
          placeholder="Why is this being rejected?"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={reject}
          // Disabled while in flight, so a double click cannot send twice. The
          // endpoint is idempotent regardless; this is the first line, not the
          // only one.
          disabled={busy || note.trim().length < 3}
          data-testid="cash-redemption-reject-confirm"
        >
          {busy ? "Closing…" : "Reject & Release Hold"}
        </Button>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          data-testid="cash-redemption-reject-cancel"
          className="px-2.5 py-1 text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="cash-redemption-reject-error"
          className="mt-2 text-xs text-rose-200"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
