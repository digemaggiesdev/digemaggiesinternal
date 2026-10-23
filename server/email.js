function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function createPasswordResetUrl(token, appUrl) {
  const resetUrl = new URL('/', appUrl)
  if (!['http:', 'https:'].includes(resetUrl.protocol)) throw new Error('APP_URL must use HTTP or HTTPS.')
  resetUrl.hash = new URLSearchParams({ reset: token }).toString()
  return resetUrl.toString()
}

export async function sendPasswordResetEmail({ email, displayName, resetUrl, environment = process.env }) {
  const apiKey = environment.RESEND_API_KEY
  const from = environment.RESEND_FROM
  if (!apiKey || !from) throw new Error('RESEND_API_KEY and RESEND_FROM must be configured to send password reset emails.')

  const response = await fetch(environment.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your Digem team workspace password',
      text: `Hi ${displayName},\n\nA Dev administrator requested a password reset for your Digem team workspace account. Use this one-time link within 30 minutes to choose a new password:\n\n${resetUrl}\n\nIf you did not expect this email, you can ignore it.`,
      html: `<p>Hi ${escapeHtml(displayName)},</p><p>A Dev administrator requested a password reset for your Digem team workspace account. Use this one-time link within 30 minutes to choose a new password:</p><p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p><p>If you did not expect this email, you can ignore it.</p>`,
    }),
  })

  if (!response.ok) throw new Error(`Resend email request failed with status ${response.status}.`)
}

export async function sendTaskAssignmentEmail({ email, displayName, assignedBy, taskType, taskTitle, nextFollowUpAt, environment = process.env }) {
  const apiKey = environment.RESEND_API_KEY
  const from = environment.RESEND_FROM
  if (!apiKey || !from) throw new Error('RESEND_API_KEY and RESEND_FROM must be configured to send assignment emails.')

  const followUpDate = nextFollowUpAt || 'Not set'
  const response = await fetch(environment.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `You're assigned: ${taskTitle}`,
      text: `Hi ${displayName},\n\n${assignedBy} assigned you a ${taskType.toLowerCase()} task:\n${taskTitle}\n\nNext follow-up date: ${followUpDate}\n\nOpen the Digem team workspace to review the task.`,
      html: `<p>Hi ${escapeHtml(displayName)},</p><p>${escapeHtml(assignedBy)} assigned you a ${escapeHtml(taskType.toLowerCase())} task:</p><p><strong>${escapeHtml(taskTitle)}</strong></p><p><strong>Next follow-up date:</strong> ${escapeHtml(followUpDate)}</p><p>Open the Digem team workspace to review the task.</p>`,
    }),
  })

  if (!response.ok) throw new Error(`Resend email request failed with status ${response.status}.`)
}
