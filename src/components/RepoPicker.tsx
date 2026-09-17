import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchGithubRepos, type GithubRepo } from '../lib/github'

export function RepoPicker({ onPick }: { onPick: (repo: GithubRepo) => void }) {
  const [open, setOpen] = useState(false)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  async function open_() {
    setOpen(true)
    if (repos !== null) return
    setLoading(true)
    setError(null)
    const { data, error: dbError } = await supabase
      .from('dashboard_settings')
      .select('github_token')
      .maybeSingle()
    if (dbError || !data?.github_token) {
      setError('Add a GitHub token in Settings first.')
      setLoading(false)
      return
    }
    try {
      const fetched = await fetchGithubRepos(data.github_token)
      setRepos(fetched)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load repos')
    } finally {
      setLoading(false)
    }
  }

  const filtered = (repos ?? []).filter((r) =>
    r.full_name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="repo-picker">
      <button type="button" className="secondary" onClick={() => (open ? setOpen(false) : open_())}>
        {open ? 'Close' : 'Pick from GitHub'}
      </button>
      {open && (
        <div className="repo-picker-panel">
          {loading && <p className="hint">Loading repos…</p>}
          {error && <p className="error">{error}</p>}
          {!loading && !error && (
            <>
              <input
                placeholder="Filter repos…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <div className="repo-list">
                {filtered.slice(0, 30).map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className="repo-item"
                    onClick={() => {
                      onPick(r)
                      setOpen(false)
                    }}
                  >
                    {r.private && <span className="repo-private">🔒</span>}
                    {r.full_name}
                  </button>
                ))}
                {filtered.length === 0 && <p className="hint">No matches.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
