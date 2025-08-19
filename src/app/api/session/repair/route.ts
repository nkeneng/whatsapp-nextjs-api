export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getOrStartSocket, stopSocket } from "@/lib/wa/manager"

export async function POST(req: Request) {
  try {
    const headerSessionId = req.headers.get("x-session-id") ?? undefined
    let body: any = {}
    try { body = await req.json() } catch {}
    const sessionId = headerSessionId ?? body?.sessionId
    if (!sessionId) return NextResponse.json({ success: false, message: "sessionId required (X-Session-Id or in body)" }, { status: 400 })

    // Remove app-state related keys to force a clean resync
    const del = await prisma.waAuthKey.deleteMany({
      where: {
        sessionId,
        OR: [
          { type: { startsWith: "app-state" } },
          { type: { equals: "app-state-sync-key" } },
          { type: { equals: "app-state-sync-version" } },
          { type: { equals: "app-state-version" } },
        ],
      },
    })

    // restart socket to force resync now
    stopSocket(sessionId)
    await getOrStartSocket(sessionId)

    return NextResponse.json({ success: true, message: `removed ${del.count} app-state keys; session restarting to resync` })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message ?? "failed" }, { status: 500 })
  }
}
