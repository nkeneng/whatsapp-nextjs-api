export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { getOrStartSocket } from "@/lib/wa/manager"
import { prisma } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json()
    if (!sessionId) return NextResponse.json({ success: false, message: "sessionId required" }, { status: 400 })
    await prisma.waSession.upsert({ where: { id: sessionId }, update: { updatedAt: new Date() }, create: { id: sessionId } }).catch(() => {})
    await getOrStartSocket(sessionId)
    return NextResponse.json({ success: true, message: "session starting" })
  } catch (e: any) {
    if (e?.code === "DB_NOT_MIGRATED") {
      return NextResponse.json({ success: false, code: e.code, message: e.message }, { status: 500 })
    }
    return NextResponse.json({ success: false, message: e?.message || "failed" }, { status: 500 })
  }
}
