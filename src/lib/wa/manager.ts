import makeWASocket, { fetchLatestBaileysVersion, type GroupMetadata, WASocket } from "@whiskeysockets/baileys"
import { forwardInbound } from "@/lib/wa/inbound"
import EventEmitter from "node:events"
import { useDbAuthState } from "@/lib/wa/dbAuth"
import { prisma } from "@/lib/db"

const DEFAULT_DEVICE_LABEL = process.env.WA_DEVICE_LABEL || "Steven Api"

export type SessionEvents = {
  qr: (sessionId: string, qr: string) => void
  status: (sessionId: string, status: string, details?: any) => void
  log: (sessionId: string, level: "info"|"warn"|"error", message: string) => void
}

export class SessionBus extends EventEmitter {
  emit<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>): boolean {
    // @ts-ignore
    return super.emit(event, ...args)
  }
  on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]) {
    // @ts-ignore
    return super.on(event, listener)
  }
}

// Ensure single shared instances across Next.js route modules
const globalWA = globalThis as unknown as {
  __wa?: {
    sockets: Map<string, WASocket>
    lastStatus: Map<string, string>
    lastQR: Map<string, string>
    bus: SessionBus
  }
}
if (!globalWA.__wa) {
  globalWA.__wa = {
    sockets: new Map<string, WASocket>(),
    lastStatus: new Map<string, string>(),
    lastQR: new Map<string, string>(),
    bus: new SessionBus(),
  }
}
const sockets = globalWA.__wa.sockets
const lastStatus = globalWA.__wa.lastStatus
const lastQR = globalWA.__wa.lastQR
export const bus = globalWA.__wa.bus

function emitLog(sessionId: string, level: "info"|"warn"|"error", message: string) {
  bus.emit("log", sessionId, level, message)
  // fire-and-forget DB log
  prisma.waLog.create({ data: { sessionId, level, message } }).catch(() => {})
}

export function getLast(sessionId: string) {
  return { status: lastStatus.get(sessionId) ?? "idle", qr: lastQR.get(sessionId) ?? null }
}

async function waitUntilConnected(sessionId: string, timeoutMs = 15000): Promise<"connected" | "needs_qr" | "timeout"> {
  if (lastStatus.get(sessionId) === "connected") return "connected"
  if (lastQR.get(sessionId)) return "needs_qr"

  return await new Promise((resolve) => {
    const onStatus = (sid: string, status: string) => {
      if (sid !== sessionId) return
      if (status === "connected") cleanup("connected")
    }
    const onQR = (sid: string) => { if (sid === sessionId) cleanup("needs_qr") }
    const timer = setTimeout(() => cleanup("timeout"), timeoutMs)

    const cleanup = (result: "connected" | "needs_qr" | "timeout") => {
      clearTimeout(timer)
      // @ts-ignore
      bus.removeListener("status", onStatus)
      // @ts-ignore
      bus.removeListener("qr", onQR)
      resolve(result)
    }

    bus.on("status", onStatus)
    bus.on("qr", onQR)
  })
}

async function getConnectedSocket(sessionId: string, timeoutMs = 20000) {
  const sock = await getOrStartSocket(sessionId)

  const waitResult = await waitUntilConnected(sessionId, timeoutMs)
  if (waitResult !== "connected") {
    const msg = waitResult === "needs_qr" ? "Session not paired yet. Scan QR first." : "Session not connected within timeout."
    const err = new Error(msg) as Error & { code?: string; status?: string }
    err.code = waitResult === "needs_qr" ? "PAIRING_REQUIRED" : "TIMEOUT"
    err.status = waitResult
    throw err
  }

  return sock
}

async function createSocket(sessionId: string) {
  // init session row if not exists (store default label on create)
  const sessionRow = await prisma.waSession.upsert({
    where: { id: sessionId },
    update: { updatedAt: new Date() },
    create: { id: sessionId, status: "starting", label: DEFAULT_DEVICE_LABEL },
  })

  const { state, saveCreds } = await useDbAuthState(sessionId)
  const { version } = await fetchLatestBaileysVersion()
  const deviceLabel = sessionRow.label ?? DEFAULT_DEVICE_LABEL
  // Use a Chrome-like tuple for better compatibility with WA device list
  const sock = makeWASocket({ version, auth: state, printQRInTerminal: false, browser: [deviceLabel, "Chrome", "120.0.0"] })

  emitLog(sessionId, "info", `socket created for ${sessionId}`)

  sock.ev.on("creds.update", async () => {
    await saveCreds()
  })
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // "notify" = fresh incoming messages (not history sync / offline replay)
    if (type !== "notify") return
    for (const m of messages) {
      forwardInbound(sessionId, m, (level, message) => emitLog(sessionId, level, message))
    }
  })
  sock.ev.on("connection.update", async (u: any) => {
    if (u.qr) {
      lastQR.set(sessionId, u.qr)
      // reflect QR state in status map and notify listeners
      lastStatus.set(sessionId, "qr")
      bus.emit("qr", sessionId, u.qr)
      bus.emit("status", sessionId, "qr")
      emitLog(sessionId, "info", "QR received")
      await prisma.waSession.update({ where: { id: sessionId }, data: { status: "qr", lastEventAt: new Date() } })
    }
    if (u.connection === "open") {
      lastStatus.set(sessionId, "connected")
      // Clear any stale QR once connected
      lastQR.delete(sessionId)
      bus.emit("status", sessionId, "connected")
      emitLog(sessionId, "info", "connected")
      await prisma.waSession.update({ where: { id: sessionId }, data: { status: "connected", lastEventAt: new Date() } })
    }
    if (u.connection === "close") {
      const code = (u?.lastDisconnect?.error as any)?.output?.statusCode
      const loggedOut = code === 401 || code === 403 || u?.isLoggedOut
      lastStatus.set(sessionId, "disconnected")
      bus.emit("status", sessionId, "disconnected", u)
      emitLog(sessionId, "warn", `disconnected (code=${code ?? "?"}). ${loggedOut ? "logged out" : "will reconnect"}`)
      await prisma.waSession.update({ where: { id: sessionId }, data: { status: loggedOut ? "disconnected" : "reconnecting", lastEventAt: new Date(), error: loggedOut ? "logged out" : null } })

      if (!loggedOut) {
        setTimeout(async () => {
          try { sock.end(undefined) } catch {}
          sockets.delete(sessionId)
          lastStatus.set(sessionId, "reconnecting")
          bus.emit("status", sessionId, "reconnecting")
          emitLog(sessionId, "info", "reconnecting...")
          const newSock = await createSocket(sessionId)
          sockets.set(sessionId, newSock)
        }, 1000)
      }
    }
  })

  return sock
}

export async function getOrStartSocket(sessionId: string) {
  if (sockets.has(sessionId)) return sockets.get(sessionId)!
  lastStatus.set(sessionId, "starting")
  bus.emit("status", sessionId, "starting")
  await prisma.waSession.upsert({ where: { id: sessionId }, update: { status: "starting", lastEventAt: new Date() }, create: { id: sessionId, status: "starting" } })
  const sock = await createSocket(sessionId)
  sockets.set(sessionId, sock)
  return sock
}

export function stopSocket(sessionId: string) {
  const s = sockets.get(sessionId)
  if (s) {
    try { s.end(undefined) } catch {}
    sockets.delete(sessionId)
    lastStatus.set(sessionId, "stopped")
    // Clear QR on stop as well so UI won't show stale codes
    lastQR.delete(sessionId)
    bus.emit("status", sessionId, "stopped")
    emitLog(sessionId, "info", "socket stopped")
  }
}

export async function sendText(sessionId: string, recipient: string, text: string, opts?: { waitMs?: number }) {
  const sock = await getConnectedSocket(sessionId, opts?.waitMs ?? 20000)

  const jid = recipient.includes("@") ? recipient : `${recipient}@s.whatsapp.net`
  await sock.sendMessage(jid, { text })
  emitLog(sessionId, "info", `sent text to ${jid}`)
}

export async function listGroups(sessionId: string, opts?: { waitMs?: number }) {
  const sock = await getConnectedSocket(sessionId, opts?.waitMs ?? 20000)

  // Returns a map of jid -> GroupMetadata
  const groups: Record<string, GroupMetadata> = await sock.groupFetchAllParticipating()

  return Object.values(groups)
    .map((g) => ({
      id: g.id,
      subject: g.subject,
      size: g.participants?.length,
      announce: !!g.announce,
      restrict: !!g.restrict,
    }))
    .sort((a, b) => (a.subject || "").localeCompare(b.subject || ""))
}

// New: list sessions from DB with in-memory overrides
export async function listSessions(): Promise<Array<{ id: string; status: string; connected: boolean; hasQR: boolean }>> {
  try {
    const rows = await prisma.waSession.findMany({ orderBy: { updatedAt: "desc" } })
    return rows.map((r) => {
      const status = lastStatus.get(r.id) ?? r.status ?? "idle"
      const connected = status === "connected"
      const hasQR = !!lastQR.get(r.id) || status === "qr"
      return { id: r.id, status, connected, hasQR }
    })
  } catch {
    // Fallback to in-memory only (e.g. DB not migrated yet)
    return Array.from(sockets.keys()).map((id) => {
      const status = lastStatus.get(id) ?? "idle"
      const connected = status === "connected"
      const hasQR = !!lastQR.get(id)
      return { id, status, connected, hasQR }
    })
  }
}

// New: logout/delete a session and clear auth
export async function logoutSession(sessionId: string) {
  // stop socket first
  stopSocket(sessionId)

  // clear in-memory state
  lastStatus.delete(sessionId)
  lastQR.delete(sessionId)
  emitLog(sessionId, "info", "logging out and deleting session")

  // Delete dependent logs first to avoid FK constraint, then delete the session.
  // Auth tables (WaAuthCreds/Keys) have onDelete: Cascade in schema, so they will be removed automatically.
  try {
    await prisma.$transaction([
      prisma.waLog.deleteMany({ where: { sessionId } }),
      prisma.waSession.delete({ where: { id: sessionId } }),
    ])
  } catch (e) {
    // If the session row is already gone or DB not migrated, ignore
  }

  bus.emit("status", sessionId, "deleted")
}
