/**
 * Synchronisation des messages WhatsApp entrants vers plateforme externe
 * Enregistre chaque message reçu dans l'historique de la plateforme
 */

export async function forwardInboundMessage(
  from: string,
  body: string,
  options?: {
    messageId?: string
    timestamp?: number
  }
) {
  const webhookUrl = process.env.OUTBOUND_WEBHOOK_URL
  const webhookKey = process.env.OUTBOUND_WEBHOOK_KEY

  // Skip if webhook not configured
  if (!webhookUrl || !webhookKey) {
    console.debug('[WebhookInbound] Webhook not configured, skipping')
    return
  }

  try {
    // Normaliser le numéro (enlever @s.whatsapp.net si présent)
    let normalizedFrom = from.includes('@') ? from.split('@')[0] : from
    // Garder juste les chiffres
    normalizedFrom = normalizedFrom.replace(/[^0-9]/g, '')
    if (!normalizedFrom.startsWith('+')) {
      normalizedFrom = '+' + normalizedFrom
    }

    const payload = {
      from: normalizedFrom,
      body: body.substring(0, 60000), // Limite à 60k caractères
      timestamp: options?.timestamp || Math.floor(Date.now() / 1000),
      id: options?.messageId || `msg_in_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    }

    const response = await fetch(`${webhookUrl}/api/webhooks/whatsapp-inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': webhookKey,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[WebhookInbound] Failed to forward message: ${response.status} ${text}`)
      return { success: false, error: `HTTP ${response.status}` }
    }

    const result = await response.json()
    console.info(`[WebhookInbound] Message forwarded successfully:`, { from: normalizedFrom, messageId: result.messageId })
    return { success: true, data: result }
  } catch (error) {
    // Ne pas bloquer la réception si le forward échoue
    console.error('[WebhookInbound] Error forwarding message:', error)
    return { success: false, error: String(error) }
  }
}
