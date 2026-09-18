import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Project, ProjectDraft, Stage } from './types'
import { isOnFire } from './types'
import { Auth } from './components/Auth'
import { ProjectForm } from './components/ProjectForm'
import { ProjectRow } from './components/ProjectRow'
import { Settings } from './components/Settings'
import { PillFilter } from './components/PillFilter'
import { fetchRepoPushedAt } from './lib/github'
import './App.css'

const WIP_LIMIT = 3

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ideaFilter, setIdeaFilter] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [nextFilter, setNextFilter] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) void loadProjects()
  }, [session])

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('dashboard_projects')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setProjects(data as Project[])
    setLoading(false)
    if (data) void syncRepoActivity(data as Project[])
  }

  async function syncRepoActivity(current: Project[]) {
    const linked = current.filter((p) => p.repo_full_name && (p.stage === 'active' || p.stage === 'next'))
    if (linked.length === 0) return
    const { data: settings } = await supabase
      .from('dashboard_settings')
      .select('github_token')
      .maybeSingle()
    const token = settings?.github_token
    if (!token) return
    for (const p of linked) {
      const pushedAt = await fetchRepoPushedAt(token, p.repo_full_name!)
      if (pushedAt && pushedAt !== p.repo_pushed_at) {
        await supabase.from('dashboard_projects').update({ repo_pushed_at: pushedAt }).eq('id', p.id)
        setProjects((prev) => prev.map((pr) => (pr.id === p.id ? { ...pr, repo_pushed_at: pushedAt } : pr)))
      }
    }
  }

  async function saveProject(rawDraft: ProjectDraft) {
    setError(null)
    const isFullyScored =
      rawDraft.ice_impact != null && rawDraft.ice_confidence != null && rawDraft.ice_ease != null
    const draft =
      rawDraft.stage === 'idea' && isFullyScored ? { ...rawDraft, stage: 'next' as const } : rawDraft
    if (editing) {
      const { error } = await supabase.from('dashboard_projects').update(draft).eq('id', editing.id)
      if (error) return setError(error.message)
    } else {
      const { error } = await supabase.from('dashboard_projects').insert(draft)
      if (error) return setError(error.message)
    }
    setFormOpen(false)
    setEditing(null)
    void loadProjects()
  }

  async function markReviewed(p: Project) {
    const { error } = await supabase
      .from('dashboard_projects')
      .update({ last_reviewed_at: new Date().toISOString() })
      .eq('id', p.id)
    if (error) setError(error.message)
    else void loadProjects()
  }

  async function deleteProject(p: Project) {
    if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return
    const { error } = await supabase.from('dashboard_projects').delete().eq('id', p.id)
    if (error) setError(error.message)
    else void loadProjects()
  }

  const groups = useMemo(() => {
    const byStage = (s: Stage) => projects.filter((p) => p.stage === s)
    return {
      onFire: projects.filter(isOnFire),
      active: byStage('active'),
      next: byStage('next').sort((a, b) => b.ice_score - a.ice_score),
      ideas: byStage('idea').sort((a, b) => b.ice_score - a.ice_score),
      done: [...byStage('done'), ...byStage('archived')],
    }
  }, [projects])

  const uniqueNames = (list: Project[]) => Array.from(new Set(list.map((p) => p.name)))
  const applyFilter = (list: Project[], filter: string | null) =>
    filter ? list.filter((p) => p.name === filter) : list

  const activeNames = useMemo(() => uniqueNames(groups.active), [groups.active])
  const nextNames = useMemo(() => uniqueNames(groups.next), [groups.next])
  const ideaNames = useMemo(() => uniqueNames(groups.ideas), [groups.ideas])

  const filteredActive = applyFilter(groups.active, activeFilter)
  const filteredNext = applyFilter(groups.next, nextFilter)
  const filteredIdeas = applyFilter(groups.ideas, ideaFilter)

  if (session === undefined) return <div className="loading-screen">Loading…</div>
  if (!session) return <Auth />

  return (
    <div className="app">
      <header>
        <h1>Project Dashboard</h1>
        <div className="header-actions">
          <button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            + New
          </button>
          <button className="secondary" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button className="secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <Settings onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}

      {formOpen && (
        <div className="modal-overlay" onClick={() => setFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <ProjectForm
              initial={editing ?? undefined}
              existingProjects={projects}
              onSave={saveProject}
              onCancel={() => {
                setFormOpen(false)
                setEditing(null)
              }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading projects…</p>
      ) : (
        <main>
          {groups.onFire.length > 0 && (
            <section className="section on-fire-section">
              <h2>🔥 On fire</h2>
              {groups.onFire.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  onEdit={() => {
                    setEditing(p)
                    setFormOpen(true)
                  }}
                  onReview={() => markReviewed(p)}
                  onDelete={() => deleteProject(p)}
                />
              ))}
            </section>
          )}

          <div className="now-next-row">
            <section className="section">
              <h2>
                Now{' '}
                <span className={`wip ${groups.active.length > WIP_LIMIT ? 'over' : ''}`}>
                  {groups.active.length}/{WIP_LIMIT}
                </span>
              </h2>
              <PillFilter names={activeNames} active={activeFilter} onChange={setActiveFilter} />
              {groups.active.length === 0 && <p className="empty">Nothing active. Pull from Next.</p>}
              {filteredActive.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  onEdit={() => {
                    setEditing(p)
                    setFormOpen(true)
                  }}
                  onReview={() => markReviewed(p)}
                  onDelete={() => deleteProject(p)}
                />
              ))}
            </section>

            <section className="section">
              <h2>Next (ranked by ICE)</h2>
              <PillFilter names={nextNames} active={nextFilter} onChange={setNextFilter} />
              {groups.next.length === 0 && <p className="empty">Nothing queued.</p>}
              {filteredNext.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  onEdit={() => {
                    setEditing(p)
                    setFormOpen(true)
                  }}
                  onReview={() => markReviewed(p)}
                  onDelete={() => deleteProject(p)}
                />
              ))}
            </section>
          </div>

          <section className="section">
            <h2>Idea inbox</h2>
            <PillFilter names={ideaNames} active={ideaFilter} onChange={setIdeaFilter} />
            {groups.ideas.length === 0 && <p className="empty">Capture your next idea here.</p>}
            {filteredIdeas.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                onEdit={() => {
                  setEditing(p)
                  setFormOpen(true)
                }}
                onReview={() => markReviewed(p)}
                onDelete={() => deleteProject(p)}
              />
            ))}
          </section>

          {groups.done.length > 0 && (
            <details className="section done-section">
              <summary>Done / archived ({groups.done.length})</summary>
              {groups.done.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  onEdit={() => {
                    setEditing(p)
                    setFormOpen(true)
                  }}
                  onReview={() => markReviewed(p)}
                  onDelete={() => deleteProject(p)}
                />
              ))}
            </details>
          )}
        </main>
      )}
    </div>
  )
}
