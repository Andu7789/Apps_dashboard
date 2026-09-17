import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Project, ProjectDraft, Stage } from './types'
import { isOnFire } from './types'
import { Auth } from './components/Auth'
import { ProjectForm } from './components/ProjectForm'
import { ProjectRow } from './components/ProjectRow'
import './App.css'

const WIP_LIMIT = 3

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  }

  async function saveProject(draft: ProjectDraft) {
    setError(null)
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
      ideas: [...byStage('idea'), ...byStage('backlog')].sort((a, b) => b.ice_score - a.ice_score),
      done: [...byStage('done'), ...byStage('archived')],
    }
  }, [projects])

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
          <button className="secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {formOpen && (
        <div className="modal-overlay" onClick={() => setFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <ProjectForm
              initial={editing ?? undefined}
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

          <section className="section">
            <h2>
              Now{' '}
              <span className={`wip ${groups.active.length > WIP_LIMIT ? 'over' : ''}`}>
                {groups.active.length}/{WIP_LIMIT}
              </span>
            </h2>
            {groups.active.length === 0 && <p className="empty">Nothing active. Pull from Next.</p>}
            {groups.active.map((p) => (
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
            {groups.next.length === 0 && <p className="empty">Nothing queued.</p>}
            {groups.next.map((p) => (
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
            <h2>Idea inbox</h2>
            {groups.ideas.length === 0 && <p className="empty">Capture your next idea here.</p>}
            {groups.ideas.map((p) => (
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
