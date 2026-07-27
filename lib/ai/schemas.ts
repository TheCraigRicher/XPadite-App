import { z } from 'zod'

// ── In-request message from client ────────────────────────────────────────────

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
})

export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(30),
  context: z.object({
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().max(80),
    activities: z.array(z.object({
      id: z.string(),
      name: z.string(),
      emoji: z.string().nullable().optional(),
    })).max(50),
  }),
})

export const PlanRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(30),
  context: z.object({
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().max(80),
    activities: z.array(z.object({
      id: z.string(),
      name: z.string(),
      emoji: z.string().nullable().optional(),
    })).max(50),
  }),
})

// ── Structured plan output ────────────────────────────────────────────────────

export const DraftTaskSchema = z.object({
  clientId: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  estimatedMinutes: z.number().int().min(1).max(1440),
  activityId: z.string().nullable(),
  activityName: z.string().min(1).max(100),
  reminderRecommended: z.boolean(),
  priority: z.enum(['low', 'medium', 'high']),
  notes: z.string().max(500).nullable(),
})

export const DraftPlanResponseSchema = z.object({
  goal: z.object({
    title: z.string().min(1).max(150),
    description: z.string().max(600),
    targetDate: z.string().nullable(),
    timelineType: z.enum(['fixed', 'flexible']),
    seriousness: z.string().max(200),
    successDefinition: z.string().max(500),
  }),
  activitySuggestion: z.object({
    suggestedName: z.string().min(1).max(100),
    existingActivityId: z.string().nullable(),
    suggestedColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    emoji: z.string().max(8).nullable(),
  }),
  phases: z.array(z.object({
    id: z.string(),
    title: z.string().max(200),
    startDate: z.string(),
    endDate: z.string(),
    description: z.string().optional(),
  })).max(8),
  milestones: z.array(z.object({
    id: z.string(),
    title: z.string().max(200),
    date: z.string(),
    description: z.string().optional(),
  })).max(12),
  tasks: z.array(DraftTaskSchema).min(1).max(50),
  warnings: z.array(z.string().max(300)).max(5),
  assumptions: z.array(z.string().max(300)).max(5),
})

export type ChatRequestType = z.infer<typeof ChatRequestSchema>
export type DraftPlanResponseType = z.infer<typeof DraftPlanResponseSchema>
export type DraftTaskType = z.infer<typeof DraftTaskSchema>
