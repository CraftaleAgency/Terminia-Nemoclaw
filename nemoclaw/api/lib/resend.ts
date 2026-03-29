import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'info@craftale.it'
export const FROM_NAME = process.env.RESEND_NAME || 'Terminia'

interface SendEmailParams {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailParams) {
  const { data, error } = await resend.emails.send({
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

export default resend
