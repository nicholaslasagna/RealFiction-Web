export function formatEconomyBalance(balanceMinor: string | number | bigint, scale = 100) {
  const safeScale = BigInt(Math.max(1, Math.trunc(scale || 100)))
  let amount: bigint

  try {
    amount = BigInt(balanceMinor)
  } catch {
    amount = 0n
  }

  const negative = amount < 0n
  const absolute = negative ? -amount : amount
  const whole = absolute / safeScale
  const fraction = absolute % safeScale

  return `${negative ? "-" : ""}$${whole.toLocaleString()}.${fraction.toString().padStart(2, "0")}`
}
