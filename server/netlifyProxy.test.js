import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { NetlifyDB } from '@netlify/database-dev'
import { getDatabase } from '@netlify/database'
import { createApiHandler } from '../netlify/functions/api.mjs'

const migrationPath = fileURLToPath(new URL('../netlify/database/migrations/', import.meta.url))
const inviteCode = 'netlify-function-test-invite'
let netlifyDb
let database
let handler

before(async () => {
  netlifyDb = new NetlifyDB()
  const connectionString = await netlifyDb.start()
  await netlifyDb.applyMigrations(migrationPath)
  database = getDatabase({ connectionString })
  handler = createApiHandler(database, { TEAM_INVITE_CODE: inviteCode })
})

after(async () => {
  await database?.pool.end()
  await netlifyDb?.stop()
})

function jsonRequest(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'x-nf-client-connection-ip': '127.0.0.1' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return new Request(`https://digem.example.netlify.app${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('Netlify API health and authentication use the managed database', async () => {
  const health = await handler(jsonRequest('/api/health'))
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const protectedResponse = await handler(jsonRequest('/api/requests'))
  assert.equal(protectedResponse.status, 401)

  const account = {
    displayName: 'Netlify Test Member',
    subteam: 'Controls',
    email: 'netlify-test-member@example.com',
    password: 'a-long-netlify-test-password',
    inviteCode,
  }
  const invalidInvite = await handler(jsonRequest('/api/auth/register', { method: 'POST', body: { ...account, inviteCode: 'wrong-code' } }))
  assert.equal(invalidInvite.status, 403)

  const created = await handler(jsonRequest('/api/auth/register', { method: 'POST', body: account }))
  assert.equal(created.status, 201)
  assert.match(created.headers.get('set-cookie'), /HttpOnly/)
  const { user } = await created.json()
  assert.equal(user.subteam, account.subteam)
  const cookie = created.headers.get('set-cookie').split(';')[0]

  const session = await handler(jsonRequest('/api/auth/me', { cookie }))
  assert.equal((await session.json()).user.email, account.email)
})

test('Netlify API creates, updates, shares, and deletes sponsor leads', async () => {
  const login = await handler(jsonRequest('/api/auth/login', {
    method: 'POST',
    body: { email: 'netlify-test-member@example.com', password: 'a-long-netlify-test-password' },
  }))
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]

  const partInput = {
    item: 'Netlify Test Hydraulic Fitting', company: 'Test Supplier', link: '', contact: '', quantity: 2,
    value: 45, specs: '1/4 inch NPT', compatibility: 'Fits the test manifold', priority: 'High',
    subteam: 'Controls', relationship: 'Member introduction', communication: 'Not started',
    status: 'Needed', recurring: false, requestedBy: 'Netlify Test Member',
  }
  const createdPart = await handler(jsonRequest('/api/requests', { method: 'POST', body: partInput, cookie }))
  assert.equal(createdPart.status, 201)
  const { record: part } = await createdPart.json()
  const updatedPart = await handler(jsonRequest(`/api/requests/${part.id}`, {
    method: 'PATCH', body: { status: 'Received' }, cookie,
  }))
  assert.equal((await updatedPart.json()).record.status, 'Received')
  const listedParts = await handler(jsonRequest('/api/requests', { cookie }))
  assert.equal((await listedParts.json()).records[0].id, part.id)
  const deletedPart = await handler(jsonRequest(`/api/requests/${part.id}`, { method: 'DELETE', cookie }))
  assert.equal(deletedPart.status, 204)

  const sponsorInput = {
    company: 'Netlify Test Sponsor Record', contact: 'Test Contact', amount: 500, status: 'Committed',
    deliverables: ['Demo invitation'], relationship: 'Alumni connection', renewal: '2027-01-15',
  }
  const createdSponsor = await handler(jsonRequest('/api/sponsorships', { method: 'POST', body: sponsorInput, cookie }))
  assert.equal(createdSponsor.status, 201)
  const { record: sponsor } = await createdSponsor.json()
  const updatedSponsor = await handler(jsonRequest(`/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH', body: { status: 'Received' }, cookie,
  }))
  assert.equal((await updatedSponsor.json()).record.status, 'Received')
  const listedSponsors = await handler(jsonRequest('/api/sponsorships', { cookie }))
  assert.equal((await listedSponsors.json()).records[0].id, sponsor.id)

  const input = {
    company: 'Netlify Test Sponsor', contactName: 'Jordan Contact', contactRole: 'Engineering Manager',
    contactEmail: 'jordan@example.com', contactPhone: '', subteam: 'Controls',
    relationship: 'A teammate can make an introduction.', details: 'They support student engineering.',
    supportTypes: ['Parts / materials', 'Equipment'], supportDetails: 'Could donate steel stock or loan equipment.',
    estimatedAmount: 0, canIntroduce: 'Yes',
  }
  const created = await handler(jsonRequest('/api/sponsor-leads', { method: 'POST', body: input, cookie }))
  assert.equal(created.status, 201)
  const { record } = await created.json()
  assert.equal(record.createdBy, 'Netlify Test Member')

  const updated = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, {
    method: 'PATCH', body: { status: 'Following up' }, cookie,
  }))
  assert.equal((await updated.json()).record.status, 'Following up')

  const listed = await handler(jsonRequest('/api/sponsor-leads', { cookie }))
  assert.equal((await listed.json()).records[0].company, input.company)

  const deleted = await handler(jsonRequest(`/api/sponsor-leads/${record.id}`, { method: 'DELETE', cookie }))
  assert.equal(deleted.status, 204)
})