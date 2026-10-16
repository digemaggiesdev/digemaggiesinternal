import { z } from 'zod'

const requestStatuses = ['Needed', 'Outreach', 'In progress', 'Received', 'Closed']
const communicationStatuses = ['Not started', 'Contacted', 'Follow-up', 'Confirmed']
const sponsorStatuses = ['Prospect', 'Proposal sent', 'Committed', 'Received']
const sponsorLeadStatuses = ['New', 'Following up', 'Contacted', 'Converted', 'Not pursuing']
const sponsorSupportTypes = ['Financial', 'Parts / materials', 'Equipment', 'Services / expertise', 'Other']
const optionalText = (max = 500) => z.string().trim().max(max).default('')

export const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  subteam: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  inviteCode: z.string().min(1).max(200),
})

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
})

export const partRequestSchema = z.object({
  item: z.string().trim().min(1).max(200),
  company: optionalText(200),
  link: z.union([z.literal(''), z.string().url().max(2000)]).default(''),
  contact: optionalText(300),
  quantity: z.number().int().min(1).max(100000),
  value: z.number().min(0).max(100000000),
  specs: optionalText(5000),
  compatibility: optionalText(5000),
  priority: z.enum(['Urgent', 'High', 'Normal', 'Low']),
  subteam: z.string().trim().min(1).max(100),
  relationship: optionalText(2000),
  communication: z.enum(communicationStatuses),
  status: z.enum(requestStatuses),
  recurring: z.boolean(),
  requestedBy: optionalText(100),
})

export const partRequestPatchSchema = z.object({
  status: z.enum(requestStatuses).optional(),
  communication: z.enum(communicationStatuses).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide a status to update.')

export const sponsorshipSchema = z.object({
  company: z.string().trim().min(1).max(200),
  contact: optionalText(300),
  amount: z.number().min(0).max(100000000),
  status: z.enum(sponsorStatuses),
  deliverables: z.array(z.string().trim().min(1).max(500)).max(8),
  relationship: optionalText(2000),
  renewal: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''),
})

export const sponsorshipPatchSchema = z.object({
  status: z.enum(sponsorStatuses),
})

export const sponsorLeadSchema = z.object({
  company: z.string().trim().min(1).max(200),
  contactName: optionalText(200),
  contactRole: optionalText(200),
  contactEmail: z.union([z.literal(''), z.string().trim().email().max(254)]).default(''),
  contactPhone: optionalText(100),
  subteam: optionalText(100),
  relationship: z.string().trim().min(1).max(2000),
  details: z.string().trim().min(1).max(5000),
  supportTypes: z.array(z.enum(sponsorSupportTypes)).min(1).max(sponsorSupportTypes.length),
  supportDetails: z.string().trim().min(1).max(3000),
  estimatedAmount: z.number().min(0).max(100000000),
  canIntroduce: z.enum(['Yes', 'No', 'Not sure']),
})

export const sponsorLeadPatchSchema = z.object({
  status: z.enum(sponsorLeadStatuses),
})