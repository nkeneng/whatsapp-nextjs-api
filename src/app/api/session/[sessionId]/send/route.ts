import { NextResponse } from "next/server"
import { z } from "zod"
import { sendText } from "@/lib/wa/manager"

const schema = z.object({ recipient: z.string().min(3), message: z.string().min(1) })

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: "invalid payload" }, { status: 400 })
    }
    const { recipient, message } = parsed.data
    await sendText(sessionId, recipient, message)
    return NextResponse.json({ success: true, message: `sent to ${recipient}` })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || "send failed" }, { status: 500 })
  }
}
