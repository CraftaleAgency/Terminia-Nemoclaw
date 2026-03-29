import { Resend } from 'resend'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) {
      throw new Error('[resend] RESEND_API_KEY is not set — email sending disabled')
    }
    _resend = new Resend(key)
  }
  return _resend
}

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'info@craftale.it'
export const FROM_NAME = process.env.RESEND_NAME || 'Terminia'

interface SendEmailParams {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailParams) {
  const client = getResend()
  const { data, error } = await client.emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject,
    html,
  })

  if (error) {
    console.error('[resend] Send failed:', error.message)
    throw new Error(error.message)
  }

  return data
}
