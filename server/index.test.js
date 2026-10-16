import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = await mkdtemp(join(tmpdir(), 'digem-api-test-'))
const databasePath = join(directory, 'test.sqlite')
const port = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const serverPath = fileURLToPath(new URL('./index.js', import.meta.url))
const server = spawn(process.execPath, [serverPath], {
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_PATH: databasePath, TEAM_INVITE_CODE: 'integration-test-invite' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

async function getFreePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve an API test port.')
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Test API exited early: ${serverOutput}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error(`Test API did not start: ${serverOutput}`)
}

after(async () => {
  server.kill('SIGTERM')
  await once(server, 'exit').catch(() => {})
  await rm(directory, { recursive: true, force: true })
})

test('invite auth and shared records persist through the API', async () => {
  await waitForServer()

  const account = {
    displayName: 'Test Member',
    subteam: 'Controls',
    email: 'test-member@example.com',
    password: 'a-long-test-password',
    inviteCode: 'integration-test-invite',
  }
  const unauthenticated = await fetch(`${baseUrl}/api/requests`)
  assert.equal(unauthenticated.status, 401)

  const invalidInvite = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, inviteCode: 'not-the-invite' }),
  })
  assert.equal(invalidInvite.status, 403)

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
  assert.equal(registration.status, 201)
  assert.equal((await registration.clone().json()).user.subteam, account.subteam)
  const cookie = registration.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/i)
  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal((await sessionResponse.json()).user.subteam, account.subteam)

  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
  assert.equal(duplicate.status, 409)

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  })
  assert.equal(login.status, 200)
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i)

  const partInput = {
    item: 'Test hydraulic fitting', company: 'Test Supplier', link: '', contact: '', quantity: 2,
    value: 45, specs: '1/4 inch NPT', compatibility: 'Fits test manifold', priority: 'High',
    subteam: 'Hydraulics', relationship: 'Member introduction', communication: 'Contacted',
    status: 'Needed', recurring: false, requestedBy: 'Test Member',
  }
  const createdPartResponse = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(partInput),
  })
  assert.equal(createdPartResponse.status, 201)
  const { record: part } = await createdPartResponse.json()
  assert.equal(part.createdBy, account.displayName)

  const updatedPartResponse = await fetch(`${baseUrl}/api/requests/${part.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ status: 'In transit' }),
  })
  assert.equal((await updatedPartResponse.json()).record.status, 'In transit')
  const listedParts = await fetch(`${baseUrl}/api/requests`, { headers: { Cookie: cookie } })
  assert.equal((await listedParts.json()).records[0].status, 'In transit')

  const sponsorInput = {
    company: 'Test Engineering Donor', contact: 'Test Contact', amount: 500, status: 'Committed',
    deliverables: ['Demo invitation'], relationship: 'Alumni connection', renewal: '2027-01-15',
  }
  const createdSponsorResponse = await fetch(`${baseUrl}/api/sponsorships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(sponsorInput),
  })
  assert.equal(createdSponsorResponse.status, 201)
  const { record: sponsor } = await createdSponsorResponse.json()

  const sponsorUpdate = await fetch(`${baseUrl}/api/sponsorships/${sponsor.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ status: 'Received' }),
  })
  assert.equal((await sponsorUpdate.json()).record.status, 'Received')
  const listedSponsors = await fetch(`${baseUrl}/api/sponsorships`, { headers: { Cookie: cookie } })
  assert.equal((await listedSponsors.json()).records[0].company, sponsorInput.company)

  const teammateRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, displayName: 'Test Teammate', email: 'test-teammate@example.com' }),
  })
  assert.equal(teammateRegistration.status, 201)
  const teammateCookie = teammateRegistration.headers.get('set-cookie')?.split(';')[0]
  const sharedParts = await fetch(`${baseUrl}/api/requests`, { headers: { Cookie: teammateCookie } })
  assert.equal((await sharedParts.json()).records[0].item, partInput.item)
  const deletedPart = await fetch(`${baseUrl}/api/requests/${part.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
  assert.equal(deletedPart.status, 204)
  const partsAfterDelete = await fetch(`${baseUrl}/api/requests`, { headers: { Cookie: cookie } })
  assert.equal((await partsAfterDelete.json()).records.some((record) => record.id === part.id), false)
  const sharedSponsors = await fetch(`${baseUrl}/api/sponsorships`, { headers: { Cookie: teammateCookie } })
  assert.equal((await sharedSponsors.json()).records[0].company, sponsorInput.company)

  const sponsorLeadInput = {
    company: 'Test Potential Sponsor', contactName: 'Jordan Contact', contactRole: 'Engineering Manager',
    contactEmail: 'jordan@example.com', contactPhone: '', subteam: 'Outreach',
    relationship: 'A teammate can introduce us', details: 'Interested in supporting student engineering.',
    supportTypes: ['Parts / materials', 'Equipment'], supportDetails: 'May donate steel stock or loan a portable welder.',
    estimatedAmount: 0, canIntroduce: 'Yes',
  }
  const createdLeadResponse = await fetch(`${baseUrl}/api/sponsor-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(sponsorLeadInput),
  })
  assert.equal(createdLeadResponse.status, 201)
  const { record: lead } = await createdLeadResponse.json()
  assert.equal(lead.createdBy, account.displayName)
  assert.equal(lead.status, 'New')
  assert.deepEqual(lead.supportTypes, sponsorLeadInput.supportTypes)
  const leadStatusResponse = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ status: 'Following up' }),
  })
  assert.equal((await leadStatusResponse.json()).record.status, 'Following up')
  const sharedLeads = await fetch(`${baseUrl}/api/sponsor-leads`, { headers: { Cookie: teammateCookie } })
  assert.equal((await sharedLeads.json()).records[0].company, sponsorLeadInput.company)
  const deletedLead = await fetch(`${baseUrl}/api/sponsor-leads/${lead.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
  assert.equal(deletedLead.status, 204)
  const leadsAfterDelete = await fetch(`${baseUrl}/api/sponsor-leads`, { headers: { Cookie: cookie } })
  assert.equal((await leadsAfterDelete.json()).records.some((record) => record.id === lead.id), false)

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
  assert.equal(logout.status, 204)
  const loggedOut = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  assert.equal(loggedOut.status, 401)
})