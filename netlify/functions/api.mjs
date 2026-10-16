import { getDatabase } from '@netlify/database'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import {
  loginSchema,
  partRequestPatchSchema,
  partRequestSchema,
  registerSchema,
  sponsorLeadPatchSchema,
  sponsorLeadSchema,
  sponsorshipPatchSchema,
  sponsorshipSchema,
} from '../../server/validation.js'

const scrypt = promisify(scryptCallback)
const sessionLifetime = 7 * 24 * 60 * 60 * 1000
const authWindow = 15 * 60 * 1000
const authAttemptLimit = 20
const cookieName = 'digem_session'

function jsonError(error, status, details) {
  return Response.json({ error, ...(details ? { details } : {}) }, { status })
}

function parseCookies(request) {
  return new Map((request.headers.get('cookie') || '').split(';').map((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return ['', '']
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]
  }))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
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

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name, subteam: user.subteam || '' }
}

function setSessionCookie(request, token, maxAge = sessionLifetime / 1000) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

async function parseBody(request, schema) {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > 256 * 1024) return { response: jsonError('Request body is too large.', 413) }

  let body
  try {
    body = await request.json()
  } catch {
    return { response: jsonError('A valid JSON request body is required.', 400) }
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return { response: jsonError('Check the submitted fields.', 400, parsed.error.flatten().fieldErrors) }
  }
  return { data: parsed.data }
}

async function consumeAuthAttempt(database, request, path) {
  const forwardedIp = request.headers.get('x-nf-client-connection-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || 'unknown'
  const bucket = sha256(`${path}:${forwardedIp}`)
  const windowStart = Math.floor(Date.now() / authWindow) * authWindow

  await database.sql`DELETE FROM auth_attempts WHERE window_start < ${windowStart - authWindow}`
  const [entry] = await database.sql`
    INSERT INTO auth_attempts (bucket_key, window_start, attempts)
    VALUES (${bucket}, ${windowStart}, 1)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET attempts = auth_attempts.attempts + 1
    RETURNING attempts
  `
  return entry.attempts <= authAttemptLimit
}

async function findSession(database, request) {
  const token = parseCookies(request).get(cookieName)
  if (!token) return null

  const tokenHash = sha256(token)
  const [row] = await database.sql`
    SELECT users.id, users.email, users.display_name, users.subteam
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${tokenHash} AND sessions.expires_at > ${Date.now()}
  `
  return row ? { user: publicUser(row), tokenHash } : null
}

async function listRecords(database, kind) {
  const rows = await database.sql`
    SELECT data FROM records WHERE kind = ${kind} ORDER BY created_at DESC
  `
  return rows.map((row) => row.data)
}

async function createRecord(database, kind, data) {
  const now = new Date().toISOString()
  const record = { ...data, id: randomUUID(), createdAt: now.slice(0, 10) }
  await database.sql`
    INSERT INTO records (id, kind, data, created_at, updated_at)
    VALUES (${record.id}, ${kind}, ${JSON.stringify(record)}::jsonb, ${now}, ${now})
  `
  return record
}

async function updateRecord(database, kind, id, changes) {
  const [row] = await database.sql`SELECT data FROM records WHERE id = ${id} AND kind = ${kind}`
  if (!row) return null
  const record = { ...row.data, ...changes }
  await database.sql`
    UPDATE records SET data = ${JSON.stringify(record)}::jsonb, updated_at = ${new Date().toISOString()}
    WHERE id = ${id} AND kind = ${kind}
  `
  return record
}

async function listSponsorLeads(database) {
  const rows = await database.sql`SELECT data FROM sponsor_leads ORDER BY created_at DESC`
  return rows.map((row) => row.data)
}

async function createSponsorLead(database, data) {
  const now = new Date().toISOString()
  const record = { ...data, id: randomUUID(), status: 'New', createdAt: now.slice(0, 10) }
  await database.sql`
    INSERT INTO sponsor_leads (id, data, created_at, updated_at)
    VALUES (${record.id}, ${JSON.stringify(record)}::jsonb, ${now}, ${now})
  `
  return record
}

async function updateSponsorLead(database, id, changes) {
  const [row] = await database.sql`SELECT data FROM sponsor_leads WHERE id = ${id}`
  if (!row) return null
  const record = { ...row.data, ...changes }
  await database.sql`
    UPDATE sponsor_leads SET data = ${JSON.stringify(record)}::jsonb, updated_at = ${new Date().toISOString()}
    WHERE id = ${id}
  `
  return record
}

function getRouteId(path, prefix) {
  if (!path.startsWith(prefix)) return null
  const remainder = path.slice(prefix.length)
  if (!remainder || remainder.includes('/')) return null
  try {
    return decodeURIComponent(remainder)
  } catch {
    return null
  }
}

export function createApiHandler(database, environment = process.env) {
  return async function handleApiRequest(request) {
    const { method } = request
    const { pathname } = new URL(request.url)

    if (!pathname.startsWith('/api/')) return jsonError('Not found.', 404)
    if (method === 'OPTIONS') return new Response(null, { status: 204 })

    try {
      if (method === 'GET' && pathname === '/api/health') {
        await database.sql`SELECT 1`
        return Response.json({ status: 'ok' })
      }

      if (method === 'POST' && (pathname === '/api/auth/register' || pathname === '/api/auth/login')) {
        const parsed = await parseBody(request, pathname.endsWith('/register') ? registerSchema : loginSchema)
        if (parsed.response) return parsed.response
        if (!(await consumeAuthAttempt(database, request, pathname))) {
          return jsonError('Too many sign-in attempts. Try again in a few minutes.', 429)
        }

        if (pathname === '/api/auth/register') {
          const input = parsed.data
          if (!environment.TEAM_INVITE_CODE || input.inviteCode !== environment.TEAM_INVITE_CODE) {
            return jsonError('That team invite code is not valid.', 403)
          }

          const id = randomUUID()
          const hash = await passwordHash(input.password)
          const token = randomBytes(32).toString('base64url')
          const createdAt = new Date().toISOString()
          const expiresAt = Date.now() + sessionLifetime
          const client = await database.pool.connect()
          try {
            await client.query('BEGIN')
            const result = await client.query(
              'INSERT INTO users (id, email, display_name, subteam, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, display_name, subteam',
              [id, input.email, input.displayName, input.subteam, hash, createdAt],
            )
            await client.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), id, expiresAt])
            await client.query('COMMIT')
            return Response.json({ user: publicUser(result.rows[0]) }, {
              status: 201,
              headers: { 'Set-Cookie': setSessionCookie(request, token) },
            })
          } catch (error) {
            await client.query('ROLLBACK')
            if (error.code === '23505') return jsonError('An account with that email already exists.', 409)
            throw error
          } finally {
            client.release()
          }
        }

        const input = parsed.data
        const [user] = await database.sql`SELECT * FROM users WHERE email = ${input.email}`
        if (!user || !(await passwordMatches(input.password, user.password_hash))) {
          return jsonError('Email or password is incorrect.', 401)
        }
        const token = randomBytes(32).toString('base64url')
        await database.sql`
          INSERT INTO sessions (token_hash, user_id, expires_at)
          VALUES (${sha256(token)}, ${user.id}, ${Date.now() + sessionLifetime})
        `
        return Response.json({ user: publicUser(user) }, { headers: { 'Set-Cookie': setSessionCookie(request, token) } })
      }

      const session = await findSession(database, request)
      if (!session) return jsonError('Sign in to continue.', 401)

      if (method === 'GET' && pathname === '/api/auth/me') return Response.json({ user: session.user })
      if (method === 'POST' && pathname === '/api/auth/logout') {
        await database.sql`DELETE FROM sessions WHERE token_hash = ${session.tokenHash}`
        return new Response(null, { status: 204, headers: { 'Set-Cookie': setSessionCookie(request, '', 0) } })
      }

      if (pathname === '/api/requests' && method === 'GET') {
        return Response.json({ records: await listRecords(database, 'part_request') })
      }
      if (pathname === '/api/requests' && method === 'POST') {
        const parsed = await parseBody(request, partRequestSchema)
        if (parsed.response) return parsed.response
        const record = await createRecord(database, 'part_request', { ...parsed.data, createdBy: session.user.displayName })
        return Response.json({ record }, { status: 201 })
      }

      const requestId = getRouteId(pathname, '/api/requests/')
      if (requestId && method === 'PATCH') {
        const parsed = await parseBody(request, partRequestPatchSchema)
        if (parsed.response) return parsed.response
        const record = await updateRecord(database, 'part_request', requestId, parsed.data)
        return record ? Response.json({ record }) : jsonError('Part request not found.', 404)
      }
      if (requestId && method === 'DELETE') {
        const deleted = await database.sql`DELETE FROM records WHERE id = ${requestId} AND kind = 'part_request' RETURNING id`
        return deleted.length ? new Response(null, { status: 204 }) : jsonError('Part request not found.', 404)
      }

      if (pathname === '/api/sponsorships' && method === 'GET') {
        return Response.json({ records: await listRecords(database, 'sponsorship') })
      }
      if (pathname === '/api/sponsorships' && method === 'POST') {
        const parsed = await parseBody(request, sponsorshipSchema)
        if (parsed.response) return parsed.response
        const record = await createRecord(database, 'sponsorship', { ...parsed.data, createdBy: session.user.displayName })
        return Response.json({ record }, { status: 201 })
      }

      const sponsorshipId = getRouteId(pathname, '/api/sponsorships/')
      if (sponsorshipId && method === 'PATCH') {
        const parsed = await parseBody(request, sponsorshipPatchSchema)
        if (parsed.response) return parsed.response
        const record = await updateRecord(database, 'sponsorship', sponsorshipId, parsed.data)
        return record ? Response.json({ record }) : jsonError('Sponsorship not found.', 404)
      }

      if (pathname === '/api/sponsor-leads' && method === 'GET') {
        return Response.json({ records: await listSponsorLeads(database) })
      }
      if (pathname === '/api/sponsor-leads' && method === 'POST') {
        const parsed = await parseBody(request, sponsorLeadSchema)
        if (parsed.response) return parsed.response
        const record = await createSponsorLead(database, { ...parsed.data, createdBy: session.user.displayName })
        return Response.json({ record }, { status: 201 })
      }

      const sponsorLeadId = getRouteId(pathname, '/api/sponsor-leads/')
      if (sponsorLeadId && method === 'PATCH') {
        const parsed = await parseBody(request, sponsorLeadPatchSchema)
        if (parsed.response) return parsed.response
        const record = await updateSponsorLead(database, sponsorLeadId, parsed.data)
        return record ? Response.json({ record }) : jsonError('Sponsor lead not found.', 404)
      }
      if (sponsorLeadId && method === 'DELETE') {
        const deleted = await database.sql`DELETE FROM sponsor_leads WHERE id = ${sponsorLeadId} RETURNING id`
        return deleted.length ? new Response(null, { status: 204 }) : jsonError('Sponsor lead not found.', 404)
      }

      return jsonError('Not found.', 404)
    } catch (error) {
      console.error('Netlify API function error:', error)
      return jsonError('A server error occurred.', 500)
    }
  }
}

export default async function handler(request) {
  return createApiHandler(getDatabase())(request)
}

export const config = {
  path: '/api/*',
}
