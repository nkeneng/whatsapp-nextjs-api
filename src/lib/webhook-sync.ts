/**
 * Synchronisation des messages WhatsApp
 * Enregistre chaque message sortant dans l'historique de la plateforme
 */

export async function syncMessageToPlatform(
  to: string,
  body: string,
  options?: {
    messageId?: string
    status?: 'sent' | 'delivered' | 'read'
    timestamp?: number
  }
) {
  const webhookUrl = process.env.OUTBOUND_WEBHOOK_URL
  const webhookKey = process.env.OUTBOUND_WEBHOOK_KEY

  // Skip if webhook not configured
  if (!webhookUrl || !webhookKey) {
    console.debug('[WebhookSync] Webhook not configured, skipping')
    return
  }

  try {
    // Normaliser le numéro (enlever @s.whatsapp.net si présent)
    let normalizedTo = to.includes('@') ? to.split('@')[0] : to
    // Ajouter + si absent et s'assurer que c'est juste des chiffres
    normalizedTo = normalizedTo.replace(/[^0-9]/g, '')
    if (!normalizedTo.startsWith('+')) {
      normalizedTo = '+' + normalizedTo
    }

    const payload = {
      to: normalizedTo,
      body: body.substring(0, 60000), // Limite à 60k caractères
      timestamp: options?.timestamp || Math.floor(Date.now() / 1000),
      messageId: options?.messageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      status: options?.status || 'sent',
    }

    const response = await fetch(`${webhookUrl}/api/webhooks/whatsapp-outbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': webhookKey,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[WebhookSync] Failed to sync message: ${response.status} ${text}`)
      return { success: false, error: `HTTP ${response.status}` }
    }

    const result = await response.json()
    console.info(`[WebhookSync] Message synced successfully:`, { to: normalizedTo, messageId: result.messageId })
    return { success: true, data: result }
  } catch (error) {
    // Ne pas bloquer l'envoi si la sync échoue
    console.error('[WebhookSync] Error syncing message:', error)
    return { success: false, error: String(error) }
  }
}
