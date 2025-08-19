export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { bus, getLast, getOrStartSocket } from "@/lib/wa/manager"

function once<T>(sessionId: string, timeoutMs = 20000) {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => cleanup(undefined as any), timeoutMs)

    const onQR = (sid: string, qr: string) => {
      if (sid !== sessionId) return
      cleanup({ type: "qr", qr } as any)
    }
    const onStatus = (sid: string, status: string) => {
      if (sid !== sessionId) return
      if (status === "connected") cleanup({ type: "connected" } as any)
      if (status === "qr") {
        const last = getLast(sessionId)
        if (last.qr) cleanup({ type: "qr", qr: last.qr } as any)
      }
    }

    const cleanup = (result: any) => {
      clearTimeout(timer)
      // @ts-ignore
      bus.removeListener("qr", onQR)
      // @ts-ignore
      bus.removeListener("status", onStatus)
      resolve(result)
    }

    bus.on("qr", onQR)
    bus.on("status", onStatus)
  })
}

export async function POST(req: Request) {
  try {
    const { sessionId, timeoutMs } = await req.json()
    if (!sessionId) return NextResponse.json({ success: false, message: "sessionId required" }, { status: 400 })

    await getOrStartSocket(sessionId)

    // immediate state
    const last = getLast(sessionId)
    if (last.status === "connected") return NextResponse.json({ success: true, status: "connected" })
    if (last.qr) return NextResponse.json({ success: true, status: "qr", qr: last.qr })

    // wait for next QR or connected
    const result = await once<{ type: "qr"; qr: string } | { type: "connected" }>(sessionId, Math.min(Number(timeoutMs) || 20000, 60000))
    if (!result) return NextResponse.json({ success: true, status: "timeout" })
    if (result.type === "connected") return NextResponse.json({ success: true, status: "connected" })
    return NextResponse.json({ success: true, status: "qr", qr: result.qr })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || "failed" }, { status: 500 })
  }
}
