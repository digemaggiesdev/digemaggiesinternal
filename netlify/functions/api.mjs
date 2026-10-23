import { getDatabase } from '@netlify/database'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { createPasswordResetUrl, sendPasswordResetEmail, sendTaskAssignmentEmail } from '../../server/email.js'
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
} from '../../server/validation.js'

const scrypt = promisify(scryptCallback)
const sessionLifetime = 7 * 24 * 60 * 60 * 1000
const passwordResetLifetime = 30 * 60 * 1000
const authWindow = 15 * 60 * 1000
const authAttemptLimit = 20
const cookieName = 'Digem_session'

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

function matchesSecret(value, secret) {
  if (!secret) return false
  const valueBuffer = Buffer.from(value)
  const secretBuffer = Buffer.from(secret)
  return valueBuffer.length === secretBuffer.length && timingSafeEqual(valueBuffer, secretBuffer)
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name, subteam: user.subteam || '', tag: user.tag || 'member', active: user.active !== false && user.active !== 0 }
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
    SELECT users.id, users.email, users.display_name, users.subteam, users.tag, users.active
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${tokenHash} AND sessions.expires_at > ${Date.now()} AND users.active = TRUE
  `
  return row ? { user: publicUser(row), tokenHash } : null
}

async function listRecords(database, kind) {
  const rows = await database.sql`
    SELECT data, updated_at FROM records WHERE kind = ${kind} ORDER BY created_at DESC
  `
  return rows.map((row) => {
    const record = row.data
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

async function createRecord(database, kind, data) {
  const now = new Date().toISOString()
  const record = {
    ...data,
    id: randomUUID(),
    createdAt: now.slice(0, 10),
    updatedAt: now,
    activity: [{ id: randomUUID(), type: 'update', actor: data.createdBy, body: 'Record created', createdAt: now }],
  }
  await database.sql`
    INSERT INTO records (id, kind, data, created_at, updated_at)
    VALUES (${record.id}, ${kind}, ${JSON.stringify(record)}::jsonb, ${now}, ${now})
  `
  return record
}

function updateBody(changes) {
  const labels = { assigneeId: 'assignee', communication: 'communication status', nextFollowUpAt: 'next follow-up date', status: 'status' }
  return `Updated ${Object.keys(changes).map((field) => labels[field] || field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)).join(', ')}`
}

async function updateRecord(database, kind, id, changes, actor) {
  const [row] = await database.sql`SELECT data FROM records WHERE id = ${id} AND kind = ${kind}`
  if (!row) return null
  const now = new Date().toISOString()
  const record = {
    ...row.data,
    ...changes,
    updatedAt: now,
    activity: [...(Array.isArray(row.data.activity) ? row.data.activity : []), { id: randomUUID(), type: 'update', actor, body: updateBody(changes), createdAt: now }].slice(-100),
  }
  await database.sql`
    UPDATE records SET data = ${JSON.stringify(record)}::jsonb, updated_at = ${now}
    WHERE id = ${id} AND kind = ${kind}
  `
  return record
}

async function listSponsorLeads(database) {
  const rows = await database.sql`SELECT data, updated_at FROM sponsor_leads ORDER BY created_at DESC`
  return rows.map((row) => ({ ...row.data, updatedAt: row.updated_at, activity: Array.isArray(row.data.activity) ? row.data.activity : [] }))
}

async function createSponsorLead(database, data) {
  const now = new Date().toISOString()
  const record = {
    ...data,
    id: randomUUID(),
    status: 'New',
    createdAt: now.slice(0, 10),
    updatedAt: now,
    activity: [{ id: randomUUID(), type: 'update', actor: data.createdBy, body: 'Record created', createdAt: now }],
  }
  await database.sql`
    INSERT INTO sponsor_leads (id, data, created_at, updated_at)
    VALUES (${record.id}, ${JSON.stringify(record)}::jsonb, ${now}, ${now})
  `
  return record
}

async function updateSponsorLead(database, id, changes, actor) {
  const [row] = await database.sql`SELECT data FROM sponsor_leads WHERE id = ${id}`
  if (!row) return null
  const now = new Date().toISOString()
  const record = {
    ...row.data,
    ...changes,
    updatedAt: now,
    activity: [...(Array.isArray(row.data.activity) ? row.data.activity : []), { id: randomUUID(), type: 'update', actor, body: updateBody(changes), createdAt: now }].slice(-100),
  }
  await database.sql`
    UPDATE sponsor_leads SET data = ${JSON.stringify(record)}::jsonb, updated_at = ${now}
    WHERE id = ${id}
  `
  return record
}

async function addRecordActivity(database, kind, id, actor, body) {
  const isLead = kind === 'sponsor_lead'
  const [row] = isLead
    ? await database.sql`SELECT data FROM sponsor_leads WHERE id = ${id}`
    : await database.sql`SELECT data FROM records WHERE id = ${id} AND kind = ${kind}`
  if (!row) return null
  const now = new Date().toISOString()
  const record = {
    ...row.data,
    updatedAt: now,
    activity: [...(Array.isArray(row.data.activity) ? row.data.activity : []), { id: randomUUID(), type: 'note', actor, body, createdAt: now }].slice(-100),
  }
  if (isLead) {
    await database.sql`UPDATE sponsor_leads SET data = ${JSON.stringify(record)}::jsonb, updated_at = ${now} WHERE id = ${id}`
  } else {
    await database.sql`UPDATE records SET data = ${JSON.stringify(record)}::jsonb, updated_at = ${now} WHERE id = ${id} AND kind = ${kind}`
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

async function isEligibleAssignee(database, assigneeId, requesterSubteam) {
  if (!assigneeId) return true
  const [member] = await database.sql`SELECT subteam FROM users WHERE id = ${assigneeId} AND active = TRUE`
  const allowedSubteams = new Set(['business', requesterSubteam.trim().toLowerCase()])
  return Boolean(member && allowedSubteams.has(member.subteam.trim().toLowerCase()))
}

async function isInSubteam(database, assigneeId, subteam) {
  if (!assigneeId) return true
  const [member] = await database.sql`SELECT subteam FROM users WHERE id = ${assigneeId} AND active = TRUE`
  return Boolean(member && member.subteam.trim().toLowerCase() === subteam.trim().toLowerCase())
}

async function assigneeAuthorizationError(database, user, assigneeId, requesterSubteam, currentAssigneeId) {
  if (isDev(user)) {
    if (!assigneeId) return null
    const [member] = await database.sql`SELECT id FROM users WHERE id = ${assigneeId} AND active = TRUE`
    return member ? null : { error: 'Choose an existing team member.', status: 400 }
  }
  if (canDelegate(user)) {
    if (assigneeId === user.id) return null
    return await isEligibleAssignee(database, assigneeId, requesterSubteam)
      ? null
      : { error: 'Choose a member from the Business subteam or the requester’s subteam.', status: 400 }
  }
  if (user.tag === 'stl') {
    return await isInSubteam(database, assigneeId, user.subteam)
      ? null
      : { error: 'Choose a member from your subteam.', status: 400 }
  }
  if (assigneeId === user.id) {
    return await isEligibleAssignee(database, user.id, requesterSubteam)
      ? null
      : { error: 'Only Business members or members of the originating subteam can assign themselves.', status: 403 }
  }
  if (!assigneeId && currentAssigneeId === user.id) return null
  return { error: 'Only Exec members can assign a task to another person.', status: 403 }
}

async function sendAssignmentNotification(database, environment, actor, assigneeId, previousAssigneeId, taskType, taskTitle, nextFollowUpAt) {
  if (!assigneeId || assigneeId === previousAssigneeId || assigneeId === actor.id) return null
  const [assignee] = await database.sql`SELECT email, display_name FROM users WHERE id = ${assigneeId} AND active = TRUE`
  if (!assignee) return jsonError('Choose an active team member to assign this task.', 400)
  try {
    await sendTaskAssignmentEmail({
      email: assignee.email,
      displayName: assignee.display_name,
      assignedBy: actor.displayName,
      taskType,
      taskTitle,
      nextFollowUpAt,
      environment,
    })
    return null
  } catch (error) {
    console.error('Could not send task assignment email:', error)
    return jsonError('Could not send the assignment email. The task was not changed; check email settings and try again.', 502)
  }
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
  const devInviteCode = environment.DEV_INVITE_CODE || ''
  if (devInviteCode && environment.TEAM_INVITE_CODE && devInviteCode === environment.TEAM_INVITE_CODE) {
    throw new Error('DEV_INVITE_CODE must be different from TEAM_INVITE_CODE.')
  }

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
          const tag = 'member'
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
              'INSERT INTO users (id, email, display_name, subteam, tag, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, display_name, subteam, tag, active',
              [id, input.email, input.displayName, input.subteam, tag, hash, createdAt],
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
        const [user] = await database.sql`SELECT * FROM users WHERE email = ${input.email} AND active = TRUE`
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

      if (method === 'POST' && pathname === '/api/auth/password-reset') {
        if (!(await consumeAuthAttempt(database, request, pathname))) {
          return jsonError('Too many password reset attempts. Try again later.', 429)
        }
        const parsed = await parseBody(request, passwordResetSchema)
        if (parsed.response) return parsed.response
        const hashedToken = sha256(parsed.data.token)
        const hashedPassword = await passwordHash(parsed.data.password)
        const client = await database.pool.connect()
        let didReset = false
        try {
          await client.query('BEGIN')
          const reset = await client.query(
            'SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > $2 FOR UPDATE',
            [hashedToken, Date.now()],
          )
          if (reset.rowCount) {
            const userId = reset.rows[0].user_id
            await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId])
            await client.query('DELETE FROM sessions WHERE user_id = $1', [userId])
            await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId])
            didReset = true
          }
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
        return didReset
          ? new Response(null, { status: 204 })
          : jsonError('This password reset link is invalid or has expired.', 400)
      }

      if (method === 'POST' && pathname === '/api/auth/password-reset/request') {
        if (!(await consumeAuthAttempt(database, request, pathname))) {
          return jsonError('Too many password reset attempts. Try again later.', 429)
        }
        const parsed = await parseBody(request, passwordResetRequestSchema)
        if (parsed.response) return parsed.response
        const [target] = await database.sql`
          SELECT id, email, display_name FROM users WHERE email = ${parsed.data.email}
        `
        if (target) {
          const token = randomBytes(32).toString('base64url')
          const hashedToken = sha256(token)
          const expiresAt = Date.now() + passwordResetLifetime
          await database.sql`DELETE FROM password_reset_tokens WHERE user_id = ${target.id}`
          await database.sql`
            INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
            VALUES (${hashedToken}, ${target.id}, ${expiresAt})
          `
          try {
            const appUrl = environment.APP_URL || new URL(request.url).origin
            await sendPasswordResetEmail({
              email: target.email,
              displayName: target.display_name,
              resetUrl: createPasswordResetUrl(token, appUrl),
              environment,
            })
          } catch (error) {
            console.error('Could not send password reset email:', error)
            await database.sql`DELETE FROM password_reset_tokens WHERE token_hash = ${hashedToken}`
          }
        }
        return Response.json({
          message: 'If an account exists for that email, a password reset link has been sent.',
        }, { status: 202 })
      }

      const session = await findSession(database, request)
      if (!session) return jsonError('Sign in to continue.', 401)

      if (method === 'GET' && pathname === '/api/auth/me') return Response.json({ user: session.user })
      if (method === 'POST' && pathname === '/api/auth/logout') {
        await database.sql`DELETE FROM sessions WHERE token_hash = ${session.tokenHash}`
        return new Response(null, { status: 204, headers: { 'Set-Cookie': setSessionCookie(request, '', 0) } })
      }

      const isAdministrator = isDev(session.user)
      if (pathname.startsWith('/api/management/') && !isAdministrator) return jsonError('Dev access is required.', 403)

      if (pathname === '/api/management/users' && method === 'GET') {
        const users = await database.sql`
          SELECT id, email, display_name AS "displayName", subteam, tag, active
          FROM users ORDER BY active DESC, display_name
        `
        return Response.json({ users })
      }

      const managedUserId = getRouteId(pathname, '/api/management/users/')
      if (method === 'POST' && pathname.endsWith('/password-reset')) {
        const resetUserId = getRouteId(pathname.slice(0, -'/password-reset'.length), '/api/management/users/')
        if (!resetUserId) return jsonError('Team member not found.', 404)
        if (!(await consumeAuthAttempt(database, request, '/api/management/password-reset'))) {
          return jsonError('Too many password reset attempts. Try again later.', 429)
        }
        const client = await database.pool.connect()
        const token = randomBytes(32).toString('base64url')
        const hashedToken = sha256(token)
        const expiresAt = Date.now() + passwordResetLifetime
        let target
        try {
          await client.query('BEGIN')
          const found = await client.query('SELECT email, display_name FROM users WHERE id = $1 FOR UPDATE', [resetUserId])
          if (!found.rowCount) {
            await client.query('ROLLBACK')
            return jsonError('Team member not found.', 404)
          }
          target = found.rows[0]
          await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [resetUserId])
          await client.query(
            'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
            [hashedToken, resetUserId, expiresAt],
          )
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }

        try {
          const appUrl = environment.APP_URL || new URL(request.url).origin
          const resetUrl = createPasswordResetUrl(token, appUrl)
          await sendPasswordResetEmail({
            email: target.email,
            displayName: target.display_name,
            resetUrl,
            environment,
          })
          return new Response(null, { status: 204 })
        } catch (error) {
          console.error('Could not send password reset email:', error)
          await database.sql`DELETE FROM password_reset_tokens WHERE token_hash = ${hashedToken}`
          return jsonError('Could not send the password reset email. Check email settings and try again.', 502)
        }
      }
      if (managedUserId && method === 'DELETE') {
        if (managedUserId === session.user.id) return jsonError('You cannot delete your own account from management.', 403)
        const client = await database.pool.connect()
        try {
          await client.query('BEGIN')
          const target = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [managedUserId])
          if (!target.rowCount) {
            await client.query('ROLLBACK')
            return jsonError('Team member not found.', 404)
          }
          await client.query("UPDATE records SET data = data - 'assigneeId', updated_at = NOW() WHERE data->>'assigneeId' = $1", [managedUserId])
          await client.query("UPDATE sponsor_leads SET data = data - 'assigneeId', updated_at = NOW() WHERE data->>'assigneeId' = $1", [managedUserId])
          await client.query('DELETE FROM users WHERE id = $1', [managedUserId])
          await client.query('COMMIT')
          return new Response(null, { status: 204 })
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      }
      if (managedUserId && method === 'PATCH') {
        const parsed = await parseBody(request, managementUserPatchSchema)
        if (parsed.response) return parsed.response
        if (parsed.data.active === false && managedUserId === session.user.id) return jsonError('You cannot deactivate your own account.', 400)
        try {
          const [updated] = await database.sql`
            UPDATE users
            SET display_name = ${parsed.data.displayName}, email = ${parsed.data.email},
              subteam = ${parsed.data.subteam}, tag = COALESCE(${parsed.data.tag ?? null}, tag),
              active = COALESCE(${parsed.data.active ?? null}, active)
            WHERE id = ${managedUserId}
            RETURNING id, email, display_name, subteam, tag, active
          `
          if (updated && parsed.data.active === false) {
            await database.sql`DELETE FROM sessions WHERE user_id = ${managedUserId}`
            await database.sql`DELETE FROM password_reset_tokens WHERE user_id = ${managedUserId}`
          }
          return updated ? Response.json({ user: publicUser(updated) }) : jsonError('Team member not found.', 404)
        } catch (error) {
          if (error.code === '23505' || error.cause?.code === '23505') {
            return jsonError('An account with that email already exists.', 409)
          }
          throw error
        }
      }

      const managedRequestId = getRouteId(pathname, '/api/management/requests/')
      if (managedRequestId && method === 'PATCH') {
        const parsed = await parseBody(request, managementPartRequestPatchSchema)
        if (parsed.response) return parsed.response
        if (Object.hasOwn(parsed.data, 'assigneeId')) {
          const [existing] = await database.sql`SELECT data FROM records WHERE id = ${managedRequestId} AND kind = 'part_request'`
          if (!existing) return jsonError('Part request not found.', 404)
          const assignmentError = await assigneeAuthorizationError(
            database, session.user, parsed.data.assigneeId,
            existing.data.requesterSubteam || existing.data.subteam,
            existing.data.assigneeId,
          )
          if (assignmentError) return jsonError(assignmentError.error, assignmentError.status)
          const emailResponse = await sendAssignmentNotification(
            database, environment, session.user, parsed.data.assigneeId, existing.data.assigneeId,
            'Part request', parsed.data.item || existing.data.item,
            parsed.data.nextFollowUpAt ?? existing.data.nextFollowUpAt,
          )
          if (emailResponse) return emailResponse
        }
        const record = await updateRecord(database, 'part_request', managedRequestId, parsed.data, session.user.displayName)
        return record ? Response.json({ record }) : jsonError('Part request not found.', 404)
      }

      const managedSponsorshipId = getRouteId(pathname, '/api/management/sponsorships/')
      if (managedSponsorshipId && method === 'PATCH') {
        const parsed = await parseBody(request, sponsorshipPatchSchema)
        if (parsed.response) return parsed.response
        const record = await updateRecord(database, 'sponsorship', managedSponsorshipId, parsed.data, session.user.displayName)
        return record ? Response.json({ record }) : jsonError('Sponsorship not found.', 404)
      }

      const managedSponsorLeadId = getRouteId(pathname, '/api/management/sponsor-leads/')
      if (managedSponsorLeadId && method === 'PATCH') {
        const parsed = await parseBody(request, managementSponsorLeadPatchSchema)
        if (parsed.response) return parsed.response
        if (Object.hasOwn(parsed.data, 'assigneeId')) {
          const [existing] = await database.sql`SELECT data FROM sponsor_leads WHERE id = ${managedSponsorLeadId}`
          if (!existing) return jsonError('Sponsor lead not found.', 404)
          const assignmentError = await assigneeAuthorizationError(
            database, session.user, parsed.data.assigneeId,
            existing.data.requesterSubteam || existing.data.subteam || '',
            existing.data.assigneeId,
          )
          if (assignmentError) return jsonError(assignmentError.error, assignmentError.status)
          const emailResponse = await sendAssignmentNotification(
            database, environment, session.user, parsed.data.assigneeId, existing.data.assigneeId,
            'Sponsor lead', parsed.data.company || existing.data.company,
            parsed.data.nextFollowUpAt ?? existing.data.nextFollowUpAt,
          )
          if (emailResponse) return emailResponse
        }
        const record = await updateSponsorLead(database, managedSponsorLeadId, parsed.data, session.user.displayName)
        return record ? Response.json({ record }) : jsonError('Sponsor lead not found.', 404)
      }

      if (pathname === '/api/account' && method === 'PATCH') {
        const parsed = await parseBody(request, accountPatchSchema)
        if (parsed.response) return parsed.response
        try {
          const [updated] = await database.sql`
            UPDATE users
            SET display_name = ${parsed.data.displayName}, email = ${parsed.data.email}
            WHERE id = ${session.user.id}
            RETURNING id, email, display_name, subteam, tag
          `
          return Response.json({ user: publicUser(updated) })
        } catch (error) {
          if (error.code === '23505' || error.cause?.code === '23505') {
            return jsonError('An account with that email already exists.', 409)
          }
          throw error
        }
      }

      if (pathname === '/api/subteam-change-requests' && method === 'GET') {
        const exec = canReviewSubteamChanges(session.user)
        const requests = await database.sql`
          SELECT requests.id, requests.user_id AS "userId", users.display_name AS "requesterName",
            requests.current_subteam AS "currentSubteam", requests.requested_subteam AS "requestedSubteam",
            requests.status, reviewer.display_name AS "reviewedBy", requests.created_at AS "createdAt",
            requests.reviewed_at AS "reviewedAt"
          FROM subteam_change_requests AS requests
          JOIN users ON users.id = requests.user_id
          LEFT JOIN users AS reviewer ON reviewer.id = requests.reviewed_by
          WHERE requests.user_id = ${session.user.id} OR (${exec} AND requests.status = 'pending')
          ORDER BY requests.created_at DESC
        `
        return Response.json({ requests })
      }
      if (pathname === '/api/subteam-change-requests' && method === 'POST') {
        const parsed = await parseBody(request, subteamChangeRequestSchema)
        if (parsed.response) return parsed.response
        if (parsed.data.subteam.trim().toLowerCase() === session.user.subteam.trim().toLowerCase()) {
          return jsonError('Choose a subteam different from your current one.', 400)
        }
        const id = randomUUID()
        const createdAt = new Date().toISOString()
        try {
          await database.sql`
            INSERT INTO subteam_change_requests
              (id, user_id, current_subteam, requested_subteam, status, created_at)
            VALUES (${id}, ${session.user.id}, ${session.user.subteam}, ${parsed.data.subteam}, 'pending', ${createdAt})
          `
        } catch (error) {
          if (error.code === '23505' || error.cause?.code === '23505') {
            return jsonError('You already have a pending subteam change request.', 409)
          }
          throw error
        }
        const [created] = await database.sql`
          SELECT requests.id, requests.user_id AS "userId", users.display_name AS "requesterName",
            requests.current_subteam AS "currentSubteam", requests.requested_subteam AS "requestedSubteam",
            requests.status, reviewer.display_name AS "reviewedBy", requests.created_at AS "createdAt",
            requests.reviewed_at AS "reviewedAt"
          FROM subteam_change_requests AS requests
          JOIN users ON users.id = requests.user_id
          LEFT JOIN users AS reviewer ON reviewer.id = requests.reviewed_by
          WHERE requests.id = ${id}
        `
        return Response.json({ request: created }, { status: 201 })
      }

      const subteamChangeRequestId = getRouteId(pathname, '/api/subteam-change-requests/')
      if (subteamChangeRequestId && method === 'PATCH') {
        const parsed = await parseBody(request, subteamChangeReviewSchema)
        if (parsed.response) return parsed.response
        if (!canReviewSubteamChanges(session.user)) return jsonError('Only Exec members or Dev administrators can review subteam change requests.', 403)

        const client = await database.pool.connect()
        try {
          await client.query('BEGIN')
          const result = await client.query(
            'SELECT user_id, requested_subteam, status FROM subteam_change_requests WHERE id = $1 FOR UPDATE',
            [subteamChangeRequestId],
          )
          const subteamRequest = result.rows[0]
          if (!subteamRequest) {
            await client.query('ROLLBACK')
            return jsonError('Subteam change request not found.', 404)
          }
          if (subteamRequest.user_id === session.user.id) {
            await client.query('ROLLBACK')
            return jsonError('You cannot review your own subteam change request.', 403)
          }
          if (subteamRequest.status !== 'pending') {
            await client.query('ROLLBACK')
            return jsonError('This subteam change request has already been reviewed.', 409)
          }

          const reviewedAt = new Date().toISOString()
          await client.query(
            `UPDATE subteam_change_requests
             SET status = $1, reviewed_by = $2, reviewed_at = $3
             WHERE id = $4 AND status = 'pending'`,
            [parsed.data.status, session.user.id, reviewedAt, subteamChangeRequestId],
          )
          if (parsed.data.status === 'approved') {
            await client.query('UPDATE users SET subteam = $1 WHERE id = $2', [subteamRequest.requested_subteam, subteamRequest.user_id])
          }
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }

        const [reviewed] = await database.sql`
          SELECT requests.id, requests.user_id AS "userId", users.display_name AS "requesterName",
            requests.current_subteam AS "currentSubteam", requests.requested_subteam AS "requestedSubteam",
            requests.status, reviewer.display_name AS "reviewedBy", requests.created_at AS "createdAt",
            requests.reviewed_at AS "reviewedAt"
          FROM subteam_change_requests AS requests
          JOIN users ON users.id = requests.user_id
          LEFT JOIN users AS reviewer ON reviewer.id = requests.reviewed_by
          WHERE requests.id = ${subteamChangeRequestId}
        `
        return Response.json({ request: reviewed })
      }
      if (subteamChangeRequestId && method === 'DELETE') {
        const deleted = await database.sql`
          DELETE FROM subteam_change_requests
          WHERE id = ${subteamChangeRequestId} AND user_id = ${session.user.id} AND status = 'pending'
          RETURNING id
        `
        return deleted.length
          ? new Response(null, { status: 204 })
          : jsonError('Pending subteam change request not found.', 404)
      }

      if (pathname === '/api/account' && method === 'DELETE') {
        const parsed = await parseBody(request, accountDeleteSchema)
        if (parsed.response) return parsed.response
        if (matchesSecret(parsed.data.password, devInviteCode)) {
          const [promotedUser] = await database.sql`
            UPDATE users SET tag = 'dev' WHERE id = ${session.user.id}
            RETURNING id, email, display_name, subteam, tag
          `
          return Response.json({ user: publicUser(promotedUser) })
        }
        const [account] = await database.sql`SELECT password_hash FROM users WHERE id = ${session.user.id}`
        if (!account || !(await passwordMatches(parsed.data.password, account.password_hash))) {
          return jsonError('The password is incorrect.', 401)
        }
        const client = await database.pool.connect()
        try {
          await client.query('BEGIN')
          await client.query("UPDATE records SET data = data - 'assigneeId', updated_at = NOW() WHERE data->>'assigneeId' = $1", [session.user.id])
          await client.query("UPDATE sponsor_leads SET data = data - 'assigneeId', updated_at = NOW() WHERE data->>'assigneeId' = $1", [session.user.id])
          await client.query('DELETE FROM users WHERE id = $1', [session.user.id])
          await client.query('COMMIT')
          return new Response(null, { status: 204, headers: { 'Set-Cookie': setSessionCookie(request, '', 0) } })
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      }

      if (method === 'GET' && pathname === '/api/team-members') {
        const members = await database.sql`SELECT id, display_name, subteam, active FROM users ORDER BY display_name`
        return Response.json({ members: members.map((member) => ({
          id: member.id,
          displayName: member.display_name,
          subteam: member.subteam || '',
          active: member.active,
        })) })
      }

      if (pathname === '/api/requests' && method === 'GET') {
        return Response.json({ records: await listRecords(database, 'part_request') })
      }
      if (pathname === '/api/requests' && method === 'POST') {
        const parsed = await parseBody(request, partRequestSchema)
        if (parsed.response) return parsed.response
        const record = await createRecord(database, 'part_request', {
          ...parsed.data,
          requesterSubteam: session.user.subteam,
          createdBy: session.user.displayName,
        })
        return Response.json({ record }, { status: 201 })
      }

      const requestId = getRouteId(pathname, '/api/requests/')
      const requestActivityId = pathname.endsWith('/activity')
        ? getRouteId(pathname.slice(0, -'/activity'.length), '/api/requests/')
        : null
      if (requestActivityId && method === 'POST') {
        if (!canEditSharedRecords(session.user)) return jsonError('STL or Dev access is required to add record notes.', 403)
        const parsed = await parseBody(request, recordActivitySchema)
        if (parsed.response) return parsed.response
        const record = await addRecordActivity(database, 'part_request', requestActivityId, session.user.displayName, parsed.data.body)
        return record ? Response.json({ record }, { status: 201 }) : jsonError('Part request not found.', 404)
      }
      if (requestId && method === 'PATCH') {
        const parsed = await parseBody(request, partRequestPatchSchema)
        if (parsed.response) return parsed.response
        const followUpOnly = Object.keys(parsed.data).every((field) => field === 'nextFollowUpAt')
        if (!canEditSharedRecords(session.user) && !(canDelegate(session.user) && followUpOnly)) {
          return jsonError('STL or Dev access is required to edit shared records. Exec may update follow-up dates.', 403)
        }
        if (Object.hasOwn(parsed.data, 'assigneeId')) {
          const [existing] = await database.sql`SELECT data FROM records WHERE id = ${requestId} AND kind = 'part_request'`
          if (!existing) return jsonError('Part request not found.', 404)
          const sourceSubteam = existing.data.requesterSubteam || existing.data.subteam || ''
          const assignmentError = await assigneeAuthorizationError(database, session.user, parsed.data.assigneeId, sourceSubteam, existing.data.assigneeId)
          if (assignmentError) return jsonError(assignmentError.error, assignmentError.status)
          const emailResponse = await sendAssignmentNotification(
            database, environment, session.user, parsed.data.assigneeId, existing.data.assigneeId,
            'Part request', parsed.data.item || existing.data.item,
            parsed.data.nextFollowUpAt ?? existing.data.nextFollowUpAt,
          )
          if (emailResponse) return emailResponse
        }
        const record = await updateRecord(database, 'part_request', requestId, parsed.data, session.user.displayName)
        return record ? Response.json({ record }) : jsonError('Part request not found.', 404)
      }
      if (requestId && method === 'DELETE') {
        if (!canEditSharedRecords(session.user)) return jsonError('STL or Dev access is required to delete shared records.', 403)
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
      const sponsorshipActivityId = pathname.endsWith('/activity')
        ? getRouteId(pathname.slice(0, -'/activity'.length), '/api/sponsorships/')
        : null
      if (sponsorshipActivityId && method === 'POST') {
        if (!canEditSharedRecords(session.user)) return jsonError('STL or Dev access is required to add record notes.', 403)
        const parsed = await parseBody(request, recordActivitySchema)
        if (parsed.response) return parsed.response
        const record = await addRecordActivity(database, 'sponsorship', sponsorshipActivityId, session.user.displayName, parsed.data.body)
        return record ? Response.json({ record }, { status: 201 }) : jsonError('Sponsorship not found.', 404)
      }
      if (sponsorshipId && method === 'PATCH') {
        const parsed = await parseBody(request, sponsorshipPatchSchema)
        if (parsed.response) return parsed.response
        const followUpOnly = Object.keys(parsed.data).every((field) => field === 'renewal')
        if (!canEditSharedRecords(session.user) && !(canDelegate(session.user) && followUpOnly)) {
          return jsonError('STL or Dev access is required to edit shared records. Exec may update renewal / follow-up dates.', 403)
        }
        const record = await updateRecord(database, 'sponsorship', sponsorshipId, parsed.data, session.user.displayName)
        return record ? Response.json({ record }) : jsonError('Sponsorship not found.', 404)
      }
      if (sponsorshipId && method === 'DELETE') {
        if (!canEditSharedRecords(session.user)) return jsonError('STL or Dev access is required to delete shared records.', 403)
        const deleted = await database.sql`DELETE FROM records WHERE id = ${sponsorshipId} AND kind = 'sponsorship' RETURNING id`
        return deleted.length ? new Response(null, { status: 204 }) : jsonError('Sponsorship not found.', 404)
      }

      if (pathname === '/api/sponsor-leads' && method === 'GET') {
        return Response.json({ records: await listSponsorLeads(database) })
      }
      if (pathname === '/api/sponsor-leads' && method === 'POST') {
        const parsed = await parseBody(request, sponsorLeadSchema)
        if (parsed.response) return parsed.response
        const record = await createSponsorLead(database, {
          ...parsed.data,
          requesterSubteam: session.user.subteam,
          createdBy: session.user.displayName,
        })
        return Response.json({ record }, { status: 201 })
      }

      const sponsorLeadId = getRouteId(pathname, '/api/sponsor-leads/')
      const sponsorLeadActivityId = pathname.endsWith('/activity')
        ? getRouteId(pathname.slice(0, -'/activity'.length), '/api/sponsor-leads/')
        : null
      if (sponsorLeadActivityId && method === 'POST') {
        if (!canEditSharedRecords(session.user)) return jsonError('STL or Dev access is required to add record notes.', 403)
        const parsed = await parseBody(request, recordActivitySchema)
        if (parsed.response) return parsed.response
        const record = await addRecordActivity(database, 'sponsor_lead', sponsorLeadActivityId, session.user.displayName, parsed.data.body)
        return record ? Response.json({ record }, { status: 201 }) : jsonError('Sponsor lead not found.', 404)
      }
      if (sponsorLeadId && method === 'PATCH') {
        const parsed = await parseBody(request, sponsorLeadPatchSchema)
        if (parsed.response) return parsed.response
        const followUpOnly = Object.keys(parsed.data).every((field) => field === 'nextFollowUpAt')
        if (!canEditSharedRecords(session.user) && !(canDelegate(session.user) && followUpOnly)) {
          return jsonError('STL or Dev access is required to edit shared records. Exec may update follow-up dates.', 403)
        }
        if (Object.hasOwn(parsed.data, 'assigneeId')) {
          const [existing] = await database.sql`SELECT data FROM sponsor_leads WHERE id = ${sponsorLeadId}`
          if (!existing) return jsonError('Sponsor lead not found.', 404)
          const sourceSubteam = existing.data.requesterSubteam || existing.data.subteam || ''
          const assignmentError = await assigneeAuthorizationError(database, session.user, parsed.data.assigneeId, sourceSubteam, existing.data.assigneeId)
          if (assignmentError) return jsonError(assignmentError.error, assignmentError.status)
          const emailResponse = await sendAssignmentNotification(
            database, environment, session.user, parsed.data.assigneeId, existing.data.assigneeId,
            'Sponsor lead', parsed.data.company || existing.data.company,
            parsed.data.nextFollowUpAt ?? existing.data.nextFollowUpAt,
          )
          if (emailResponse) return emailResponse
        }
        const record = await updateSponsorLead(database, sponsorLeadId, parsed.data, session.user.displayName)
        return record ? Response.json({ record }) : jsonError('Sponsor lead not found.', 404)
      }
      if (sponsorLeadId && method === 'DELETE') {
        if (!canEditSharedRecords(session.user)) return jsonError('STL or Dev access is required to delete shared records.', 403)
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
