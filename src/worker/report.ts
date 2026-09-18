import { isOnFire, type Project } from '../types'

export interface Env {
  ASSETS: Fetcher
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  RESEND_API_KEY: string
  REPORT_TO_EMAIL: string
}

const REPO = 'Andu7789/Apps_dashboard'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

interface Commit {
  commit: { message: string; author: { date: string } }
  html_url: string
}

async function fetchProjects(env: Env): Promise<Project[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/dashboard_projects?select=*`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`)
  return (await res.json()) as Project[]
}

async function fetchCommits(since: Date): Promise<Commit[]> {
  const url = `https://api.github.com/repos/${REPO}/commits?since=${since.toISOString()}&per_page=100`
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'apps-dashboard-weekly-report' },
  })
  if (!res.ok) return []
  return (await res.json()) as Commit[]
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function section(title: string, rows: string[]): string {
  if (rows.length === 0) return ''
  return `<h2 style="font-size:15px;margin:24px 0 8px;">${title}</h2><ul style="margin:0;padding-left:18px;">${rows
    .map((r) => `<li style="margin-bottom:4px;">${r}</li>`)
    .join('')}</ul>`
}

export async function buildReportHtml(env: Env): Promise<{ subject: string; html: string }> {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - WEEK_MS)

  const [projects, commits] = await Promise.all([fetchProjects(env), fetchCommits(weekAgo)])

  const created = projects.filter((p) => new Date(p.created_at) >= weekAgo)
  const createdIds = new Set(created.map((p) => p.id))
  const updated = projects.filter((p) => !createdIds.has(p.id) && new Date(p.updated_at) >= weekAgo)
  const done = projects.filter((p) => p.stage === 'done' && new Date(p.updated_at) >= weekAgo)
  const onFire = projects.filter((p) => isOnFire(p))
  const nextUp = projects
    .filter((p) => p.stage === 'next')
    .sort((a, b) => b.ice_score - a.ice_score)
    .slice(0, 3)

  const projectHtml = [
    section(
      '🆕 New this week',
      created.map((p) => escapeHtml(p.name))
    ),
    section(
      '↻ Updated this week',
      updated.map((p) => `${escapeHtml(p.name)} <span style="opacity:0.6;">(${p.stage})</span>`)
    ),
    section(
      '✅ Done this week',
      done.map((p) => escapeHtml(p.name))
    ),
    section(
      '🔥 Currently on fire',
      onFire.map((p) => escapeHtml(p.name))
    ),
    section(
      '⬆️ Next up (top 3 by ICE)',
      nextUp.map((p) => `${escapeHtml(p.name)} <span style="opacity:0.6;">ICE ${p.ice_score}</span>`)
    ),
  ].join('')

  const commitHtml = section(
    '🛠️ App changes this week',
    commits.map(
      (c) =>
        `<a href="${c.html_url}" style="color:#1f8b93;">${escapeHtml(c.commit.message.split('\n')[0])}</a>`
    )
  )

  const noActivity = created.length + updated.length + done.length + commits.length === 0

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-size:20px;">Weekly Report — ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</h1>
      ${noActivity ? '<p>Quiet week — no project or app changes recorded.</p>' : ''}
      ${projectHtml}
      ${commitHtml}
      <p style="margin-top:32px;font-size:12px;opacity:0.6;">
        <a href="https://abdashboard.site" style="color:#1f8b93;">Open your dashboard</a>
      </p>
    </div>
  `

  return { subject: `Weekly Report — ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, html }
}

export async function sendReportEmail(env: Env): Promise<void> {
  const { subject, html } = await buildReportHtml(env)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Project Dashboard <onboarding@resend.dev>',
      to: [env.REPORT_TO_EMAIL],
      subject,
      html,
    }),
  })
  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`)
  }
}
