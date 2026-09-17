export interface GithubRepo {
  id: number
  name: string
  full_name: string
  html_url: string
  private: boolean
  description: string | null
  pushed_at: string
}

export async function fetchGithubRepos(token: string): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = []
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    )
    if (!res.ok) {
      if (res.status === 401) throw new Error('GitHub token is invalid or expired')
      throw new Error(`GitHub API error: ${res.status}`)
    }
    const batch = (await res.json()) as GithubRepo[]
    repos.push(...batch)
    if (batch.length < 100) break
  }
  return repos
}
