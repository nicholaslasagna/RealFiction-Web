// The operations notification for a new cash-redemption review.
//
// Pure: no env, no network, no DB, so what may and may not appear in an
// operations email is enforced by a test rather than by reviewer memory.
//
// WHAT THIS DELIBERATELY OMITS
// ============================
// No claim secret, no verifier, no ciphertext, no encryption key version, no
// gift-card public reference, no payment intent, no charge id. An operations
// alert travels to a shared mailbox and is forwarded, quoted, and archived; it
// carries the minimum needed to open the right row on the admin page and
// nothing that would be dangerous in a mailbox.
//
// The account is identified by its id. That is enough to find the request, and
// the admin page — behind requireStaff() — resolves anything further.

import { escapeHtml, formatMoney } from "./templates"

export type CashRedemptionAdminEmail = {
  requestId: string
  claimantUserId: string
  requestedCents: number
  frozenCents: number
  state: string
  requestedAt: string | null
  siteUrl: string
}

/** `b1000000-…-0001` — enough to correlate, not a full identifier in a mailbox. */
function shortId(value: string): string {
  const id = String(value ?? "")
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

export function buildCashRedemptionAdminReviewEmail(data: CashRedemptionAdminEmail) {
  const amount = formatMoney(data.requestedCents, "USD")
  const held = formatMoney(data.frozenCents, "USD")
  const queue = `${data.siteUrl}/admin/cash-redemptions`
  const when = data.requestedAt ? String(data.requestedAt).slice(0, 19).replace("T", " ") : "just now"

  const lines = [
    "A customer has requested a cash-redemption review.",
    "",
    `Amount requested: ${amount}`,
    `Currently on hold: ${held}`,
    `State: ${data.state}`,
    `Requested: ${when} UTC`,
    `Request: ${shortId(data.requestId)}`,
    `Account: ${shortId(data.claimantUserId)}`,
    "",
    "Their credit is frozen and cannot be spent until this review is closed.",
    "",
    `Open the queue: ${queue}`,
    "",
    "This is a notification. The review itself lives on the admin page, so this",
    "request is visible there whether or not this email arrives."
  ]

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#021429;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;">
    <tr><td style="padding-bottom:16px;">
      <div style="font-size:20px;font-weight:700;color:#f6f4ef;">Cash-redemption review requested</div>
    </td></tr>
    <tr><td style="padding:20px;background:#07203a;border-radius:8px;color:#f6f4ef;font-size:15px;line-height:23px;">
      <p style="margin:0 0 12px;">A customer has requested a cash-redemption review.</p>
      <p style="margin:0 0 4px;">Amount requested: <strong>${escapeHtml(amount)}</strong></p>
      <p style="margin:0 0 4px;">Currently on hold: <strong>${escapeHtml(held)}</strong></p>
      <p style="margin:0 0 4px;">State: ${escapeHtml(data.state)}</p>
      <p style="margin:0 0 4px;color:#9db3c4;font-size:13px;">Requested ${escapeHtml(when)} UTC</p>
      <p style="margin:0 0 12px;color:#9db3c4;font-size:13px;">
        Request ${escapeHtml(shortId(data.requestId))} · Account ${escapeHtml(shortId(data.claimantUserId))}
      </p>
      <p style="margin:0 0 16px;">Their credit is frozen and cannot be spent until this review is closed.</p>
      <p style="margin:0 0 16px;">
        <a href="${escapeHtml(queue)}"
           style="display:inline-block;background:#ffd479;color:#04182b;padding:11px 20px;border-radius:6px;font-weight:700;text-decoration:none;">
          Open the review queue
        </a>
      </p>
      <p style="margin:0;color:#9db3c4;font-size:13px;">
        This is a notification. The review lives on the admin page, so it is visible there whether or
        not this email arrives.
      </p>
    </td></tr>
  </table>
</body>
</html>`

  return {
    subject: `Cash-redemption review requested — ${amount}`,
    text: lines.join("\n"),
    html
  }
}
