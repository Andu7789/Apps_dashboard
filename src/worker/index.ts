import { type Env, sendReportEmail } from './report'

function isReportTime(now: Date): boolean {
  const londonHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      hour12: false,
    }).format(now)
  )
  return londonHour === 8
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request)
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!isReportTime(new Date())) return
    ctx.waitUntil(sendReportEmail(env))
  },
}
