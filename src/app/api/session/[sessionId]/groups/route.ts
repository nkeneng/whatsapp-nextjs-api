export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { listGroups } from "@/lib/wa/manager"

export async function GET(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params
    if (!sessionId) return NextResponse.json({ success: false, message: "sessionId required" }, { status: 400 })

    const url = new URL(req.url)
    const waitMs = Math.min(Number(url.searchParams.get("waitMs") ?? "20000") || 20000, 60000)

    const groups = await listGroups(sessionId, { waitMs })
    return NextResponse.json({ success: true, groups })
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined
    const message =
      typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message) : "failed"

    if (code === "PAIRING_REQUIRED") {
      return NextResponse.json({ success: false, code, message: "Session not paired. Scan QR and retry." }, { status: 409 })
    }
    if (code === "TIMEOUT") {
      return NextResponse.json({ success: false, code, message: "Session not connected in time. Try again shortly." }, { status: 503 })
    }
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
