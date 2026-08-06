// Renders purchase history with the SAME component the account page uses, so a
// browser check here is a check of the real thing rather than a lookalike.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PurchaseRowCard, type PurchaseRow } from "@/components/account/purchase-history"

export function OrderHistoryPreview({ orders }: { orders: readonly PurchaseRow[] }) {
  return (
    <Card className="minecraft-card">
      <CardHeader>
        <CardTitle className="display-font text-3xl">All Purchases</CardTitle>
        <CardDescription>Thanks for supporting RealFiction.</CardDescription>
      </CardHeader>
      <CardContent>
        {orders.length ? (
          <div className="space-y-3">
            {orders.map((order) => (
              <PurchaseRowCard key={order.id} order={order} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5 text-center">
            <p className="font-semibold text-white">No purchases yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cosmetics and supporter perks will show here.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
