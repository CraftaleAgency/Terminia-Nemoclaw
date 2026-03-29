import cron from 'node-cron'
import supabase from './supabase.ts'
import { sendEmail, FROM_NAME } from './resend.ts'

// ── Types ────────────────────────────────────────────────────────────────────

interface DeadlineItem {
  type: 'alert' | 'contract_expiry' | 'obligation' | 'milestone' | 'invoice'
  title: string
  description: string | null
  due_date: string
  priority: string
  related_id: string
}

interface UserNotification {
  email: string
  full_name: string | null
  company_name: string | null
  items: DeadlineItem[]
}

// ── Deadline Collection ──────────────────────────────────────────────────────

async function collectDeadlines(): Promise<Map<string, UserNotification>> {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  // Also collect items due today (overdue catch) and day-after-tomorrow (2-day window)
  const today = new Date().toISOString().split('T')[0]

  const userMap = new Map<string, UserNotification>()

  // Helper: resolve company_id → users with emails
  async function getUsersForCompany(companyId: string) {
    const { data } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('company_id', companyId)
    return data || []
  }

  async function getCompanyName(companyId: string) {
    const { data } = await supabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single()
    return data?.name || null
  }

  function addItem(userId: string, email: string, fullName: string | null, companyName: string | null, item: DeadlineItem) {
    if (!userMap.has(userId)) {
      userMap.set(userId, { email, full_name: fullName, company_name: companyName, items: [] })
    }
    userMap.get(userId)!.items.push(item)
  }

  // 1. Pending alerts with trigger_date = tomorrow or today (not yet notified)
  const { data: alerts } = await supabase
    .from('alerts')
    .select('id, title, description, alert_type, priority, trigger_date, company_id')
    .in('status', ['pending', 'snoozed', 'escalated'])
    .gte('trigger_date', today)
    .lte('trigger_date', `${tomorrowStr}T23:59:59`)
    .is('notified_at', null)

  if (alerts?.length) {
    const companyIds = [...new Set(alerts.map(a => a.company_id))]
    for (const cid of companyIds) {
      const users = await getUsersForCompany(cid)
      const companyName = await getCompanyName(cid)
      const companyAlerts = alerts.filter(a => a.company_id === cid)
      for (const user of users) {
        for (const alert of companyAlerts) {
          addItem(user.id, user.email, user.full_name, companyName, {
            type: 'alert',
            title: alert.title,
            description: alert.description,
            due_date: alert.trigger_date,
            priority: alert.priority,
            related_id: alert.id,
          })
        }
      }
    }
  }

  // 2. Contracts expiring tomorrow
  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, title, end_date, company_id, status')
    .eq('status', 'active')
    .gte('end_date', today)
    .lte('end_date', `${tomorrowStr}T23:59:59`)

  if (contracts?.length) {
    const companyIds = [...new Set(contracts.map(c => c.company_id))]
    for (const cid of companyIds) {
      const users = await getUsersForCompany(cid)
      const companyName = await getCompanyName(cid)
      const cc = contracts.filter(c => c.company_id === cid)
      for (const user of users) {
        for (const c of cc) {
          addItem(user.id, user.email, user.full_name, companyName, {
            type: 'contract_expiry',
            title: `Contratto in scadenza: ${c.title}`,
            description: null,
            due_date: c.end_date!,
            priority: 'high',
            related_id: c.id,
          })
        }
      }
    }
  }

  // 3. Obligations due tomorrow (not completed)
  const { data: obligations } = await supabase
    .from('obligations')
    .select('id, description, due_date, contract_id, status')
    .in('status', ['pending', 'in_progress'])
    .gte('due_date', today)
    .lte('due_date', `${tomorrowStr}T23:59:59`)

  if (obligations?.length) {
    // Resolve contract → company
    const contractIds = [...new Set(obligations.map(o => o.contract_id))]
    const { data: oblContracts } = await supabase
      .from('contracts')
      .select('id, company_id, title')
      .in('id', contractIds)
    const contractMap = new Map((oblContracts || []).map(c => [c.id, c]))

    for (const obl of obligations) {
      const contract = contractMap.get(obl.contract_id)
      if (!contract) continue
      const users = await getUsersForCompany(contract.company_id)
      const companyName = await getCompanyName(contract.company_id)
      for (const user of users) {
        addItem(user.id, user.email, user.full_name, companyName, {
          type: 'obligation',
          title: `Obbligo in scadenza (${contract.title})`,
          description: obl.description,
          due_date: obl.due_date!,
          priority: 'high',
          related_id: obl.id,
        })
      }
    }
  }

  // 4. Milestones due tomorrow (not completed)
  const { data: milestones } = await supabase
    .from('milestones')
    .select('id, title, due_date, contract_id, status')
    .in('status', ['pending', 'in_progress'])
    .gte('due_date', today)
    .lte('due_date', `${tomorrowStr}T23:59:59`)

  if (milestones?.length) {
    const contractIds = [...new Set(milestones.map(m => m.contract_id))]
    const { data: msContracts } = await supabase
      .from('contracts')
      .select('id, company_id, title')
      .in('id', contractIds)
    const contractMap = new Map((msContracts || []).map(c => [c.id, c]))

    for (const ms of milestones) {
      const contract = contractMap.get(ms.contract_id)
      if (!contract) continue
      const users = await getUsersForCompany(contract.company_id)
      const companyName = await getCompanyName(contract.company_id)
      for (const user of users) {
        addItem(user.id, user.email, user.full_name, companyName, {
          type: 'milestone',
          title: `Milestone in scadenza: ${ms.title} (${contract.title})`,
          description: null,
          due_date: ms.due_date!,
          priority: 'medium',
          related_id: ms.id,
        })
      }
    }
  }

  // 5. Invoices due tomorrow (unpaid)
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, due_date, amount_gross, payment_status, company_id, invoice_type')
    .in('payment_status', ['pending', 'overdue'])
    .gte('due_date', today)
    .lte('due_date', `${tomorrowStr}T23:59:59`)

  if (invoices?.length) {
    const companyIds = [...new Set(invoices.map(i => i.company_id))]
    for (const cid of companyIds) {
      const users = await getUsersForCompany(cid)
      const companyName = await getCompanyName(cid)
      const ci = invoices.filter(i => i.company_id === cid)
      for (const user of users) {
        for (const inv of ci) {
          const direction = inv.invoice_type === 'in' ? 'da incassare' : 'da pagare'
          addItem(user.id, user.email, user.full_name, companyName, {
            type: 'invoice',
            title: `Fattura ${inv.invoice_number} ${direction}`,
            description: `Importo: €${inv.amount_gross?.toLocaleString('it-IT')}`,
            due_date: inv.due_date!,
            priority: inv.invoice_type === 'out' ? 'high' : 'medium',
            related_id: inv.id,
          })
        }
      }
    }
  }

  return userMap
}

// ── Email Template ───────────────────────────────────────────────────────────

function buildEmailHtml(notification: UserNotification): string {
  const name = notification.full_name || 'Utente'
  const company = notification.company_name ? ` — ${notification.company_name}` : ''

  const priorityBadge = (p: string) => {
    const colors: Record<string, string> = {
      critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#65a30d',
    }
    return `<span style="background:${colors[p] || '#6b7280'};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">${p.toUpperCase()}</span>`
  }

  const typeIcon: Record<string, string> = {
    alert: '⚠️', contract_expiry: '📄', obligation: '📋', milestone: '🎯', invoice: '💰',
  }

  const typeLabel: Record<string, string> = {
    alert: 'Alert', contract_expiry: 'Scadenza Contratto', obligation: 'Obbligo', milestone: 'Milestone', invoice: 'Fattura',
  }

  const rows = notification.items.map(item => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
        ${typeIcon[item.type] || '📌'} <strong>${typeLabel[item.type] || item.type}</strong>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
        <strong>${item.title}</strong>
        ${item.description ? `<br><span style="color:#6b7280;font-size:13px;">${item.description}</span>` : ''}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:center;">
        ${new Date(item.due_date).toLocaleDateString('it-IT')}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:center;">
        ${priorityBadge(item.priority)}
      </td>
    </tr>
  `).join('')

  return `
  <!DOCTYPE html>
  <html lang="it">
  <head><meta charset="utf-8"></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f9fafb;">
    <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
      <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:24px 32px;">
        <h1 style="color:#fff;margin:0;font-size:22px;">🐙 ${FROM_NAME}</h1>
        <p style="color:#94a3b8;margin:4px 0 0;">Riepilogo scadenze giornaliero</p>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px 32px;">
        <p style="font-size:15px;color:#374151;">
          Ciao <strong>${name}</strong>${company},<br>
          hai <strong>${notification.items.length}</strong> scadenz${notification.items.length === 1 ? 'a' : 'e'} in arrivo:
        </p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:10px 16px;text-align:left;font-size:13px;color:#64748b;">Tipo</th>
              <th style="padding:10px 16px;text-align:left;font-size:13px;color:#64748b;">Dettaglio</th>
              <th style="padding:10px 16px;text-align:center;font-size:13px;color:#64748b;">Data</th>
              <th style="padding:10px 16px;text-align:center;font-size:13px;color:#64748b;">Priorità</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="text-align:center;margin:24px 0 8px;">
          <a href="https://terminia.pezserv.org/dashboard/alerts"
             style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Vai alla Dashboard
          </a>
        </div>
        <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:24px;">
          Questo è un messaggio automatico inviato da ${FROM_NAME}. Non rispondere a questa email.
        </p>
      </div>
    </div>
  </body>
  </html>`
}

// ── Send Notifications ───────────────────────────────────────────────────────

async function sendNotifications(userMap: Map<string, UserNotification>): Promise<{ sent: number; errors: number }> {
  let sent = 0
  let errors = 0

  for (const [_userId, notification] of userMap) {
    if (!notification.items.length) continue

    try {
      await sendEmail({
        to: notification.email,
        subject: `📋 ${notification.items.length} scadenz${notification.items.length === 1 ? 'a' : 'e'} in arrivo — ${FROM_NAME}`,
        html: buildEmailHtml(notification),
      })
      sent++
    } catch (err) {
      console.error(`[notifier] Failed to email ${notification.email}:`, (err as Error).message)
      errors++
    }
  }

  return { sent, errors }
}

// ── Mark alerts as notified ──────────────────────────────────────────────────

async function markNotified(userMap: Map<string, UserNotification>) {
  const alertIds = new Set<string>()
  for (const [, notification] of userMap) {
    for (const item of notification.items) {
      if (item.type === 'alert') alertIds.add(item.related_id)
    }
  }

  if (alertIds.size > 0) {
    await supabase
      .from('alerts')
      .update({
        notified_at: new Date().toISOString(),
        notified_via: ['email'],
      })
      .in('id', [...alertIds])
  }
}

// ── Main job ─────────────────────────────────────────────────────────────────

export async function runNotifierJob() {
  const start = Date.now()
  console.log('[notifier] Starting daily deadline check...')

  try {
    const userMap = await collectDeadlines()

    if (userMap.size === 0) {
      console.log('[notifier] No deadlines found for tomorrow. Done.')
      return { sent: 0, errors: 0, users: 0 }
    }

    console.log(`[notifier] Found deadlines for ${userMap.size} user(s)`)

    const result = await sendNotifications(userMap)
    await markNotified(userMap)

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`[notifier] Done in ${elapsed}s — sent: ${result.sent}, errors: ${result.errors}`)
    return { ...result, users: userMap.size }
  } catch (err) {
    console.error('[notifier] Job failed:', (err as Error).message)
    return { sent: 0, errors: 1, users: 0 }
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

export function startNotifierSchedule() {
  // Run daily at midnight (00:00) Europe/Rome timezone
  cron.schedule('0 0 * * *', () => {
    void runNotifierJob()
  }, { timezone: 'Europe/Rome' })

  console.log('   Notifier: scheduled daily @ 00:00 Europe/Rome')
}
