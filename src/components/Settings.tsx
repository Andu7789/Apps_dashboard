import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function Settings({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void supabase
      .from('dashboard_settings')
      .select('github_token')
      .maybeSingle()
      .then(({ data }) => setHasToken(!!data?.github_token))
  }, [])

  async function save() {
    setError(null)
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return
    const { error } = await supabase
      .from('dashboard_settings')
      .upsert({ user_id: userData.user.id, github_token: token || null })
    if (error) return setError(error.message)
    setHasToken(!!token)
    setToken('')
    setStatus('Saved.')
  }

  async function clearToken() {
    setError(null)
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return
    const { error } = await supabase
      .from('dashboard_settings')
      .upsert({ user_id: userData.user.id, github_token: null })
    if (error) return setError(error.message)
    setHasToken(false)
    setStatus('Token cleared.')
  }

  return (
    <div className="project-form">
      <h2>Settings</h2>
      <p className="hint">
        GitHub personal access token (repo read scope) — lets you pick a repo instead of
        typing the URL when adding a project. Create one at{' '}
        <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">
          github.com/settings/tokens
        </a>
        .
      </p>
      <input
        type="password"
        placeholder={hasToken ? 'Token saved — enter a new one to replace it' : 'ghp_…'}
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      {status && <p className="hint">{status}</p>}
      <div className="form-actions">
        {hasToken && (
          <button type="button" className="danger" onClick={clearToken}>
            Clear token
          </button>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
        <button type="button" onClick={save} disabled={!token}>
          Save
        </button>
      </div>
    </div>
  )
}
