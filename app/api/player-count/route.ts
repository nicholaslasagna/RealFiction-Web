export const runtime = "edge"

type McSrvStatResponse = {
  online?: boolean
  players?: {
    online?: number
    max?: number
  }
}

export async function GET() {
  const server = process.env.NEXT_PUBLIC_MINECRAFT_SERVER ?? "realfiction.live"

  try {
    const response = await fetch(`https://api.mcsrvstat.us/3/${server}`, {
      headers: {
        "User-Agent": "RealFiction-Platform/2.0"
      },
      cache: "no-store"
    })

    if (!response.ok) {
      return Response.json({ online: false, playersOnline: 0 }, { status: 200 })
    }

    const data = (await response.json()) as McSrvStatResponse

    return Response.json({
      online: Boolean(data.online),
      playersOnline: data.players?.online ?? 0,
      playersMax: data.players?.max ?? undefined
    })
  } catch {
    return Response.json({ online: false, playersOnline: 0 }, { status: 200 })
  }
}
