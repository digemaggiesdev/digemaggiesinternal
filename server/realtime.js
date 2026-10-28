import { Rest } from 'ably'

export const workspaceChannelName = 'digem-workspace'

export function realtimeIsEnabled(environment = process.env) {
  return Boolean(environment.ABLY_API_KEY)
}

export async function createWorkspaceTokenRequest(environment, userId) {
  const key = environment.ABLY_API_KEY
  if (!key) throw new Error('ABLY_API_KEY is not configured.')

  const ably = new Rest({ key })
  return ably.auth.createTokenRequest({
    clientId: userId,
    capability: JSON.stringify({ [workspaceChannelName]: ['subscribe'] }),
  })
}

export async function publishWorkspaceChange(environment = process.env) {
  const key = environment.ABLY_API_KEY
  if (!key) return

  try {
    const ably = new Rest({ key })
    await ably.channels.get(workspaceChannelName).publish('workspace-updated', { changedAt: new Date().toISOString() })
  } catch (error) {
    console.error('Could not publish workspace change notification:', error)
  }
}
