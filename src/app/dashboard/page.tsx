"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { CheckCircle2, AlertOctagon, Circle, Loader2, Trash2, RefreshCw, Link as LinkIcon, QrCode } from "lucide-react"

// Tiny QR renderer using canvas to avoid external services
function renderQRToDataUrl(text: string, size = 240): string {
  // dynamic import only on client so SSR doesn't break
  // @ts-ignore
  if (typeof window === "undefined") return ""
  // Use a minimal inline QR implementation via qrcode-generator (tiny UMD)
  // Since we cannot bundle here, fallback to a simple external if not present
  // But we try to draw a simple placeholder grid based on text hash to avoid network
  try {
    const seg = Array.from(text).reduce((a, c) => a + c.charCodeAt(0), 0)
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size)
    // very naive block pattern as placeholder; the actual WhatsApp scanner accepts proper QR only
    // If a global QR library exists at window.QRCode, use it; otherwise fallback to remote img in UI below
    // Returning empty string indicates we should use <img src> fallback
    // @ts-ignore
    if (!window.QRCode) return ""
    // @ts-ignore
    const qr = new window.QRCode(document.createElement("div"), { text, width: size, height: size, correctLevel: 0 })
    const img = qr._el.querySelector("img") as HTMLImageElement | null
    return img?.src || ""
  } catch { return "" }
}

export default function DashboardPage() {
  const [sessionId, setSessionId] = useState("")
  const [recipient, setRecipient] = useState("")
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState("idle")
  const [qr, setQr] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [sessions, setSessions] = useState<{ id: string; status: string; connected: boolean; hasQR: boolean }[]>([])
  const evtRef = useRef<EventSource | null>(null)

  const start = async () => {
    if (!sessionId) return alert("Enter sessionId")
    setLogs((l) => [...l, `starting session ${sessionId}...`])
    setStatus("starting"); setQr(null)
    // subscribe first so we don't miss early QR
    subscribe(sessionId)
    await fetch("/api/session/start", { method: "POST", body: JSON.stringify({ sessionId }) })
    refreshSessions()
  }

  const pair = async () => {
    if (!sessionId) return alert("Enter sessionId")
    setStatus("starting")
    setQr(null)
    const res = await fetch("/api/session/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, timeoutMs: 25000 }) })
    const data = await res.json()
    if (!data.success) {
      setLogs((l) => [...l, `pair failed: ${data.message || "unknown"}`])
      return
    }
    if (data.status === "connected") {
      setStatus("connected"); setQr(null)
      setLogs((l) => [...l, `paired ${sessionId}`])
      refreshSessions()
      return
    }
    if (data.status === "qr" && data.qr) {
      setStatus("qr")
      setQr(data.qr as string)
      setLogs((l) => [...l, "QR ready — scan it from WhatsApp -> Linked devices"])
      // also start SSE to keep updates flowing
      subscribe(sessionId)
    }
  }

  const subscribe = (id?: string) => {
    const sid = id ?? sessionId
    if (!sid) return
    evtRef.current?.close()
    const es = new EventSource(`/api/session/${sid}/events`)
    es.onopen = () => setLogs((l) => [...l, `subscribed to ${sid}`])
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        if (payload.type === "qr") setQr(payload.data)
        if (payload.type === "status") {
          const s = payload.data.status as string
          setStatus(s)
          // only clear QR on terminal statuses to prevent hiding it during start/reconnect
          if (s === "connected" || s === "disconnected" || s === "stopped") setQr(null)
        }
        if (payload.type === "log") setLogs((l) => [...l.slice(-200), payload.data.message])
      } catch {}
    }
    es.onerror = () => setLogs((l) => [...l, "event stream error"]) 
    evtRef.current = es
  }

  const send = async () => {
    if (!sessionId || !recipient || !message) return
    const res = await fetch(`/api/session/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
      body: JSON.stringify({ recipient, message })
    })
    const data = await res.json()
    setLogs((l) => [...l, `send: ${data.message}`])
  }

  const logout = async () => {
    if (!sessionId) return alert("Enter sessionId")
    await fetch(`/api/session/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) })
    setLogs((l) => [...l, `logged out ${sessionId}`])
    setStatus("idle"); setQr(null)
    refreshSessions()
  }

  const refreshSessions = async () => {
    const res = await fetch("/api/session/list")
    const data = await res.json()
    setSessions(data.sessions ?? [])
  }

  useEffect(() => { refreshSessions(); return () => evtRef.current?.close() }, [])

  const StatusPill = ({ value }: { value: string }) => {
    const common = "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs"
    if (value === "connected") {
      return (
        <span className={`${common} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300`}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Connected
        </span>
      )
    }
    if (value === "starting" || value === "reconnecting" || value === "connecting") {
      return (
        <span className={`${common} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {value}
        </span>
      )
    }
    if (value === "disconnected" || value === "stopped") {
      return (
        <span className={`${common} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`}>
          <AlertOctagon className="h-3.5 w-3.5" /> {value}
        </span>
      )
    }
    return (
      <span className={`${common} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
        <Circle className="h-3.5 w-3.5" /> {value}
      </span>
    )
  }

  const qrDataUrl = qr ? renderQRToDataUrl(qr) : ""

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <Card className="p-4 space-y-2">
        <div className="flex gap-2">
          <Input placeholder="session id (e.g. your-email)" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          <Button onClick={pair}><LinkIcon className="h-4 w-4 mr-1" /> Pair</Button>
          <Button onClick={start} variant="outline"><QrCode className="h-4 w-4 mr-1" /> Start</Button>
          <Button variant="outline" onClick={() => subscribe()}>Subscribe</Button>
          <Button variant="destructive" onClick={logout}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          <Button variant="outline" onClick={refreshSessions}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-2">Status: <StatusPill value={status} /></div>
        {qr && (
          <div className="mt-2">
            <div className="font-medium mb-1">Scan this QR in WhatsApp</div>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="qr" className="border" width={240} height={240} />
            ) : (
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qr)}`} alt="qr" className="border" />
            )}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={pair}>Get new QR</Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-medium">Active Sessions</div>
        <div className="space-y-1">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{s.id}</span>
                <StatusPill value={s.status} />
                {s.status === "qr" && s.hasQR && <span className="text-xs text-amber-600">QR pending</span>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setSessionId(s.id); subscribe(s.id) }}>Subscribe</Button>
                <Button size="sm" variant="destructive" onClick={async () => { await fetch(`/api/session/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: s.id }) }); refreshSessions() }}>Delete</Button>
              </div>
            </div>
          ))}
          {sessions.length === 0 && <div className="text-xs text-muted-foreground">No sessions yet</div>}
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex gap-2">
          <Input placeholder="recipient (phone or JID)" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          <Input placeholder="message" value={message} onChange={(e) => setMessage(e.target.value)} />
          <Button onClick={async () => { await send(); }}>
            Send
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="font-medium mb-2">Logs</div>
        <pre className="text-xs h-64 overflow-auto bg-muted p-2 rounded">{logs.join("\n")}</pre>
      </Card>
    </div>
  )
}
