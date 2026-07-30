import type { WAMessage } from "@whiskeysockets/baileys"

// Forward incoming WhatsApp messages to an external webhook (e.g. the
// Zone Travel admin). Disabled unless INBOUND_WEBHOOK_URL and
// INBOUND_WEBHOOK_KEY are both set. Optional INBOUND_WEBHOOK_SESSIONS
// restricts forwarding to a comma-separated list of session ids.

const WEBHOOK_URL = process.env.INBOUND_WEBHOOK_URL || ""
const WEBHOOK_KEY = process.env.INBOUND_WEBHOOK_KEY || ""
const SESSION_FILTER = (process.env.INBOUND_WEBHOOK_SESSIONS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

const RETRY_DELAYS_MS = [5_000, 25_000]

export function inboundForwardingEnabled(sessionId: string): boolean {
  if (!WEBHOOK_URL || !WEBHOOK_KEY) return false
  if (SESSION_FILTER.length > 0 && !SESSION_FILTER.includes(sessionId)) return false
  return true
}

// Extract a human-readable body from any message type. Media without caption
// becomes a placeholder so the team still sees that the contact replied.
export function extractBody(m: WAMessage): string | null {
  const msg = m.message
  if (!msg) return null
  if (msg.conversation) return msg.conversation
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text
  if (msg.imageMessage) return msg.imageMessage.caption || "[📷 image reçue]"
  if (msg.videoMessage) return msg.videoMessage.caption || "[🎬 vidéo reçue]"
  if (msg.documentMessage) return msg.documentMessage.caption || `[📄 document reçu${msg.documentMessage.fileName ? ` : ${msg.documentMessage.fileName}` : ""}]`
  if (msg.audioMessage) return "[🎙 message vocal reçu]"
  if (msg.stickerMessage) return "[sticker reçu]"
  if (msg.locationMessage) return "[📍 position reçue]"
  if (msg.contactMessage || msg.contactsArrayMessage) return "[👤 contact partagé]"
  return null
}

async function postWithRetries(payload: Record<string, unknown>, log: (level: "info"|"warn"|"error", message: string) => void) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": WEBHOOK_KEY },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        log("info", `inbound from ${payload.from} forwarded (${res.status})`)
        return
      }
      log("warn", `inbound forward got HTTP ${res.status} (attempt ${attempt + 1})`)
    } catch (e) {
      log("warn", `inbound forward failed: ${(e as Error).message} (attempt ${attempt + 1})`)
    }
    if (attempt >= RETRY_DELAYS_MS.length) {
      log("error", `inbound from ${payload.from} dropped after ${attempt + 1} attempts`)
      return
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
  }
}

export async function forwardInbound(
  sessionId: string,
  m: WAMessage,
  log: (level: "info"|"warn"|"error", message: string) => void,
) {
  if (!inboundForwardingEnabled(sessionId)) return
  if (m.key.fromMe) return

  const jid = m.key.remoteJid || ""
  // Only direct user chats: skip groups, broadcasts, newsletters and LID jids
  // (LIDs are privacy identifiers, not phone numbers — the webhook matches by number).
  if (!jid.endsWith("@s.whatsapp.net")) {
    if (jid.endsWith("@lid")) log("warn", `inbound from LID jid skipped (${jid})`)
    return
  }

  const body = extractBody(m)
  if (!body) return

  const payload = {
    sessionId,
    from: jid.replace("@s.whatsapp.net", ""),
    body,
    timestamp: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    id: m.key.id || null,
  }

  // Fire-and-forget: never block or crash the Baileys event loop.
  void postWithRetries(payload, log)
}
