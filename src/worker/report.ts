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
  const keyLen = env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/dashboard_projects?select=*`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Supabase fetch failed: ${res.status} (key length ${keyLen}) — ${body}`)
  }
  return (await res.json()) as Project[]
}

async function fetchGithubToken(env: Env): Promise<string | null> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/dashboard_settings?select=github_token&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) return null
  const rows = (await res.json()) as { github_token: string | null }[]
  return rows[0]?.github_token ?? null
}

async function fetchCommitsForRepo(fullName: string, since: Date, token: string | null): Promise<Commit[]> {
  const url = `https://api.github.com/repos/${fullName}/commits?since=${since.toISOString()}&per_page=100`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'apps-dashboard-weekly-report',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers })
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

  const [projects, token] = await Promise.all([fetchProjects(env), fetchGithubToken(env)])
  const commits = await fetchCommitsForRepo(REPO, weekAgo, token)

  const linkedRepos = Array.from(
    new Map(
      projects
        .filter((p) => p.repo_full_name && p.repo_full_name !== REPO)
        .map((p) => [p.repo_full_name!, p.name] as const)
    ).entries()
  )
  const repoActivity = await Promise.all(
    linkedRepos.map(async ([repoFullName, projectName]) => ({
      projectName,
      repoFullName,
      commits: await fetchCommitsForRepo(repoFullName, weekAgo, token),
    }))
  )

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

  const repoActivityCount = repoActivity.reduce((sum, r) => sum + r.commits.length, 0)
  const repoActivityHtml = section(
    '📦 Repo activity',
    repoActivity
      .filter((r) => r.commits.length > 0)
      .map(
        (r) =>
          `<strong>${escapeHtml(r.projectName)}</strong> — ${r.commits.length} commit${r.commits.length === 1 ? '' : 's'}` +
          `<ul style="margin:4px 0 0;padding-left:18px;">${r.commits
            .slice(0, 5)
            .map(
              (c) =>
                `<li><a href="${c.html_url}" style="color:#1f8b93;">${escapeHtml(c.commit.message.split('\n')[0])}</a></li>`
            )
            .join('')}</ul>`
      )
  )

  const noActivity =
    created.length + updated.length + done.length + commits.length + repoActivityCount === 0

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-size:20px;">Weekly Report — ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</h1>
      ${noActivity ? '<p>Quiet week — no project or app changes recorded.</p>' : ''}
      ${projectHtml}
      ${commitHtml}
      ${repoActivityHtml}
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
