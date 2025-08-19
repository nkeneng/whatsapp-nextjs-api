export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { logoutSession } from "@/lib/wa/manager"

export async function POST(req: Request) {
  try {
    const headerSessionId = req.headers.get("x-session-id") ?? undefined
    let body: any = {}
    try { body = await req.json() } catch {}
    const sessionId = headerSessionId ?? body?.sessionId
    if (!sessionId) return NextResponse.json({ success: false, message: "sessionId required (X-Session-Id or in body)" }, { status: 400 })

    await logoutSession(sessionId)
    return NextResponse.json({ success: true, message: "deleted" })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message ?? "failed" }, { status: 500 })
  }
}
