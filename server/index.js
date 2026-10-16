import 'dotenv/config'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { db } from './db.js'
import {
  loginSchema,
  partRequestPatchSchema,
  partRequestSchema,
  registerSchema,
  sponsorLeadPatchSchema,
  sponsorLeadSchema,
  sponsorshipPatchSchema,
  sponsorshipSchema,
} from './validation.js'

const scrypt = promisify(scryptCallback)
const app = express()
const sessionLifetime = 7 * 24 * 60 * 60 * 1000
const isProduction = process.env.NODE_ENV === 'production'
const inviteCode = process.env.TEAM_INVITE_CODE || (isProduction ? '' : 'digem-dev-invite')

if (isProduction && !inviteCode) {
  throw new Error('TEAM_INVITE_CODE must be configured in production.')
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

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name, subteam: user.subteam || '' }
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

function issueSession(res, userId) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + sessionLifetime
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expiresAt)
  const secure = isProduction ? '; Secure' : ''
  res.setHeader('Set-Cookie', `digem_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetime / 1000}${secure}`)
}

function requireAuth(req, res, next) {
  const token = getCookie(req, 'digem_session')
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })

  const session = db.prepare(`
    SELECT users.id, users.email, users.display_name, users.subteam
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(token), Date.now())

  if (!session) return res.status(401).json({ error: 'Your session expired. Sign in again.' })
  req.user = publicUser(session)
  req.sessionTokenHash = tokenHash(token)
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
  const record = { ...data, id: randomUUID(), createdAt: now.slice(0, 10) }
  db.prepare('INSERT INTO records (id, kind, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(record.id, kind, JSON.stringify(record), now, now)
  return record
}

function listRecords(kind) {
  return db.prepare('SELECT data FROM records WHERE kind = ? ORDER BY created_at DESC').all(kind).map((row) => JSON.parse(row.data))
}

function updateRecord(kind, id, changes) {
  const row = db.prepare('SELECT data FROM records WHERE id = ? AND kind = ?').get(id, kind)
  if (!row) return null
  const record = { ...JSON.parse(row.data), ...changes }
  db.prepare('UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND kind = ?')
    .run(JSON.stringify(record), new Date().toISOString(), id, kind)
  return record
}

function listSponsorLeads() {
  return db.prepare('SELECT data FROM sponsor_leads ORDER BY created_at DESC').all().map((row) => JSON.parse(row.data))
}

function createSponsorLead(data) {
  const now = new Date().toISOString()
  const record = { ...data, id: randomUUID(), status: 'New', createdAt: now.slice(0, 10) }
  db.prepare('INSERT INTO sponsor_leads (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(record.id, JSON.stringify(record), now, now)
  return record
}

function updateSponsorLead(id, changes) {
  const row = db.prepare('SELECT data FROM sponsor_leads WHERE id = ?').get(id)
  if (!row) return null
  const record = { ...JSON.parse(row.data), ...changes }
  db.prepare('UPDATE sponsor_leads SET data = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(record), new Date().toISOString(), id)
  return record
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  const input = parseBody(registerSchema, req, res)
  if (!input) return
  if (input.inviteCode !== inviteCode) return res.status(403).json({ error: 'That team invite code is not valid.' })

  try {
    const id = randomUUID()
    const hash = await passwordHash(input.password)
    db.prepare('INSERT INTO users (id, email, display_name, subteam, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.email, input.displayName, input.subteam, hash, new Date().toISOString())
    issueSession(res, id)
    res.status(201).json({ user: { id, email: input.email, displayName: input.displayName, subteam: input.subteam } })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' })
    next(error)
  }
})

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  const input = parseBody(loginSchema, req, res)
  if (!input) return

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(input.email)
    if (!user || !(await passwordMatches(input.password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' })
    }
    issueSession(res, user.id)
    res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash)
  res.setHeader('Set-Cookie', 'digem_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
  res.status(204).end()
})

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }))

app.get('/api/requests', requireAuth, (_req, res) => res.json({ records: listRecords('part_request') }))
app.post('/api/requests', requireAuth, (req, res) => {
  const input = parseBody(partRequestSchema, req, res)
  if (!input) return
  const record = createRecord('part_request', { ...input, createdBy: req.user.displayName })
  res.status(201).json({ record })
})
app.patch('/api/requests/:id', requireAuth, (req, res) => {
  const input = parseBody(partRequestPatchSchema, req, res)
  if (!input) return
  const record = updateRecord('part_request', req.params.id, input)
  if (!record) return res.status(404).json({ error: 'Part request not found.' })
  res.json({ record })
})
app.delete('/api/requests/:id', requireAuth, (req, res) => {
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
  const record = updateRecord('sponsorship', req.params.id, input)
  if (!record) return res.status(404).json({ error: 'Sponsorship not found.' })
  res.json({ record })
})

app.get('/api/sponsor-leads', requireAuth, (_req, res) => res.json({ records: listSponsorLeads() }))
app.post('/api/sponsor-leads', requireAuth, (req, res) => {
  const input = parseBody(sponsorLeadSchema, req, res)
  if (!input) return
  const record = createSponsorLead({ ...input, createdBy: req.user.displayName })
  res.status(201).json({ record })
})
app.patch('/api/sponsor-leads/:id', requireAuth, (req, res) => {
  const input = parseBody(sponsorLeadPatchSchema, req, res)
  if (!input) return
  const record = updateSponsorLead(req.params.id, input)
  if (!record) return res.status(404).json({ error: 'Sponsor lead not found.' })
  res.json({ record })
})
app.delete('/api/sponsor-leads/:id', requireAuth, (req, res) => {
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
app.listen(port, host, () => console.log(`DiGem API listening on http://${host}:${port}`))