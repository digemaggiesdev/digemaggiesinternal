import 'dotenv/config'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { db } from './db.js'
import { createPasswordResetUrl, sendPasswordResetEmail, sendTaskAssignmentEmail } from './email.js'
import {
  accountDeleteSchema,
  accountPatchSchema,
  loginSchema,
  managementPartRequestPatchSchema,
  managementSponsorLeadPatchSchema,
  managementUserPatchSchema,
  partRequestPatchSchema,
  partRequestSchema,
  registerSchema,
  sponsorLeadPatchSchema,
  sponsorLeadSchema,
  subteamChangeRequestSchema,
  subteamChangeReviewSchema,
  sponsorshipPatchSchema,
  sponsorshipSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  recordActivitySchema,
} from './validation.js'

const scrypt = promisify(scryptCallback)
const app = express()
const sessionLifetime = 7 * 24 * 60 * 60 * 1000
const passwordResetLifetime = 30 * 60 * 1000
const isProduction = process.env.NODE_ENV === 'production'
const inviteCode = process.env.TEAM_INVITE_CODE || (isProduction ? '' : 'local-team-code')
const devInviteCode = process.env.DEV_INVITE_CODE || (isProduction ? '' : 'local-dev-code')

if (isProduction && !inviteCode) {
  throw new Error('TEAM_INVITE_CODE must be configured in production.')
}
if (devInviteCode && devInviteCode === inviteCode) {
  throw new Error('DEV_INVITE_CODE must be different from TEAM_INVITE_CODE.')
}

app.disable('x-powered-by')
app.use(express.json({ limit: '256kb' }))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
})
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again later.' },
})

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name, subteam: user.subteam || '', tag: user.tag || 'member', active: user.active !== 0 && user.active !== false }
}

function getCookie(req, name) {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : ''
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

async function passwordHash(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64)
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

async function passwordMatches(password, stored) {
  const [saltHex, derivedHex] = stored.split(':')
  if (!saltHex || !derivedHex) return false
  const expected = Buffer.from(derivedHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function matchesSecret(value, secret) {
  if (!secret) return false
  const valueBuffer = Buffer.from(value)
  const secretBuffer = Buffer.from(secret)
  return valueBuffer.length === secretBuffer.length && timingSafeEqual(valueBuffer, secretBuffer)
}

function issueSession(res, userId) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + sessionLifetime
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expiresAt)
  const secure = isProduction ? '; Secure' : ''
  res.setHeader('Set-Cookie', `Digem_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetime / 1000}${secure}`)
}

function requireAuth(req, res, next) {
  const token = getCookie(req, 'Digem_session')
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })

  const session = db.prepare(`
    SELECT users.id, users.email, users.display_name, users.subteam, users.tag, users.active
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
  `).get(tokenHash(token), Date.now())

  if (!session) return res.status(401).json({ error: 'Your session expired. Sign in again.' })
  req.user = publicUser(session)
  req.sessionTokenHash = tokenHash(token)
  next()
}

function requireDev(req, res, next) {
  if (!isDev(req.user)) return res.status(403).json({ error: 'Dev access is required.' })
  next()
}

function parseBody(schema, req, res) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Check the submitted fields.', details: parsed.error.flatten().fieldErrors })
    return null
  }
  return parsed.data
}

function createRecord(kind, data) {
  const now = new Date().toISOString()
  const record = {
    ...data,
    id: randomUUID(),
    createdAt: now.slice(0, 10),
    updatedAt: now,
    activity: [{ id: randomUUID(), type: 'update', actor: data.createdBy, body: 'Record created', createdAt: now }],
  }
  db.prepare('INSERT INTO records (id, kind, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(record.id, kind, JSON.stringify(record), now, now)
  return record
}

function listRecords(kind) {
  return db.prepare('SELECT data, updated_at FROM records WHERE kind = ? ORDER BY created_at DESC').all(kind).map((row) => {
    const record = JSON.parse(row.data)
    record.updatedAt = row.updated_at
    record.activity = Array.isArray(record.activity) ? record.activity : []
    if (kind === 'sponsorship') {
      record.deliverables = (record.deliverables || []).map((deliverable) => typeof deliverable === 'string'
        ? { description: deliverable, status: 'Not started' }
        : { ...deliverable, status: deliverable.status || 'Not started' })
    }
    return record
  })
}

function activityEntry(actor, body, type = 'update', createdAt = new Date().toISOString()) {
  return { id: randomUUID(), type, actor, body, createdAt }
}

function updateBody(changes) {
  const labels = {
    assigneeId: 'assignee',
    communication: 'communication status',
    nextFollowUpAt: 'next follow-up date',
    status: 'status',
  }
  const changedFields = Object.keys(changes).map((field) => labels[field] || field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`))
  return `Updated ${changedFields.join(', ')}`
}

function updateRecord(kind, id, changes, actor) {
  const row = db.prepare('SELECT data FROM records WHERE id = ? AND kind = ?').get(id, kind)
  if (!row) return null
  const previous = JSON.parse(row.data)
  const now = new Date().toISOString()
  const record = {
    ...previous,
    ...changes,
    updatedAt: now,
    activity: [...(Array.isArray(previous.activity) ? previous.activity : []), activityEntry(actor, updateBody(changes), 'update', now)].slice(-100),
  }
  db.prepare('UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND kind = ?')
    .run(JSON.stringify(record), now, id, kind)
  return record
}

function listSponsorLeads() {
  return db.prepare('SELECT data, updated_at FROM sponsor_leads ORDER BY created_at DESC').all().map((row) => {
    const record = JSON.parse(row.data)
    record.updatedAt = row.updated_at
    record.activity = Array.isArray(record.activity) ? record.activity : []
    return record
  })
}

function createSponsorLead(data) {
  const now = new Date().toISOString()
  const record = {
    ...data,
    id: randomUUID(),
    status: 'New',
    createdAt: now.slice(0, 10),
    updatedAt: now,
    activity: [activityEntry(data.createdBy, 'Record created', 'update', now)],
  }
  db.prepare('INSERT INTO sponsor_leads (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(record.id, JSON.stringify(record), now, now)
  return record
}

function updateSponsorLead(id, changes, actor) {
  const row = db.prepare('SELECT data FROM sponsor_leads WHERE id = ?').get(id)
  if (!row) return null
  const previous = JSON.parse(row.data)
  const now = new Date().toISOString()
  const record = {
    ...previous,
    ...changes,
    updatedAt: now,
    activity: [...(Array.isArray(previous.activity) ? previous.activity : []), activityEntry(actor, updateBody(changes), 'update', now)].slice(-100),
  }
  db.prepare('UPDATE sponsor_leads SET data = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(record), now, id)
  return record
}

function addRecordActivity(kind, id, actor, body) {
  const table = kind === 'sponsor_lead' ? 'sponsor_leads' : 'records'
  const query = table === 'records'
    ? db.prepare('SELECT data FROM records WHERE id = ? AND kind = ?').get(id, kind)
    : db.prepare('SELECT data FROM sponsor_leads WHERE id = ?').get(id)
  if (!query) return null
  const previous = JSON.parse(query.data)
  const now = new Date().toISOString()
  const record = {
    ...previous,
    updatedAt: now,
    activity: [...(Array.isArray(previous.activity) ? previous.activity : []), activityEntry(actor, body, 'note', now)].slice(-100),
  }
  if (table === 'records') {
    db.prepare('UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND kind = ?').run(JSON.stringify(record), now, id, kind)
  } else {
    db.prepare('UPDATE sponsor_leads SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(record), now, id)
  }
  return record
}

function canDelegate(user) {
  return user.subteam.trim().toLowerCase() === 'exec'
}

function isDev(user) {
  return user.tag === 'dev'
}

function canEditSharedRecords(user) {
  return isDev(user) || user.tag === 'stl'
}

function canReviewSubteamChanges(user) {
  return isDev(user) || canDelegate(user)
}

function validateAssignee(res, assigneeId, requesterSubteam) {
  if (!assigneeId) return true
  const assignee = db.prepare('SELECT subteam FROM users WHERE id = ? AND active = 1').get(assigneeId)
  const allowedSubteams = new Set(['business', requesterSubteam.trim().toLowerCase()])
  if (!assignee || !allowedSubteams.has(assignee.subteam.trim().toLowerCase())) {
    res.status(400).json({ error: 'Choose a member from the Business subteam or the requester’s subteam.' })
    return false
  }
  return true
}

function validateAssigneeSubteam(res, assigneeId, subteam) {
  if (!assigneeId) return true
  const assignee = db.prepare('SELECT subteam FROM users WHERE id = ? AND active = 1').get(assigneeId)
  if (!assignee || assignee.subteam.trim().toLowerCase() !== subteam.trim().toLowerCase()) {
    res.status(400).json({ error: 'Choose a member from your subteam.' })
    return false
  }
  return true
}

function authorizeAssignee(res, user, assigneeId, requesterSubteam, currentAssigneeId) {
  if (isDev(user)) {
    if (!assigneeId || db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(assigneeId)) return true
    res.status(400).json({ error: 'Choose an existing team member.' })
    return false
  }
  if (canDelegate(user)) {
    if (assigneeId === user.id) return true
    return validateAssignee(res, assigneeId, requesterSubteam)
  }
  if (user.tag === 'stl') return validateAssigneeSubteam(res, assigneeId, user.subteam)
  const subteam = user.subteam.trim().toLowerCase()
  if (assigneeId === user.id && (subteam === 'business' || subteam === requesterSubteam.trim().toLowerCase())) return true
  if (!assigneeId && currentAssigneeId === user.id) return true
  res.status(403).json({
    error: assigneeId === user.id
      ? 'Only Business members or members of the originating subteam can assign themselves.'
      : 'Only Exec members can assign a task to another person.',
  })
  return false
}

async function sendAssignmentNotification(res, actor, assigneeId, previousAssigneeId, taskType, taskTitle, nextFollowUpAt) {
  if (!assigneeId || assigneeId === previousAssigneeId || assigneeId === actor.id) return true
  const assignee = db.prepare('SELECT email, display_name FROM users WHERE id = ? AND active = 1').get(assigneeId)
  if (!assignee) {
    res.status(400).json({ error: 'Choose an active team member to assign this task.' })
    return false
  }
  try {
    await sendTaskAssignmentEmail({
      email: assignee.email,
      displayName: assignee.display_name,
      assignedBy: actor.displayName,
      taskType,
      taskTitle,
      nextFollowUpAt,
    })
    return true
  } catch (error) {
    console.error('Could not send task assignment email:', error)
    res.status(502).json({ error: 'Could not send the assignment email. The task was not changed; check email settings and try again.' })
    return false
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  const input = parseBody(registerSchema, req, res)
  if (!input) return
  const tag = 'member'
  if (input.inviteCode !== inviteCode) return res.status(403).json({ error: 'That team invite code is not valid.' })

  try {
    const id = randomUUID()
    const hash = await passwordHash(input.password)
    db.prepare('INSERT INTO users (id, email, display_name, subteam, tag, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.email, input.displayName, input.subteam, tag, hash, new Date().toISOString())
    issueSession(res, id)
    res.status(201).json({ user: { id, email: input.email, displayName: input.displayName, subteam: input.subteam, tag, active: true } })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' })
    next(error)
  }
})

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  const input = parseBody(loginSchema, req, res)
  if (!input) return

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND active = 1').get(input.email)
    if (!user || !(await passwordMatches(input.password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' })
    }
    issueSession(res, user.id)
    res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/password-reset', passwordResetLimiter, async (req, res, next) => {
  const input = parseBody(passwordResetSchema, req, res)
  if (!input) return
  try {
    const now = Date.now()
    const tokenHashValue = tokenHash(input.token)
    const passwordHashValue = await passwordHash(input.password)
    const resetPassword = db.transaction(() => {
      const reset = db.prepare('SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?')
        .get(tokenHashValue, now)
      if (!reset) return false
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHashValue, reset.user_id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id)
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(reset.user_id)
      return true
    })
    if (!resetPassword()) return res.status(400).json({ error: 'This password reset link is invalid or has expired.' })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/password-reset/request', passwordResetLimiter, async (req, res, next) => {
  const input = parseBody(passwordResetRequestSchema, req, res)
  if (!input) return
  try {
    const target = db.prepare('SELECT id, email, display_name FROM users WHERE email = ? COLLATE NOCASE').get(input.email)
    if (target) {
      const token = randomBytes(32).toString('base64url')
      const hashedToken = tokenHash(token)
      const expiresAt = Date.now() + passwordResetLifetime
      db.transaction(() => {
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(target.id)
        db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
          .run(hashedToken, target.id, expiresAt)
      })()
      try {
        const appUrl = process.env.APP_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`
        await sendPasswordResetEmail({
          email: target.email,
          displayName: target.display_name,
          resetUrl: createPasswordResetUrl(token, appUrl),
        })
      } catch (error) {
        console.error('Could not send password reset email:', error)
        db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(hashedToken)
      }
    }
    res.status(202).json({ message: 'If an account exists for that email, a password reset link has been sent.' })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash)
  res.setHeader('Set-Cookie', 'Digem_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
  res.status(204).end()
})

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }))

app.patch('/api/account', requireAuth, (req, res) => {
  const input = parseBody(accountPatchSchema, req, res)
  if (!input) return
  try {
    db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?')
      .run(input.displayName, input.email, req.user.id)
    const updated = db.prepare('SELECT id, email, display_name, subteam, tag, active FROM users WHERE id = ?').get(req.user.id)
    res.json({ user: publicUser(updated) })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' })
    throw error
  }
})

function getSubteamChangeRequest(id) {
  return db.prepare(`
    SELECT requests.id, requests.user_id AS userId, users.display_name AS requesterName,
      requests.current_subteam AS currentSubteam, requests.requested_subteam AS requestedSubteam,
      requests.status, reviewer.display_name AS reviewedBy, requests.created_at AS createdAt,
      requests.reviewed_at AS reviewedAt
    FROM subteam_change_requests AS requests
    JOIN users ON users.id = requests.user_id
    LEFT JOIN users AS reviewer ON reviewer.id = requests.reviewed_by
    WHERE requests.id = ?
  `).get(id)
}

app.get('/api/subteam-change-requests', requireAuth, (req, res) => {
  const exec = canReviewSubteamChanges(req.user)
  const requests = db.prepare(`
    SELECT requests.id, requests.user_id AS userId, users.display_name AS requesterName,
      requests.current_subteam AS currentSubteam, requests.requested_subteam AS requestedSubteam,
      requests.status, reviewer.display_name AS reviewedBy, requests.created_at AS createdAt,
      requests.reviewed_at AS reviewedAt
    FROM subteam_change_requests AS requests
    JOIN users ON users.id = requests.user_id
    LEFT JOIN users AS reviewer ON reviewer.id = requests.reviewed_by
    WHERE requests.user_id = ? OR (? = 1 AND requests.status = 'pending')
    ORDER BY requests.created_at DESC
  `).all(req.user.id, Number(exec))
  res.json({ requests })
})

app.post('/api/subteam-change-requests', requireAuth, (req, res) => {
  const input = parseBody(subteamChangeRequestSchema, req, res)
  if (!input) return
  if (input.subteam.trim().toLowerCase() === req.user.subteam.trim().toLowerCase()) {
    return res.status(400).json({ error: 'Choose a subteam different from your current one.' })
  }
  const id = randomUUID()
  const now = new Date().toISOString()
  try {
    db.prepare(`
      INSERT INTO subteam_change_requests
        (id, user_id, current_subteam, requested_subteam, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, req.user.id, req.user.subteam, input.subteam, now)
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'You already have a pending subteam change request.' })
    }
    throw error
  }
  res.status(201).json({ request: getSubteamChangeRequest(id) })
})

app.patch('/api/subteam-change-requests/:id', requireAuth, (req, res) => {
  const input = parseBody(subteamChangeReviewSchema, req, res)
  if (!input) return
  if (!canReviewSubteamChanges(req.user)) return res.status(403).json({ error: 'Only Exec members or Dev administrators can review subteam change requests.' })
  const request = db.prepare('SELECT user_id, requested_subteam, status FROM subteam_change_requests WHERE id = ?')
    .get(req.params.id)
  if (!request) return res.status(404).json({ error: 'Subteam change request not found.' })
  if (request.user_id === req.user.id) {
    return res.status(403).json({ error: 'You cannot review your own subteam change request.' })
  }
  if (request.status !== 'pending') return res.status(409).json({ error: 'This subteam change request has already been reviewed.' })

  const reviewedAt = new Date().toISOString()
  const reviewRequest = db.transaction(() => {
    const result = db.prepare(`
      UPDATE subteam_change_requests
      SET status = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(input.status, req.user.id, reviewedAt, req.params.id)
    if (!result.changes) return false
    if (input.status === 'approved') {
      db.prepare('UPDATE users SET subteam = ? WHERE id = ?').run(request.requested_subteam, request.user_id)
    }
    return true
  })
  if (!reviewRequest()) return res.status(409).json({ error: 'This subteam change request has already been reviewed.' })
  res.json({ request: getSubteamChangeRequest(req.params.id) })
})

app.delete('/api/subteam-change-requests/:id', requireAuth, (req, res) => {
  const result = db.prepare(`
    DELETE FROM subteam_change_requests
    WHERE id = ? AND user_id = ? AND status = 'pending'
  `).run(req.params.id, req.user.id)
  if (!result.changes) return res.status(404).json({ error: 'Pending subteam change request not found.' })
  res.status(204).end()
})

app.delete('/api/account', requireAuth, async (req, res, next) => {
  const input = parseBody(accountDeleteSchema, req, res)
  if (!input) return
  try {
    if (matchesSecret(input.password, devInviteCode)) {
      const promotedUser = db.prepare("UPDATE users SET tag = 'dev' WHERE id = ? RETURNING id, email, display_name, subteam, tag").get(req.user.id)
      return res.json({ user: publicUser(promotedUser) })
    }
    const account = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id)
    if (!account || !(await passwordMatches(input.password, account.password_hash))) {
      return res.status(401).json({ error: 'The password is incorrect.' })
    }
    const deleteAccountTransaction = db.transaction(() => {
      db.prepare("UPDATE records SET data = json_remove(data, '$.assigneeId'), updated_at = ? WHERE json_extract(data, '$.assigneeId') = ?")
        .run(new Date().toISOString(), req.user.id)
      db.prepare("UPDATE sponsor_leads SET data = json_remove(data, '$.assigneeId'), updated_at = ? WHERE json_extract(data, '$.assigneeId') = ?")
        .run(new Date().toISOString(), req.user.id)
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id)
    })
    deleteAccountTransaction()
    res.setHeader('Set-Cookie', 'Digem_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.get('/api/team-members', requireAuth, (_req, res) => {
  const members = db.prepare('SELECT id, display_name AS displayName, subteam, active = 1 AS active FROM users ORDER BY display_name').all()
    .map((member) => ({ ...member, active: Boolean(member.active) }))
  res.json({ members })
})

app.get('/api/management/users', requireAuth, requireDev, (_req, res) => {
  const users = db.prepare('SELECT id, email, display_name, subteam, tag, active FROM users ORDER BY active DESC, display_name').all()
    .map(publicUser)
  res.json({ users })
})

app.patch('/api/management/users/:id', requireAuth, requireDev, (req, res) => {
  const input = parseBody(managementUserPatchSchema, req, res)
  if (!input) return
  try {
    if (input.active === false && req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account.' })
    const updateManagedUser = db.transaction(() => {
      const result = db.prepare('UPDATE users SET display_name = ?, email = ?, subteam = ?, tag = COALESCE(?, tag), active = COALESCE(?, active) WHERE id = ?')
        .run(input.displayName, input.email, input.subteam, input.tag ?? null, input.active === undefined ? null : Number(input.active), req.params.id)
      if (!result.changes) return null
      if (input.active === false) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id)
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(req.params.id)
      }
      return db.prepare('SELECT id, email, display_name, subteam, tag, active FROM users WHERE id = ?').get(req.params.id)
    })
    const updated = updateManagedUser()
    if (!updated) return res.status(404).json({ error: 'Team member not found.' })
    res.json({ user: publicUser(updated) })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' })
    throw error
  }
})

app.post('/api/management/users/:id/password-reset', requireAuth, requireDev, passwordResetLimiter, async (req, res) => {
  const target = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'Team member not found.' })
  const token = randomBytes(32).toString('base64url')
  const hashedToken = tokenHash(token)
  const expiresAt = Date.now() + passwordResetLifetime
  db.transaction(() => {
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(req.params.id)
    db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashedToken, req.params.id, expiresAt)
  })()
  try {
    const appUrl = process.env.APP_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`
    const resetUrl = createPasswordResetUrl(token, appUrl)
    await sendPasswordResetEmail({
      email: target.email,
      displayName: target.display_name,
      resetUrl,
    })
    res.status(204).end()
  } catch (error) {
    console.error('Could not send password reset email:', error)
    db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(hashedToken)
    res.status(502).json({ error: 'Could not send the password reset email. Check email settings and try again.' })
  }
})

app.delete('/api/management/users/:id', requireAuth, requireDev, (req, res) => {
  if (req.params.id === req.user.id) return res.status(403).json({ error: 'You cannot delete your own account from management.' })
  const deleteManagedUser = db.transaction(() => {
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id)
    if (!target) return false
    const now = new Date().toISOString()
    db.prepare("UPDATE records SET data = json_remove(data, '$.assigneeId'), updated_at = ? WHERE json_extract(data, '$.assigneeId') = ?")
      .run(now, req.params.id)
    db.prepare("UPDATE sponsor_leads SET data = json_remove(data, '$.assigneeId'), updated_at = ? WHERE json_extract(data, '$.assigneeId') = ?")
      .run(now, req.params.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
    return true
  })
  if (!deleteManagedUser()) return res.status(404).json({ error: 'Team member not found.' })
  res.status(204).end()
})

app.patch('/api/management/requests/:id', requireAuth, requireDev, async (req, res) => {
  const input = parseBody(managementPartRequestPatchSchema, req, res)
  if (!input) return
  const existing = db.prepare('SELECT data FROM records WHERE id = ? AND kind = ?').get(req.params.id, 'part_request')
  if (!existing) return res.status(404).json({ error: 'Part request not found.' })
  const previous = JSON.parse(existing.data)
  if (Object.hasOwn(input, 'assigneeId')) {
    if (!authorizeAssignee(res, req.user, input.assigneeId, previous.requesterSubteam || '', previous.assigneeId)) return
    if (!await sendAssignmentNotification(res, req.user, input.assigneeId, previous.assigneeId, 'Part request', input.item || previous.item, input.nextFollowUpAt ?? previous.nextFollowUpAt)) return
  }
  const record = updateRecord('part_request', req.params.id, input, req.user.displayName)
  res.json({ record })
})

app.patch('/api/management/sponsorships/:id', requireAuth, requireDev, (req, res) => {
  const input = parseBody(sponsorshipPatchSchema, req, res)
  if (!input) return
  const record = updateRecord('sponsorship', req.params.id, input, req.user.displayName)
  if (!record) return res.status(404).json({ error: 'Sponsorship not found.' })
  res.json({ record })
})

app.patch('/api/management/sponsor-leads/:id', requireAuth, requireDev, async (req, res) => {
  const input = parseBody(managementSponsorLeadPatchSchema, req, res)
  if (!input) return
  const existing = db.prepare('SELECT data FROM sponsor_leads WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Sponsor lead not found.' })
  const previous = JSON.parse(existing.data)
  if (Object.hasOwn(input, 'assigneeId')) {
    if (!authorizeAssignee(res, req.user, input.assigneeId, previous.requesterSubteam || '', previous.assigneeId)) return
    if (!await sendAssignmentNotification(res, req.user, input.assigneeId, previous.assigneeId, 'Sponsor lead', input.company || previous.company, input.nextFollowUpAt ?? previous.nextFollowUpAt)) return
  }
  const record = updateSponsorLead(req.params.id, input, req.user.displayName)
  res.json({ record })
})

app.get('/api/requests', requireAuth, (_req, res) => res.json({ records: listRecords('part_request') }))
app.post('/api/requests', requireAuth, (req, res) => {
  const input = parseBody(partRequestSchema, req, res)
  if (!input) return
  const record = createRecord('part_request', { ...input, requesterSubteam: req.user.subteam, createdBy: req.user.displayName })
  res.status(201).json({ record })
})
app.patch('/api/requests/:id', requireAuth, async (req, res) => {
  const input = parseBody(partRequestPatchSchema, req, res)
  if (!input) return
  const followUpOnly = Object.keys(input).every((key) => key === 'nextFollowUpAt')
  if (!canEditSharedRecords(req.user) && !(canDelegate(req.user) && followUpOnly)) {
    return res.status(403).json({ error: 'STL or Dev access is required to edit shared records. Exec may update follow-up dates.' })
  }
  if (Object.hasOwn(input, 'assigneeId')) {
    const existing = db.prepare('SELECT data FROM records WHERE id = ? AND kind = ?').get(req.params.id, 'part_request')
    if (!existing) return res.status(404).json({ error: 'Part request not found.' })
    const record = JSON.parse(existing.data)
    if (!authorizeAssignee(res, req.user, input.assigneeId, record.requesterSubteam || record.subteam, record.assigneeId)) return
    if (!await sendAssignmentNotification(res, req.user, input.assigneeId, record.assigneeId, 'Part request', input.item || record.item, input.nextFollowUpAt ?? record.nextFollowUpAt)) return
  }
  const record = updateRecord('part_request', req.params.id, input, req.user.displayName)
  if (!record) return res.status(404).json({ error: 'Part request not found.' })
  res.json({ record })
})
app.post('/api/requests/:id/activity', requireAuth, (req, res) => {
  if (!canEditSharedRecords(req.user)) return res.status(403).json({ error: 'STL or Dev access is required to add record notes.' })
  const input = parseBody(recordActivitySchema, req, res)
  if (!input) return
  const record = addRecordActivity('part_request', req.params.id, req.user.displayName, input.body)
  if (!record) return res.status(404).json({ error: 'Part request not found.' })
  res.status(201).json({ record })
})
app.delete('/api/requests/:id', requireAuth, (req, res) => {
  if (!canEditSharedRecords(req.user)) return res.status(403).json({ error: 'STL or Dev access is required to delete shared records.' })
  const result = db.prepare('DELETE FROM records WHERE id = ? AND kind = ?').run(req.params.id, 'part_request')
  if (!result.changes) return res.status(404).json({ error: 'Part request not found.' })
  res.status(204).end()
})

app.get('/api/sponsorships', requireAuth, (_req, res) => res.json({ records: listRecords('sponsorship') }))
app.post('/api/sponsorships', requireAuth, (req, res) => {
  const input = parseBody(sponsorshipSchema, req, res)
  if (!input) return
  const record = createRecord('sponsorship', { ...input, createdBy: req.user.displayName })
  res.status(201).json({ record })
})
app.patch('/api/sponsorships/:id', requireAuth, (req, res) => {
  const input = parseBody(sponsorshipPatchSchema, req, res)
  if (!input) return
  const followUpOnly = Object.keys(input).every((key) => key === 'renewal')
  if (!canEditSharedRecords(req.user) && !(canDelegate(req.user) && followUpOnly)) {
    return res.status(403).json({ error: 'STL or Dev access is required to edit shared records. Exec may update renewal / follow-up dates.' })
  }
  const record = updateRecord('sponsorship', req.params.id, input, req.user.displayName)
  if (!record) return res.status(404).json({ error: 'Sponsorship not found.' })
  res.json({ record })
})
app.post('/api/sponsorships/:id/activity', requireAuth, (req, res) => {
  if (!canEditSharedRecords(req.user)) return res.status(403).json({ error: 'STL or Dev access is required to add record notes.' })
  const input = parseBody(recordActivitySchema, req, res)
  if (!input) return
  const record = addRecordActivity('sponsorship', req.params.id, req.user.displayName, input.body)
  if (!record) return res.status(404).json({ error: 'Sponsorship not found.' })
  res.status(201).json({ record })
})
app.delete('/api/sponsorships/:id', requireAuth, (req, res) => {
  if (!canEditSharedRecords(req.user)) return res.status(403).json({ error: 'STL or Dev access is required to delete shared records.' })
  const result = db.prepare('DELETE FROM records WHERE id = ? AND kind = ?').run(req.params.id, 'sponsorship')
  if (!result.changes) return res.status(404).json({ error: 'Sponsorship not found.' })
  res.status(204).end()
})

app.get('/api/sponsor-leads', requireAuth, (_req, res) => res.json({ records: listSponsorLeads() }))
app.post('/api/sponsor-leads', requireAuth, (req, res) => {
  const input = parseBody(sponsorLeadSchema, req, res)
  if (!input) return
  const record = createSponsorLead({ ...input, requesterSubteam: req.user.subteam, createdBy: req.user.displayName })
  res.status(201).json({ record })
})
app.patch('/api/sponsor-leads/:id', requireAuth, async (req, res) => {
  const input = parseBody(sponsorLeadPatchSchema, req, res)
  if (!input) return
  const followUpOnly = Object.keys(input).every((key) => key === 'nextFollowUpAt')
  if (!canEditSharedRecords(req.user) && !(canDelegate(req.user) && followUpOnly)) {
    return res.status(403).json({ error: 'STL or Dev access is required to edit shared records. Exec may update follow-up dates.' })
  }
  if (Object.hasOwn(input, 'assigneeId')) {
    const existing = db.prepare('SELECT data FROM sponsor_leads WHERE id = ?').get(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Sponsor lead not found.' })
    const record = JSON.parse(existing.data)
    if (!authorizeAssignee(res, req.user, input.assigneeId, record.requesterSubteam || record.subteam || '', record.assigneeId)) return
    if (!await sendAssignmentNotification(res, req.user, input.assigneeId, record.assigneeId, 'Sponsor lead', input.company || record.company, input.nextFollowUpAt ?? record.nextFollowUpAt)) return
  }
  const record = updateSponsorLead(req.params.id, input, req.user.displayName)
  if (!record) return res.status(404).json({ error: 'Sponsor lead not found.' })
  res.json({ record })
})
app.post('/api/sponsor-leads/:id/activity', requireAuth, (req, res) => {
  if (!canEditSharedRecords(req.user)) return res.status(403).json({ error: 'STL or Dev access is required to add record notes.' })
  const input = parseBody(recordActivitySchema, req, res)
  if (!input) return
  const record = addRecordActivity('sponsor_lead', req.params.id, req.user.displayName, input.body)
  if (!record) return res.status(404).json({ error: 'Sponsor lead not found.' })
  res.status(201).json({ record })
})
app.delete('/api/sponsor-leads/:id', requireAuth, (req, res) => {
  if (!canEditSharedRecords(req.user)) return res.status(403).json({ error: 'STL or Dev access is required to delete shared records.' })
  const result = db.prepare('DELETE FROM sponsor_leads WHERE id = ?').run(req.params.id)
  if (!result.changes) return res.status(404).json({ error: 'Sponsor lead not found.' })
  res.status(204).end()
})

app.use(express.static(resolve('dist')))
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
  res.sendFile(resolve('dist/index.html'), (error) => error && next(error))
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: 'A server error occurred.' })
})

const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1')
app.listen(port, host, () => console.log(`Digem API listening on http://${host}:${port}`))