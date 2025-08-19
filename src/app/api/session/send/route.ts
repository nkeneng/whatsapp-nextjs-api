export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { sendText } from "@/lib/wa/manager"
import { z } from "zod"

const BodySchema = z.object({
  sessionId: z.string().min(1).optional(),
  recipient: z.string().min(1),
  message: z.string().min(1),
})

export async function POST(req: Request) {
  try {
    const headerSessionId = req.headers.get("x-session-id") ?? undefined

    let body: any = {}
    try { body = await req.json() } catch {}

    const parsed = BodySchema.safeParse(body)
    const bodySessionId = parsed.success ? parsed.data.sessionId : body?.sessionId
    const sessionId = headerSessionId ?? bodySessionId

    if (!sessionId) {
      return NextResponse.json({ success: false, message: "sessionId required (X-Session-Id header or in JSON body)" }, { status: 400 })
    }

    const recipient = parsed.success ? parsed.data.recipient : body?.recipient
    const message = parsed.success ? parsed.data.message : body?.message

    if (!recipient || !message) {
      return NextResponse.json({ success: false, message: "recipient and message are required" }, { status: 400 })
    }

    await sendText(sessionId, recipient, message)
    return NextResponse.json({ success: true, message: "sent" })
  } catch (e: any) {
    if (e?.code === "PAIRING_REQUIRED") {
      return NextResponse.json({ success: false, code: e.code, message: "Session not paired. Scan QR and retry." }, { status: 409 })
    }
    if (e?.code === "TIMEOUT") {
      return NextResponse.json({ success: false, code: e.code, message: "Session not connected in time. Try again shortly." }, { status: 503 })
    }
    return NextResponse.json({ success: false, message: e?.message ?? "failed" }, { status: 500 })
  }
}
