import { useState } from 'react'
import type { Project, ProjectDraft, Stage, Health } from '../types'
import { RepoPicker } from './RepoPicker'

const emptyDraft: ProjectDraft = {
  name: '',
  description: '',
  stage: 'idea',
  status: 'green',
  next_action: '',
  ice_impact: null,
  ice_confidence: null,
  ice_ease: null,
  deadline: null,
  url: '',
  tags: [],
}

export function ProjectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Project
  onSave: (draft: ProjectDraft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ProjectDraft>(
    initial
      ? {
          name: initial.name,
          description: initial.description ?? '',
          stage: initial.stage,
          status: initial.status,
          next_action: initial.next_action ?? '',
          ice_impact: initial.ice_impact,
          ice_confidence: initial.ice_confidence,
          ice_ease: initial.ice_ease,
          deadline: initial.deadline,
          url: initial.url ?? '',
          tags: initial.tags,
        }
      : emptyDraft
  )

  function set<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  return (
    <form
      className="project-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(draft)
      }}
    >
      <input
        placeholder="Project name"
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
        required
        autoFocus
      />
      <textarea
        placeholder="Description"
        value={draft.description ?? ''}
        onChange={(e) => set('description', e.target.value)}
        rows={2}
      />
      <input
        placeholder="Next action"
        value={draft.next_action ?? ''}
        onChange={(e) => set('next_action', e.target.value)}
      />
      <div className="form-row">
        <label>
          Stage
          <select value={draft.stage} onChange={(e) => set('stage', e.target.value as Stage)}>
            <option value="idea">Idea</option>
            <option value="backlog">Backlog</option>
            <option value="next">Next</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          Status
          <select value={draft.status} onChange={(e) => set('status', e.target.value as Health)}>
            <option value="green">🟢 Green</option>
            <option value="amber">🟡 Amber</option>
            <option value="red">🔴 Red</option>
          </select>
        </label>
        <label>
          Deadline
          <input
            type="date"
            value={draft.deadline ?? ''}
            onChange={(e) => set('deadline', e.target.value || null)}
          />
        </label>
      </div>
      <div className="form-row ice-row">
        <label>
          Impact (1-10)
          <input
            type="number"
            min={1}
            max={10}
            value={draft.ice_impact ?? ''}
            onChange={(e) => set('ice_impact', e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <label>
          Confidence (1-10)
          <input
            type="number"
            min={1}
            max={10}
            value={draft.ice_confidence ?? ''}
            onChange={(e) => set('ice_confidence', e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <label>
          Ease (1-10)
          <input
            type="number"
            min={1}
            max={10}
            value={draft.ice_ease ?? ''}
            onChange={(e) => set('ice_ease', e.target.value ? Number(e.target.value) : null)}
          />
        </label>
      </div>
      <input
        placeholder="URL (repo, doc, site…)"
        value={draft.url ?? ''}
        onChange={(e) => set('url', e.target.value)}
      />
      <RepoPicker
        onPick={(repo) => {
          set('url', repo.html_url)
          if (!draft.name) set('name', repo.name)
        }}
      />
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit">{initial ? 'Save' : 'Add project'}</button>
      </div>
    </form>
  )
}
