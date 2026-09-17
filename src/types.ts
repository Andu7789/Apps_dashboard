export type Stage = 'idea' | 'next' | 'active' | 'done' | 'archived'
export type Health = 'green' | 'amber' | 'red'

export interface Project {
  id: string
  user_id: string
  name: string
  description: string | null
  stage: Stage
  status: Health
  next_action: string | null
  ice_impact: number | null
  ice_confidence: number | null
  ice_ease: number | null
  ice_score: number
  deadline: string | null
  url: string | null
  tags: string[]
  repo_full_name: string | null
  repo_pushed_at: string | null
  last_reviewed_at: string
  created_at: string
  updated_at: string
}

export type ProjectDraft = Pick<
  Project,
  | 'name'
  | 'description'
  | 'stage'
  | 'status'
  | 'next_action'
  | 'ice_impact'
  | 'ice_confidence'
  | 'ice_ease'
  | 'deadline'
  | 'url'
  | 'repo_full_name'
  | 'repo_pushed_at'
> & { tags: string[] }

const STALE_DAYS = 14

export function isOnFire(p: Project): boolean {
  if (p.stage === 'done' || p.stage === 'archived') return false
  if (p.status === 'red') return true
  if (p.deadline && new Date(p.deadline) < new Date()) return true
  if (p.stage === 'active') {
    const daysSinceReview = (Date.now() - new Date(p.last_reviewed_at).getTime()) / 86_400_000
    if (daysSinceReview > STALE_DAYS) return true
    if (p.repo_pushed_at) {
      const daysSincePush = (Date.now() - new Date(p.repo_pushed_at).getTime()) / 86_400_000
      if (daysSincePush > STALE_DAYS) return true
    }
  }
  return false
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}
