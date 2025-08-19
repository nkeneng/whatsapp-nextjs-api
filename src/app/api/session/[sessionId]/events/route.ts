import { bus } from "@/lib/wa/manager"
import { getLast } from "@/lib/wa/manager"

export const runtime = "nodejs"

export async function GET(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params

  const stream = new ReadableStream({
    start(controller) {
      const write = (obj: any) => controller.enqueue(`data: ${JSON.stringify(obj)}\n\n`)

      // send last known state immediately
      const last = getLast(sessionId)
      write({ type: "status", data: { status: last.status } })
      if (last.qr && last.status !== "connected") write({ type: "qr", data: last.qr })

      const onQR = (sid: string, qr: string) => { if (sid === sessionId) write({ type: "qr", data: qr }) }
      const onStatus = (sid: string, status: string, details?: any) => { if (sid === sessionId) write({ type: "status", data: { status, details } }) }
      const onLog = (sid: string, level: string, message: string) => { if (sid === sessionId) write({ type: "log", data: { level, message } }) }
      bus.on("qr", onQR)
      bus.on("status", onStatus)
      bus.on("log", onLog)

      const keepalive = setInterval(() => controller.enqueue(`: keepalive\n\n`), 30000)

      const close = () => {
        clearInterval(keepalive)
        // @ts-ignore
        bus.removeListener("qr", onQR)
        // @ts-ignore
        bus.removeListener("status", onStatus)
        // @ts-ignore
        bus.removeListener("log", onLog)
        controller.close()
      }

      // close when client disconnects
      // @ts-ignore
      req.signal?.addEventListener?.("abort", close)
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    }
  })
}
