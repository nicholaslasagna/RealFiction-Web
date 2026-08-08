"use client"

import { useEffect, useRef, useState, type MouseEvent } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"

type Action = "reject" | "approve" | "complete"

type Props = {
  requestId: string
  requester: string
  requestedCents: number
  frozenCents: number
  state: string
}

const ACTIVE_STATES = new Set(["requested", "eligibility_review", "eligible", "manual_payout_required"])

function actionCopy(action: Action, frozenCents: number) {
  if (action === "approve") {
    return {
      title: "Approve for manual payout?",
      description:
        "Approving this review does not send money. The customer's held store credit will remain unavailable until an administrator records that the required out-of-band payout has actually been completed.",
      noteLabel: "Review note (required)",
      notePlaceholder: "Why is this review eligible for manual payout?",
      confirm: "Approve for Manual Payout"
    }
  }

  if (action === "complete") {
    return {
      title: "Record payout completed?",
      description: `Use this only after the required cash payout of ${formatCurrency(frozenCents)} has already been completed outside RealFiction. Recording completion permanently consumes the corresponding held store credit. This button does not send money.`,
      noteLabel: "Completion note (required)",
      notePlaceholder: "Confirm how the out-of-band payout was completed.",
      confirm: "Record Payout Completed"
    }
  }

  return {
    title: "Reject this review and release the hold?",
    description:
      "Rejecting this review releases the customer's held store credit. No cash payout will occur. The request stays in history.",
    noteLabel: "Review note (required)",
    notePlaceholder: "Why is this being rejected?",
    confirm: "Reject & Release Hold"
  }
}

export function CashRedemptionActions({
  requestId,
  requester,
  requestedCents,
  frozenCents,
  state
}: Props) {
  const router = useRouter()
  const [openAction, setOpenAction] = useState<Action | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)

  const shortRef = requestId.slice(0, 8)
  const isActive = ACTIVE_STATES.has(state)
  const canReject = isActive && state !== "manual_payout_required"
  const canApprove = isActive && state !== "manual_payout_required"
  const canComplete = state === "manual_payout_required"

  useEffect(() => {
    if (openAction) {
      noteRef.current?.focus()
    } else {
      openerRef.current?.focus()
    }
  }, [openAction])

  useEffect(() => {
    if (!openAction) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
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
  }, [openAction, busy])

  function close() {
    setOpenAction(null)
    setNote("")
    setError(null)
  }

  function begin(action: Action, event: MouseEvent<HTMLButtonElement>) {
    openerRef.current = event.currentTarget
    setOpenAction(action)
  }

  async function submit() {
    if (!openAction) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/admin/cash-redemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: openAction, requestId, reviewNote: note })
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        setError(result.error ?? "That review could not be resolved.")
        return
      }

      close()
      router.refresh()
    } catch {
      setError("That review could not be resolved. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  if (!openAction) {
    if (!isActive) {
      return null
    }

    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {canReject ? (
          <button
            type="button"
            onClick={(event) => begin("reject", event)}
            data-testid="cash-redemption-reject-open"
            className="border border-rose-300/35 bg-rose-300/10 px-2.5 py-1 text-xs font-bold text-rose-100 transition hover:bg-rose-300/20"
          >
            Reject &amp; Release Hold
          </button>
        ) : null}
        {canApprove ? (
          <button
            type="button"
            onClick={(event) => begin("approve", event)}
            data-testid="cash-redemption-approve-open"
            className="border border-amber-200/35 bg-amber-200/10 px-2.5 py-1 text-xs font-bold text-amber-100 transition hover:bg-amber-200/20"
          >
            Approve for Manual Payout
          </button>
        ) : null}
        {canComplete ? (
          <button
            type="button"
            onClick={(event) => begin("complete", event)}
            data-testid="cash-redemption-complete-open"
            className="border border-emerald-300/35 bg-emerald-300/10 px-2.5 py-1 text-xs font-bold text-emerald-100 transition hover:bg-emerald-300/20"
          >
            Record Payout Completed
          </button>
        ) : null}
      </div>
    )
  }

  const copy = actionCopy(openAction, frozenCents)

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`cash-redemption-action-title-${requestId}`}
      aria-describedby={`cash-redemption-action-desc-${requestId}`}
      data-testid={`cash-redemption-${openAction}-dialog`}
      className="mt-2 max-w-md border border-amber-200/30 bg-amber-200/[0.06] p-3"
    >
      <h3 id={`cash-redemption-action-title-${requestId}`} className="text-sm font-bold text-amber-100">
        {copy.title}
      </h3>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-200">
        <dt className="text-muted-foreground">Requester</dt>
        <dd>{requester}</dd>
        <dt className="text-muted-foreground">Requested</dt>
        <dd className="font-mono">{formatCurrency(requestedCents)}</dd>
        <dt className="text-muted-foreground">Currently on hold</dt>
        <dd className="font-mono" data-testid="cash-redemption-frozen-amount">
          {formatCurrency(frozenCents)}
        </dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="font-mono">{shortRef}</dd>
      </dl>

      <p id={`cash-redemption-action-desc-${requestId}`} className="mt-2 text-xs leading-5 text-amber-100/90">
        {copy.description}
      </p>

      <label className="mt-3 block">
        <span className="text-xs text-slate-200">{copy.noteLabel}</span>
        <textarea
          ref={noteRef}
          value={note}
          rows={3}
          maxLength={500}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          data-testid={`cash-redemption-${openAction}-note`}
          className="mt-1 block w-full border border-white/12 bg-black/30 px-2 py-1.5 text-sm text-slate-200"
          placeholder={copy.notePlaceholder}
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={submit}
          disabled={busy || note.trim().length < 3}
          data-testid={`cash-redemption-${openAction}-confirm`}
        >
          {busy ? "Recording…" : copy.confirm}
        </Button>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          data-testid={`cash-redemption-${openAction}-cancel`}
          className="px-2.5 py-1 text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {error ? (
        <p role="alert" data-testid="cash-redemption-action-error" className="mt-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  )
}
