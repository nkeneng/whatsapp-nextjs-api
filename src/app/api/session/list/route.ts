export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { listSessions } from "@/lib/wa/manager"

export async function GET() {
  try {
    return NextResponse.json({ success: true, sessions: await listSessions() })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message ?? "failed" }, { status: 500 })
  }
}
