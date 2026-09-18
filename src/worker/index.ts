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
    const url = new URL(request.url)
    if (url.pathname === '/api/test-report') {
      // Manual trigger for testing, since the cron only fires Sundays.
      // Gated on knowing REPORT_TO_EMAIL rather than a public open route.
      if (url.searchParams.get('email') !== env.REPORT_TO_EMAIL) {
        return new Response('Not found', { status: 404 })
      }
      try {
        await sendReportEmail(env)
        return new Response('Report sent.')
      } catch (err) {
        return new Response(`Failed: ${err instanceof Error ? err.message : String(err)}`, { status: 500 })
      }
    }
    return env.ASSETS.fetch(request)
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!isReportTime(new Date())) return
    ctx.waitUntil(sendReportEmail(env))
  },
}
