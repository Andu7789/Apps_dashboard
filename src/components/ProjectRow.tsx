import type { Project } from '../types'
import { daysSince, isOnFire } from '../types'

const healthIcon: Record<Project['status'], string> = {
  green: '🟢',
  amber: '🟡',
  red: '🔴',
}

export function ProjectRow({
  project,
  onEdit,
  onReview,
  onDelete,
}: {
  project: Project
  onEdit: () => void
  onReview: () => void
  onDelete: () => void
}) {
  const onFire = isOnFire(project)
  const stale = daysSince(project.last_reviewed_at)

  return (
    <div className={`project-row ${onFire ? 'on-fire' : ''}`}>
      <div className="project-row-main">
        <span className="health-dot" title={project.status}>
          {healthIcon[project.status]}
        </span>
        <div className="project-row-text">
          <div className="project-row-title">
            {onFire && <span className="fire">🔥</span>}
            {project.url ? (
              <a href={project.url} target="_blank" rel="noreferrer">
                {project.name}
              </a>
            ) : (
              project.name
            )}
            {project.stage === 'next' && (
              <span className="ice-badge" title="Impact × Confidence × Ease">
                ICE {project.ice_score}
              </span>
            )}
          </div>
          {project.next_action && <div className="next-action">→ {project.next_action}</div>}
          {project.deadline && (
            <div className="deadline">
              due {project.deadline}
              {new Date(project.deadline) < new Date() && ' (overdue)'}
            </div>
          )}
        </div>
      </div>
      <div className="project-row-meta">
        <span className="reviewed" title="Days since last reviewed">
          {stale}d
        </span>
        <button onClick={onReview} title="Mark reviewed today">
          ✓
        </button>
        <button onClick={onEdit}>Edit</button>
        <button onClick={onDelete} className="danger">
          ×
        </button>
      </div>
    </div>
  )
}
