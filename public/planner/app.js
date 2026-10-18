import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const STATUSES = [['backlog', 'Backlog'], ['todo', 'To do'], ['doing', 'In progress'], ['testing', 'Testing'], ['done', 'Done']];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const PRIOS = ['Low', 'Normal', 'High', 'Urgent'];
const COLOURS = ['#5b8def', '#e5739a', '#3fb68b', '#e0a23b', '#9b7be8', '#4cb7d6'];
const SILENT = new Set(['dependency', 'deleted', 'due_changed']);
const VIEWS = [['board', 'Board'], ['list', 'List'], ['ready', 'Next up'], ['projects', 'Projects'], ['activity', 'Activity']];

const TEMPLATES = [
  {
    id: 'test-demo', name: 'Test and demo cycle',
    desc: 'Final testing, fixes, a first demo, feedback and agreeing next steps.',
    tasks: [
      { k: 'a', title: 'Final testing pass', labels: ['test'], status: 'todo', after: [] },
      { k: 'b', title: 'Fix issues found in testing', labels: ['bug'], after: ['a'] },
      { k: 'c', title: 'Write demo script and checklist', labels: ['demo'], status: 'todo', after: [] },
      { k: 'd', title: 'Prepare demo data and accounts', labels: ['demo'], after: ['b'] },
      { k: 'e', title: 'Run first demo', labels: ['demo'], after: ['b', 'c', 'd'] },
      { k: 'f', title: 'Collect feedback', after: ['e'] },
      { k: 'g', title: 'Agree next steps', after: ['f'] },
    ],
  },
  {
    id: 'launch', name: 'Launch checklist',
    desc: 'Everything between "it works" and "people are using it".',
    tasks: [
      { k: 'a', title: 'Decide the launch audience', status: 'todo', after: [] },
      { k: 'b', title: 'Final copy and screenshots', status: 'todo', after: [] },
      { k: 'c', title: 'Set up analytics and error alerts', after: [] },
      { k: 'd', title: 'Soft launch to a few people', after: ['a', 'b', 'c'] },
      { k: 'e', title: 'Review feedback and fix top issues', after: ['d'] },
      { k: 'f', title: 'Public launch', after: ['e'] },
    ],
  },
  {
    id: 'idea', name: 'New idea to MVP',
    desc: 'Validate, scope, build a first version, then test it.',
    tasks: [
      { k: 'a', title: 'Write the one line pitch', status: 'todo', after: [] },
      { k: 'b', title: 'Talk to three likely users', after: ['a'] },
      { k: 'c', title: 'Scope the first version', after: ['b'] },
      { k: 'd', title: 'Build the first version', after: ['c'] },
      { k: 'e', title: 'Test with real people', labels: ['test'], after: ['d'] },
    ],
  },
];

// An invite link looks like /planner/?join=CODE. Keep the code until it has been used.
try {
  const j = new URLSearchParams(location.search).get('join');
  if (j) {
    localStorage.setItem('planner-join', j.toUpperCase().slice(0, 12));
    history.replaceState(null, '', location.pathname + location.hash);
  }
} catch { /* storage unavailable */ }
const pendingJoin = () => { try { return localStorage.getItem('planner-join') || ''; } catch { return ''; } };

const state = {
  user: null, ws: null, members: [], invites: [], me: null,
  projects: new Map(), tasks: new Map(), deps: [], comments: [], activity: [],
  view: 'board', fProject: 'all', fWho: 'all', q: '', openTask: null, offline: false,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();

function toast(msg, isErr = false, action) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.innerHTML = `<span style="flex:1">${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', el).addEventListener('click', () => { action.run(); el.remove(); });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), isErr ? 7000 : 5000);
}

/* ---------- helpers ---------- */
const pendingAsMember = (i) => ({ user_id: i.id, display_name: i.display_name, colour: i.colour, pending: true, email: i.email });
const member = (id) => state.members.find((m) => m.user_id === id)
  || (() => { const i = state.invites.find((x) => x.id === id); return i ? pendingAsMember(i) : undefined; })();
const people = () => [...state.members, ...state.invites.map(pendingAsMember)];
const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const avatar = (m) => m ? `<span class="avatar${m.pending ? ' pending' : ''}" style="background:${esc(m.colour)}" title="${esc(m.display_name)}${m.pending ? ' (invited)' : ''}">${esc(initials(m.display_name))}</span>` : '';
const avatars = (ids) => ids.length ? `<span class="avatars">${ids.map((i) => avatar(member(i))).join('')}</span>` : '';
const taskList = () => [...state.tasks.values()];

function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function dueInfo(t) {
  if (!t.due_date) return null;
  const d = parseDate(t.due_date);
  const label = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (t.status === 'done') return { label, cls: 'mute' };
  const diff = Math.round((d - today()) / 86400000);
  if (diff < 0) return { label: `${label} (overdue)`, cls: 'bad' };
  if (diff <= 2) return { label: diff === 0 ? 'Today' : label, cls: 'warn' };
  return { label, cls: '' };
}
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function waitingFor(id) {
  return state.deps.filter((d) => d.task_id === id).map((d) => state.tasks.get(d.depends_on_id)).filter(Boolean);
}
const openBlockers = (id) => waitingFor(id).filter((t) => t.status !== 'done');
const blocking = (id) => state.deps.filter((d) => d.depends_on_id === id).map((d) => state.tasks.get(d.task_id)).filter(Boolean);
function waitsTransitively(a, b, seen = new Set()) {
  if (a === b) return true;
  if (seen.has(a)) return false;
  seen.add(a);
  return state.deps.some((d) => d.task_id === a && waitsTransitively(d.depends_on_id, b, seen));
}

function sortTasks(list) {
  return list.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

function visibleTasks() {
  const q = state.q.trim().toLowerCase();
  return taskList().filter((t) => {
    const p = t.project_id ? state.projects.get(t.project_id) : null;
    if (state.fProject === 'all') { if (p && p.archived) return false; }
    else if (state.fProject === 'none') { if (t.project_id) return false; }
    else if (t.project_id !== state.fProject) return false;
    if (state.fWho === 'me' && !t.assignees.includes(state.user.id)) return false;
    if (state.fWho === 'none' && t.assignees.length) return false;
    if (q && !(`${t.title} ${t.description} ${t.labels.join(' ')}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

/* ---------- loading ---------- */
async function loadWorkspace() {
  const { data, error } = await sb.from('pl_members').select('*, pl_workspaces(*)').eq('user_id', state.user.id).limit(1);
  if (error) throw error;
  if (!data.length) return false;
  state.ws = data[0].pl_workspaces;
  return true;
}

async function loadAll() {
  const ws = state.ws.id;
  try {
    const [m, p, t, d, c, a, inv] = await Promise.all([
      sb.from('pl_members').select('*').eq('workspace_id', ws),
      sb.from('pl_projects').select('*').eq('workspace_id', ws).order('created_at'),
      sb.from('pl_tasks').select('*').eq('workspace_id', ws),
      sb.from('pl_dependencies').select('*').eq('workspace_id', ws),
      sb.from('pl_comments').select('*').eq('workspace_id', ws).order('created_at'),
      sb.from('pl_activity').select('*').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(80),
      sb.from('pl_invites').select('*').eq('workspace_id', ws),
    ]);
    const err = [m, p, t, d, c, a, inv].find((r) => r.error);
    if (err) throw err.error;
    state.members = m.data;
    state.invites = inv.data;
    state.projects = new Map(p.data.map((x) => [x.id, x]));
    state.tasks = new Map(t.data.map((x) => [x.id, x]));
    state.deps = d.data;
    state.comments = c.data;
    state.activity = a.data;
    state.offline = false;
    try { localStorage.setItem('planner-snapshot', JSON.stringify({ ws: state.ws, members: m.data, projects: p.data, tasks: t.data, deps: d.data, comments: c.data, activity: a.data, invites: inv.data })); } catch { /* storage unavailable */ }
  } catch (e) {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem('planner-snapshot')); } catch { /* ignore */ }
    if (!snap) throw e;
    state.members = snap.members; state.projects = new Map(snap.projects.map((x) => [x.id, x]));
    state.tasks = new Map(snap.tasks.map((x) => [x.id, x])); state.deps = snap.deps;
    state.comments = snap.comments; state.activity = snap.activity; state.invites = snap.invites || []; state.offline = true;
  }
  state.me = member(state.user.id);
}

/* ---------- realtime ---------- */
let channel;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('planner-' + state.ws.id);
  const on = (table, fn) => channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => { fn(p); onRemoteChange(table); });
  on('pl_tasks', (p) => { p.eventType === 'DELETE' ? state.tasks.delete(p.old.id) : state.tasks.set(p.new.id, p.new); });
  on('pl_projects', (p) => { p.eventType === 'DELETE' ? state.projects.delete(p.old.id) : state.projects.set(p.new.id, p.new); });
  on('pl_dependencies', (p) => {
    const same = (d, r) => d.task_id === r.task_id && d.depends_on_id === r.depends_on_id;
    if (p.eventType === 'DELETE') state.deps = state.deps.filter((d) => !same(d, p.old));
    else if (!state.deps.some((d) => same(d, p.new))) state.deps.push(p.new);
  });
  on('pl_comments', (p) => {
    if (p.eventType === 'DELETE') state.comments = state.comments.filter((c) => c.id !== p.old.id);
    else if (!state.comments.some((c) => c.id === p.new.id)) state.comments.push(p.new);
  });
  on('pl_invites', (p) => {
    if (p.eventType === 'DELETE') state.invites = state.invites.filter((i) => i.id !== p.old.id);
    else { state.invites = state.invites.filter((i) => i.id !== p.new.id); state.invites.push(p.new); }
  });
  on('pl_members', (p) => {
    if (p.eventType === 'DELETE') return;
    const i = state.members.findIndex((m) => m.user_id === p.new.user_id);
    if (i >= 0) state.members[i] = p.new; else state.members.push(p.new);
    state.me = member(state.user.id);
  });
  on('pl_activity', (p) => {
    if (p.eventType !== 'INSERT') return;
    state.activity.unshift(p.new);
    if (p.new.actor_id !== state.user.id && !SILENT.has(p.new.kind) && state.me?.notify_level !== 'off' && document.visibilityState === 'visible') {
      toast(p.new.message, false, p.new.task_id ? { label: 'Open', run: () => openTaskDlg(p.new.task_id) } : null);
    }
  });
  channel.subscribe();
}

let renderQueued = false;
let dragging = false;
function onRemoteChange() {
  if (dragging || renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
    const dlg = $('#taskDlg');
    if (dlg.open && !dlg.contains(document.activeElement?.closest?.('input, textarea, select'))) renderTaskDlg();
  });
}

/* ---------- mutations ---------- */
let pushTimer;
function flushPush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    sb.functions.invoke('planner-push', { body: { workspace_id: state.ws.id } }).catch(() => {});
  }, 500);
}

async function run(promise, okMsg) {
  const { error } = await promise;
  if (error) { toast(error.message, true); await loadAll(); render(); return false; }
  if (okMsg) toast(okMsg);
  flushPush();
  return true;
}

async function patchTask(id, patch) {
  const t = state.tasks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  if ('status' in patch) t.completed_at = patch.status === 'done' ? new Date().toISOString() : null;
  render();
  await run(sb.from('pl_tasks').update(patch).eq('id', id));
}

function moveTask(id, status, position) {
  const t = state.tasks.get(id);
  if (!t) return;
  if (status !== t.status && ['doing', 'testing', 'done'].includes(status)) {
    const open = openBlockers(id);
    if (open.length && !confirm(`"${t.title}" is waiting for ${open.map((b) => `"${b.title}"`).join(', ')}. Move it anyway?`)) { render(); return; }
  }
  patchTask(id, { status, position });
}

function nextPosition(status) {
  const col = taskList().filter((t) => t.status === status);
  return col.length ? Math.max(...col.map((t) => t.position)) + 1000 : 1000;
}

async function addTask(status, title) {
  title = title.trim();
  if (!title) return;
  const t = {
    id: uid(), workspace_id: state.ws.id, project_id: ['all', 'none'].includes(state.fProject) ? null : state.fProject,
    title, description: '', status, position: nextPosition(status), priority: 1, due_date: null,
    assignees: state.fWho === 'me' ? [state.user.id] : [], labels: [], checklist: [],
    created_by: state.user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null,
  };
  state.tasks.set(t.id, t);
  render();
  const { id, created_at, updated_at, completed_at, ...row } = t;
  await run(sb.from('pl_tasks').insert({ id, ...row }));
}

async function deleteTask(id) {
  const t = state.tasks.get(id);
  if (!t || !confirm(`Delete "${t.title}"? This cannot be undone.`)) return;
  state.tasks.delete(id);
  state.deps = state.deps.filter((d) => d.task_id !== id && d.depends_on_id !== id);
  $('#taskDlg').close();
  render();
  await run(sb.from('pl_tasks').delete().eq('id', id));
}

async function addDep(taskId, dependsOn) {
  if (waitsTransitively(dependsOn, taskId)) { toast('That would create a loop', true); return; }
  state.deps.push({ task_id: taskId, depends_on_id: dependsOn, workspace_id: state.ws.id });
  render(); renderTaskDlg();
  await run(sb.from('pl_dependencies').insert({ task_id: taskId, depends_on_id: dependsOn, workspace_id: state.ws.id }));
}

async function removeDep(taskId, dependsOn) {
  state.deps = state.deps.filter((d) => !(d.task_id === taskId && d.depends_on_id === dependsOn));
  render(); renderTaskDlg();
  await run(sb.from('pl_dependencies').delete().eq('task_id', taskId).eq('depends_on_id', dependsOn));
}

/* ---------- rendering ---------- */
function render() {
  if (!state.user || !state.ws) return;
  renderChrome();
  const view = $('#view');
  const scroll = $('.board', view)?.scrollLeft;
  view.innerHTML = ({ board: renderBoard, list: renderList, ready: renderReady, projects: renderProjects, activity: renderActivity }[state.view])();
  if (scroll) $('.board', view).scrollLeft = scroll;
  const unread = unreadCount();
  const badge = $('#bellBadge');
  badge.hidden = !unread;
  badge.textContent = unread > 9 ? '9+' : unread;
  if ('setAppBadge' in navigator) (unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => {});
}

function renderChrome() {
  $('#tabs').innerHTML = VIEWS.map(([k, l]) => `<button class="tab" data-view="${k}" ${state.view === k ? 'aria-current="page"' : ''}>${l}</button>`).join('');
  const projOpts = [...state.projects.values()].filter((p) => !p.archived || state.fProject === p.id);
  const sel = $('#fProject');
  const cur = state.fProject;
  sel.innerHTML = `<option value="all">All projects</option>${projOpts.map((p) => `<option value="${p.id}">${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}<option value="none">No project</option>`;
  sel.value = cur;
  $('#fWho').innerHTML = [['all', 'Everyone'], ['me', 'Mine'], ['none', 'Unassigned']]
    .map(([k, l]) => `<button type="button" data-who="${k}" aria-pressed="${state.fWho === k}">${l}</button>`).join('');
  $('#meBtn').innerHTML = avatar(state.me);
  $('#toolbar').hidden = state.view === 'activity';
  if (state.offline && !$('#offlineBar')) {
    $('#toolbar').insertAdjacentHTML('beforebegin', '<p id="offlineBar" class="msg" style="padding:6px 16px;margin:0">Offline. Showing the last saved copy.</p>');
  } else if (!state.offline) $('#offlineBar')?.remove();
}

function cardHTML(t, showProject) {
  const due = dueInfo(t);
  const blockers = t.status === 'done' ? [] : openBlockers(t.id);
  const blocks = blocking(t.id).filter((b) => b.status !== 'done').length;
  const cl = t.checklist || [];
  const proj = showProject && t.project_id ? state.projects.get(t.project_id) : null;
  return `<button type="button" class="card${t.status === 'done' ? ' is-done' : ''}${blockers.length ? ' is-blocked' : ''}" data-id="${t.id}" data-prio="${t.priority}">
    ${proj ? `<div class="proj">${esc(proj.emoji)} ${esc(proj.name)}</div>` : ''}
    <div class="t">${esc(t.title)}</div>
    <div class="meta">
      ${blockers.length ? `<span class="pill bad" title="${esc(blockers.map((b) => b.title).join(', '))}">Waiting on ${blockers.length}</span>` : ''}
      ${blocks ? `<span class="pill mute">Blocks ${blocks}</span>` : ''}
      ${due ? `<span class="pill ${due.cls}">${esc(due.label)}</span>` : ''}
      ${cl.length ? `<span class="pill mute">${cl.filter((c) => c.done).length}/${cl.length}</span>` : ''}
      ${t.labels.slice(0, 2).map((l) => `<span class="pill mute">${esc(l)}</span>`).join('')}
      <span class="grow"></span>${avatars(t.assignees)}
    </div>
  </button>`;
}

function renderBoard() {
  const tasks = visibleTasks();
  const showProject = state.fProject === 'all';
  return `<div class="board" id="board">${STATUSES.map(([k, label]) => {
    const col = sortTasks(tasks.filter((t) => t.status === k));
    return `<section class="col" data-status="${k}" aria-label="${label}">
      <div class="col-head"><span>${label}</span><span class="count">${col.length}</span></div>
      <div class="col-cards">${col.map((t) => cardHTML(t, showProject)).join('')}</div>
      <form class="quick" data-status="${k}"><input name="title" placeholder="+ Add a task" aria-label="Add a task to ${label}" autocomplete="off"></form>
    </section>`;
  }).join('')}</div>`;
}

function renderList() {
  const tasks = visibleTasks().sort((a, b) => STATUSES.findIndex((s) => s[0] === a.status) - STATUSES.findIndex((s) => s[0] === b.status) || b.priority - a.priority || a.position - b.position);
  if (!tasks.length) return '<div class="empty">No tasks match these filters.</div>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Who</th><th>Due</th><th>Priority</th></tr></thead><tbody>
    ${tasks.map((t) => {
      const p = t.project_id ? state.projects.get(t.project_id) : null;
      const due = dueInfo(t);
      const blockers = t.status === 'done' ? [] : openBlockers(t.id);
      return `<tr data-id="${t.id}"><td><button type="button" class="link" data-open="${t.id}">${esc(t.title)}</button> ${blockers.length ? `<span class="pill bad">Waiting on ${blockers.length}</span>` : ''}</td>
        <td>${p ? `${esc(p.emoji)} ${esc(p.name)}` : '<span class="muted">None</span>'}</td>
        <td><span class="pill ${t.status === 'done' ? 'ok' : ''}">${STATUS_LABEL[t.status]}</span></td>
        <td>${avatars(t.assignees)}</td><td>${due ? `<span class="pill ${due.cls}">${esc(due.label)}</span>` : ''}</td><td>${PRIOS[t.priority]}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function row(t, extra = '') {
  const p = t.project_id ? state.projects.get(t.project_id) : null;
  const due = dueInfo(t);
  return `<button type="button" class="feed-item" data-open="${t.id}">
    <span style="flex:1"><strong>${esc(t.title)}</strong><br><span class="muted">${p ? esc(p.emoji + ' ' + p.name) + ' · ' : ''}${STATUS_LABEL[t.status]}${extra}</span></span>
    ${due ? `<span class="pill ${due.cls}">${esc(due.label)}</span>` : ''}${avatars(t.assignees)}</button>`;
}

function renderReady() {
  const tasks = visibleTasks().filter((t) => t.status !== 'done');
  const ready = tasks.filter((t) => ['backlog', 'todo'].includes(t.status) && !openBlockers(t.id).length)
    .sort((a, b) => b.priority - a.priority || (a.due_date || '9').localeCompare(b.due_date || '9'));
  const inFlight = tasks.filter((t) => ['doing', 'testing'].includes(t.status));
  const blocked = tasks.filter((t) => openBlockers(t.id).length);
  const overdue = tasks.filter((t) => t.due_date && parseDate(t.due_date) < today());
  const section = (title, list, fn = row) => list.length ? `<h2 class="group-title">${title} (${list.length})</h2><div class="stack">${list.map((t) => fn(t)).join('')}</div>` : '';
  const html = section('Ready to start, nothing is blocking these', ready)
    + section('In progress and testing', inFlight)
    + section('Blocked', blocked, (t) => row(t, ` · waiting for ${esc(openBlockers(t.id).map((b) => b.title).join(', '))}`))
    + section('Overdue', overdue);
  return html || '<div class="empty">Nothing outstanding. Add tasks on the Board, or start from a template.</div>';
}

function renderProjects() {
  const ps = [...state.projects.values()];
  const cards = ps.map((p) => {
    const ts = taskList().filter((t) => t.project_id === p.id);
    const done = ts.filter((t) => t.status === 'done').length;
    const pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
    const blocked = ts.filter((t) => t.status !== 'done' && openBlockers(t.id).length).length;
    const overdue = ts.filter((t) => t.status !== 'done' && t.due_date && parseDate(t.due_date) < today()).length;
    return `<div class="proj-card" ${p.archived ? 'style="opacity:.6"' : ''}>
      <div class="row between"><h3>${esc(p.emoji)} ${esc(p.name)}</h3><button class="link" data-edit-project="${p.id}">Edit</button></div>
      <p class="muted" style="margin:0">${esc(p.description) || 'No description'}</p>
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress"><i style="width:${pct}%"></i></div>
      <div class="meta"><span>${done}/${ts.length} done</span>${blocked ? `<span class="pill bad">${blocked} blocked</span>` : ''}${overdue ? `<span class="pill warn">${overdue} overdue</span>` : ''}${p.archived ? '<span class="pill mute">Archived</span>' : ''}</div>
      <button class="btn" data-goto-project="${p.id}">Open board</button></div>`;
  }).join('');
  return `<div class="proj-grid">${cards}</div>${ps.length ? '' : '<div class="empty">No projects yet. Create one to group tasks, or start from a template.</div>'}`;
}

function unreadCount() {
  const seen = state.me ? new Date(state.me.last_seen_activity).getTime() : 0;
  return state.activity.filter((a) => a.actor_id !== state.user.id && new Date(a.created_at).getTime() > seen).length;
}

function renderActivity() {
  const seen = state.me ? new Date(state.me.last_seen_activity).getTime() : 0;
  if (!state.activity.length) return '<div class="empty">Nothing has happened yet.</div>';
  return `<div class="stack" style="margin-top:12px">${state.activity.map((a) => {
    const who = member(a.actor_id);
    const unread = a.actor_id !== state.user.id && new Date(a.created_at).getTime() > seen;
    return `<button type="button" class="feed-item${unread ? ' unread' : ''}" ${a.task_id && state.tasks.has(a.task_id) ? `data-open="${a.task_id}"` : ''}>
      ${avatar(who)}<span style="flex:1">${esc(a.message)}<br><span class="when">${ago(a.created_at)}</span></span></button>`;
  }).join('')}</div>`;
}

async function markSeen() {
  if (!state.me || !unreadCount()) return;
  const now = new Date().toISOString();
  state.me.last_seen_activity = now;
  await sb.from('pl_members').update({ last_seen_activity: now }).eq('workspace_id', state.ws.id).eq('user_id', state.user.id);
}

/* ---------- task dialog ---------- */
function openTaskDlg(id) {
  if (!state.tasks.has(id)) return;
  state.openTask = id;
  renderTaskDlg();
  const dlg = $('#taskDlg');
  if (!dlg.open) dlg.showModal();
  history.replaceState(null, '', `#task=${id}`);
}

function renderTaskDlg() {
  const t = state.tasks.get(state.openTask);
  const dlg = $('#taskDlg');
  if (!t) { if (dlg.open) dlg.close(); return; }
  const waits = waitingFor(t.id);
  const blocks = blocking(t.id);
  const candidates = taskList().filter((o) => o.id !== t.id && !waits.some((w) => w.id === o.id) && !waitsTransitively(o.id, t.id))
    .sort((a, b) => (b.project_id === t.project_id) - (a.project_id === t.project_id) || a.title.localeCompare(b.title));
  const comments = state.comments.filter((c) => c.task_id === t.id);
  const cl = t.checklist || [];
  dlg.innerHTML = `<div class="dlg">
    <div class="dlg-head"><h2 id="tdTitle" class="sr" hidden>Task</h2>
      <input class="title" data-f="title" value="${esc(t.title)}" aria-label="Title">
      <button class="icon-btn" data-act="close" aria-label="Close">✕</button></div>
    <div class="dlg-body">
      <div class="fields">
        <label>Status<select data-f="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Priority<select data-f="priority">${PRIOS.map((l, i) => `<option value="${i}" ${t.priority === i ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Due date<input type="date" data-f="due_date" value="${t.due_date || ''}"></label>
        <label>Project<select data-f="project_id"><option value="">No project</option>${[...state.projects.values()].map((p) => `<option value="${p.id}" ${t.project_id === p.id ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></label>
      </div>
      <div class="sec"><h4>Assigned to</h4><div class="chips">${people().map((m) => `<button type="button" class="chip" data-assign="${m.user_id}" aria-pressed="${t.assignees.includes(m.user_id)}">${avatar(m)}${esc(m.display_name)}${m.pending ? ' <span class="muted">(invited)</span>' : ''}</button>`).join('')}<button type="button" class="chip" data-act="invite">+ Invite someone</button></div></div>
      <div class="sec"><h4>Labels</h4><input data-f="labels" value="${esc(t.labels.join(', '))}" placeholder="test, demo, bug (comma separated)" aria-label="Labels"></div>
      <div class="sec"><h4>Notes</h4><textarea data-f="description" aria-label="Notes" placeholder="Details, links, decisions">${esc(t.description)}</textarea></div>
      <div class="sec"><h4>Checklist ${cl.length ? `(${cl.filter((c) => c.done).length}/${cl.length})` : ''}</h4><div class="stack">
        ${cl.map((c) => `<div class="item${c.done ? ' done' : ''}"><input type="checkbox" data-check="${c.id}" ${c.done ? 'checked' : ''} aria-label="${esc(c.text)}"><span class="grow">${esc(c.text)}</span><button class="x" data-uncheck="${c.id}" aria-label="Remove ${esc(c.text)}">✕</button></div>`).join('')}
        <form class="row" data-form="check"><input name="text" placeholder="Add a checklist item" aria-label="New checklist item" autocomplete="off"><button class="btn">Add</button></form></div></div>
      <div class="sec"><h4>Must be finished first</h4><div class="stack">
        ${waits.map((w) => `<div class="item"><span class="pill ${w.status === 'done' ? 'ok' : 'bad'}">${w.status === 'done' ? 'Done' : STATUS_LABEL[w.status]}</span><button class="link grow" data-open="${w.id}">${esc(w.title)}</button><button class="x" data-rmdep="${w.id}" aria-label="Remove dependency on ${esc(w.title)}">✕</button></div>`).join('')}
        ${candidates.length ? `<form class="row" data-form="dep"><select name="dep" aria-label="Add a task this one must wait for"><option value="">Wait for another task...</option>${candidates.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select><button class="btn">Add</button></form>` : ''}</div></div>
      ${blocks.length ? `<div class="sec"><h4>This is blocking</h4><div class="stack">${blocks.map((b) => `<div class="item"><span class="pill mute">${STATUS_LABEL[b.status]}</span><button class="link grow" data-open="${b.id}">${esc(b.title)}</button></div>`).join('')}</div></div>` : ''}
      <div class="sec"><h4>Comments</h4><div class="stack">
        ${comments.map((c) => `<div class="comment">${avatar(member(c.user_id))}<div style="flex:1"><div class="who">${esc(member(c.user_id)?.display_name || 'Someone')} · ${ago(c.created_at)}</div><div class="bubble">${esc(c.body)}</div></div></div>`).join('')}
        <form data-form="comment" class="row"><input name="body" placeholder="Write a comment" aria-label="Comment" autocomplete="off"><button class="btn primary">Send</button></form></div></div>
    </div>
    <div class="dlg-foot"><button class="btn danger" data-act="delete">Delete task</button><button class="btn" data-act="close">Done</button></div></div>`;
}

function bindTaskDlg() {
  const dlg = $('#taskDlg');
  dlg.addEventListener('cancel', () => document.activeElement?.blur?.());
  dlg.addEventListener('close', () => { state.openTask = null; history.replaceState(null, '', location.pathname); render(); });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    const t = state.tasks.get(state.openTask);
    if (b.dataset.act === 'close') dlg.close();
    else if (b.dataset.act === 'delete') deleteTask(t.id);
    else if (b.dataset.act === 'invite') { dlg.close(); openSettings(); }
    else if (b.dataset.open) openTaskDlg(b.dataset.open);
    else if (b.dataset.assign) {
      const has = t.assignees.includes(b.dataset.assign);
      patchTask(t.id, { assignees: has ? t.assignees.filter((a) => a !== b.dataset.assign) : [...t.assignees, b.dataset.assign] }).then(renderTaskDlg);
      renderTaskDlg();
    } else if (b.dataset.uncheck) patchTask(t.id, { checklist: t.checklist.filter((c) => c.id !== b.dataset.uncheck) }).then(renderTaskDlg);
    else if (b.dataset.rmdep) removeDep(t.id, b.dataset.rmdep);
  });
  dlg.addEventListener('change', (e) => {
    const t = state.tasks.get(state.openTask);
    if (!t) return;
    const el = e.target;
    if (el.dataset.check) {
      patchTask(t.id, { checklist: t.checklist.map((c) => c.id === el.dataset.check ? { ...c, done: el.checked } : c) }).then(renderTaskDlg);
      return;
    }
    const f = el.dataset.f;
    if (!f) return;
    let v = el.value;
    if (f === 'title') { v = v.trim(); if (!v) { el.value = t.title; return; } }
    if (f === 'priority') v = Number(v);
    if (f === 'due_date' || f === 'project_id') v = v || null;
    if (f === 'labels') v = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (f === 'status') {
      moveTask(t.id, v, nextPosition(v));
      renderTaskDlg();
      return;
    }
    patchTask(t.id, { [f]: v });
  });
  dlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = state.tasks.get(state.openTask);
    const form = e.target;
    const kind = form.dataset.form;
    if (kind === 'check') {
      const text = form.text.value.trim();
      if (text) patchTask(t.id, { checklist: [...t.checklist, { id: uid(), text, done: false }] }).then(renderTaskDlg);
    } else if (kind === 'dep') {
      if (form.dep.value) addDep(t.id, form.dep.value);
    } else if (kind === 'comment') {
      const body = form.body.value.trim();
      if (!body) return;
      const c = { id: uid(), task_id: t.id, workspace_id: state.ws.id, user_id: state.user.id, body, created_at: new Date().toISOString() };
      state.comments.push(c);
      renderTaskDlg();
      run(sb.from('pl_comments').insert(c));
    }
  });
}

/* ---------- projects, templates ---------- */
function openProjectDlg(id) {
  const p = id ? state.projects.get(id) : null;
  const dlg = $('#projDlg');
  dlg.innerHTML = `<form class="dlg" method="dialog" id="projForm"><div class="dlg-head"><h2 id="pdTitle" style="margin:0">${p ? 'Edit project' : 'New project'}</h2></div>
    <div class="dlg-body">
      <div class="row"><label style="width:84px">Emoji<input name="emoji" value="${esc(p?.emoji || '📁')}" maxlength="4"></label><label style="flex:1">Name<input name="name" value="${esc(p?.name || '')}" required></label></div>
      <label>Description<textarea name="description">${esc(p?.description || '')}</textarea></label>
      ${p ? `<label class="row" style="flex-direction:row;align-items:center"><input type="checkbox" name="archived" ${p.archived ? 'checked' : ''} style="min-height:auto"> Archived (hides it and its tasks from the board)</label>` : ''}
    </div>
    <div class="dlg-foot"><button class="btn" value="cancel" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${p ? 'Save' : 'Create project'}</button></div></form>`;
  dlg.showModal();
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  $('#projForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const row = { name: f.name.value.trim(), emoji: f.emoji.value.trim() || '📁', description: f.description.value.trim() };
    if (!row.name) return;
    dlg.close();
    if (p) {
      Object.assign(p, row, { archived: !!f.archived?.checked });
      render();
      await run(sb.from('pl_projects').update({ ...row, archived: p.archived }).eq('id', p.id));
    } else {
      const np = { id: uid(), workspace_id: state.ws.id, colour: '#5b8def', archived: false, created_at: new Date().toISOString(), ...row };
      state.projects.set(np.id, np);
      state.fProject = np.id;
      render();
      const { created_at, ...ins } = np;
      await run(sb.from('pl_projects').insert(ins));
    }
  });
}

function openTemplateDlg() {
  const dlg = $('#tplDlg');
  const projects = [...state.projects.values()].filter((p) => !p.archived);
  dlg.innerHTML = `<form class="dlg" id="tplForm"><div class="dlg-head"><h2 id="tpTitle" style="margin:0">Start from a template</h2></div>
    <div class="dlg-body">
      <div class="stack">${TEMPLATES.map((t, i) => `<label class="item" style="flex-direction:row;align-items:flex-start;color:var(--text)"><input type="radio" name="tpl" value="${t.id}" ${i === 0 ? 'checked' : ''} style="min-height:auto;margin-top:4px"><span><strong>${esc(t.name)}</strong> <span class="muted">(${t.tasks.length} tasks, with dependencies)</span><br><span class="muted" style="font-weight:400">${esc(t.desc)}</span></span></label>`).join('')}</div>
      <label>Add to project<select name="project"><option value="">Create a new project from this</option>${projects.map((p) => `<option value="${p.id}" ${state.fProject === p.id ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></label>
      <label>New project name (if creating)<input name="pname" placeholder="e.g. Recipes demo"></label>
    </div>
    <div class="dlg-foot"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Add tasks</button></div></form>`;
  dlg.showModal();
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  $('#tplForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const tpl = TEMPLATES.find((t) => t.id === f.tpl.value);
    let projectId = f.project.value;
    dlg.close();
    if (!projectId) {
      const np = { id: uid(), workspace_id: state.ws.id, name: f.pname.value.trim() || tpl.name, emoji: '🚀', colour: '#5b8def', description: tpl.desc, archived: false };
      if (!(await run(sb.from('pl_projects').insert(np)))) return;
      projectId = np.id;
    }
    const ids = Object.fromEntries(tpl.tasks.map((t) => [t.k, uid()]));
    const rows = tpl.tasks.map((t, i) => ({
      id: ids[t.k], workspace_id: state.ws.id, project_id: projectId, title: t.title, status: t.status || 'backlog',
      position: nextPosition(t.status || 'backlog') + i, labels: t.labels || [], assignees: [], checklist: [],
    }));
    if (!(await run(sb.from('pl_tasks').insert(rows)))) return;
    const deps = tpl.tasks.flatMap((t) => t.after.map((a) => ({ task_id: ids[t.k], depends_on_id: ids[a], workspace_id: state.ws.id })));
    if (deps.length) await run(sb.from('pl_dependencies').insert(deps));
    state.fProject = projectId;
    state.view = 'board';
    await loadAll();
    render();
    toast(`Added ${rows.length} tasks`);
  });
}

/* ---------- settings and push ---------- */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function enablePush() {
  const reg = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from('pl_push_subscriptions').upsert(
    { user_id: state.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
    { onConflict: 'endpoint' });
  if (error) throw error;
}

async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await sb.from('pl_push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
}

async function openSettings() {
  const dlg = $('#setDlg');
  const ps = await pushStatus();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const iosBrowser = /iphone|ipad/i.test(navigator.userAgent) && !standalone;
  dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h2 id="sdTitle" style="margin:0;flex:1">Settings</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="dlg-body">
      <div class="fields"><label>Your name<input id="sName" value="${esc(state.me.display_name)}"></label>
        <label>Notify me about<select id="sLevel"><option value="all" ${state.me.notify_level === 'all' ? 'selected' : ''}>Everything</option><option value="mine" ${state.me.notify_level === 'mine' ? 'selected' : ''}>Only my tasks</option><option value="off" ${state.me.notify_level === 'off' ? 'selected' : ''}>Nothing</option></select></label></div>
      <div class="sec"><h4>Colour</h4><div class="chips">${COLOURS.map((c) => `<button type="button" class="chip" data-colour="${c}" aria-pressed="${state.me.colour === c}" aria-label="Colour ${c}"><span class="avatar" style="background:${c}">${esc(initials(state.me.display_name))}</span></button>`).join('')}</div></div>
      <div class="sec"><h4>Push notifications on this device</h4>
        ${ps === 'unsupported' ? `<p class="hint">${iosBrowser ? 'On iPhone, add this page to your Home Screen first (Share, then Add to Home Screen), then open it from there to turn on notifications.' : 'This browser does not support push notifications.'}</p>`
          : ps === 'denied' ? '<p class="hint">Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</p>'
          : `<div class="row"><button class="btn ${ps === 'on' ? '' : 'primary'}" id="pushToggle">${ps === 'on' ? 'Turn off on this device' : 'Turn on notifications'}</button>${ps === 'on' ? '<button class="btn" id="pushTest">Send a test</button>' : ''}</div>`}
        ${installPrompt ? '<div class="row" style="margin-top:8px"><button class="btn" id="installBtn">Install the app</button></div>' : ''}
      </div>
      <div class="sec"><h4>Invite someone by email</h4>
        <form class="stack" id="inviteForm"><div class="row"><input id="sInviteName" placeholder="Their name" aria-label="Their name" required><input id="sInvite" type="email" placeholder="their@email.com" aria-label="Email address to invite" required></div><div class="row"><button class="btn primary" type="submit">Send invite</button></div></form>
        <p class="hint" id="inviteMsg" role="status">They get a sign-in email that brings them straight into "${esc(state.ws.name)}". You can assign tasks to them straight away, and those tasks become theirs when they join.</p>
        ${state.invites.length ? `<div class="stack" style="margin-top:8px">${state.invites.map((i) => `<div class="item">${avatar(pendingAsMember(i))}<span class="grow">${esc(i.display_name)} <span class="muted">${esc(i.email)}, waiting to join</span></span><button class="btn" data-resend="${i.id}">Resend</button><button class="x" data-rminvite="${i.id}" aria-label="Remove invite for ${esc(i.display_name)}">✕</button></div>`).join('')}</div>` : ''}</div>
      <div class="sec"><h4>Invite code</h4><div class="row"><span class="code">${esc(state.ws.invite_code)}</span><button class="btn" id="copyCode">Copy</button></div><p class="hint">Share this with someone so they can join "${esc(state.ws.name)}" after creating their account. ${state.members.length} member${state.members.length === 1 ? '' : 's'} so far: ${esc(state.members.map((m) => m.display_name).join(', '))}.</p></div>
    </div>
    <div class="dlg-foot"><button class="btn" id="signOut">Sign out</button><button class="btn primary" data-close>Done</button></div></div>`;
  dlg.showModal();
  dlg.onclick = async (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.colour) { await updateMe({ colour: b.dataset.colour }); openSettings(); }
      else if (b.id === 'pushToggle') { ps === 'on' ? await disablePush() : await enablePush(); openSettings(); }
      else if (b.id === 'pushTest') { const reg = await navigator.serviceWorker.ready; reg.showNotification('AB Planner', { body: 'Notifications are working on this device.', icon: 'icons/icon-192.png' }); }
      else if (b.id === 'installBtn') { installPrompt.prompt(); installPrompt = null; dlg.close(); }
      else if (b.id === 'copyCode') { await navigator.clipboard.writeText(state.ws.invite_code); toast('Invite code copied'); }
      else if (b.dataset.resend) { const i = state.invites.find((x) => x.id === b.dataset.resend); const e = await sendInvite(i.email, i.display_name); if (e) toast(e, true); }
      else if (b.dataset.rminvite) { const id = b.dataset.rminvite; state.invites = state.invites.filter((i) => i.id !== id); await run(sb.from('pl_invites').delete().eq('id', id)); render(); openSettings(); }
      else if (b.id === 'signOut') { dlg.close(); await sb.auth.signOut(); }
    } catch (err) { toast(err.message || 'Something went wrong', true); }
  };
  dlg.onsubmit = async (e) => {
    if (e.target.id !== 'inviteForm') return;
    e.preventDefault();
    const msg = $('#inviteMsg');
    const email = $('#sInvite').value.trim().toLowerCase();
    const name = $('#sInviteName').value.trim();
    if (!email || !name) return;
    msg.textContent = 'Sending...';
    const err = await sendInvite(email, name);
    if (err) { msg.textContent = `Could not send: ${err}`; return; }
    openSettings();
  };
  dlg.onchange = (e) => {
    if (e.target.id === 'sName' && e.target.value.trim()) updateMe({ display_name: e.target.value.trim() });
    if (e.target.id === 'sLevel') updateMe({ notify_level: e.target.value });
  };
}

async function sendInvite(email, name) {
  const existing = state.invites.find((i) => i.email === email);
  const row = { workspace_id: state.ws.id, email, display_name: name, colour: existing?.colour || COLOURS[(state.members.length + state.invites.length) % COLOURS.length] };
  const { data, error } = await sb.from('pl_invites').upsert(row, { onConflict: 'workspace_id,email' }).select().single();
  if (error) return error.message;
  state.invites = state.invites.filter((i) => i.id !== data.id).concat(data);
  const { error: mailErr } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}${location.pathname}?join=${encodeURIComponent(state.ws.invite_code)}` },
  });
  render();
  if (mailErr) return `${mailErr.message} (${name} is still added, so you can assign tasks to them)`;
  toast(`Invite sent to ${email}`);
  return null;
}

async function updateMe(patch) {
  Object.assign(state.me, patch);
  render();
  const { error } = await sb.from('pl_members').update(patch).eq('workspace_id', state.ws.id).eq('user_id', state.user.id);
  if (error) toast(error.message, true);
}

/* ---------- drag and drop (pointer based, works with touch) ---------- */
function bindDrag() {
  const view = $('#view');
  document.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });
  view.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });
  view.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card[data-id]');
    if (!card || e.button > 0) return;
    const touch = e.pointerType === 'touch';
    const sx = e.clientX, sy = e.clientY;
    let started = false, timer, ghost, ph, target = null, index = 0, moved = false;

    const begin = (ev) => {
      started = true; dragging = true;
      const r = card.getBoundingClientRect();
      ghost = card.cloneNode(true);
      ghost.classList.add('ghost');
      ghost.style.width = r.width + 'px';
      document.body.append(ghost);
      card.classList.add('dragging');
      ph = document.createElement('div'); ph.className = 'drop-ph';
      place(ev);
    };
    const place = (ev) => {
      ghost.style.left = ev.clientX - 40 + 'px';
      ghost.style.top = ev.clientY - 20 + 'px';
      const board = $('#board');
      const br = board.getBoundingClientRect();
      if (ev.clientX > br.right - 50) board.scrollLeft += 14;
      else if (ev.clientX < br.left + 50) board.scrollLeft -= 14;
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.col');
      document.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
      if (!col) { ph.remove(); target = null; return; }
      col.classList.add('over');
      target = col.dataset.status;
      const holder = $('.col-cards', col);
      const others = [...holder.querySelectorAll('.card')].filter((c) => c !== card);
      index = others.findIndex((c) => { const b = c.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      if (index === -1) { index = others.length; holder.append(ph); } else holder.insertBefore(ph, others[index]);
    };
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) { if (touch) cleanup(); else begin(ev); }
        return;
      }
      moved = true; place(ev);
    };
    const finish = () => {
      const id = card.dataset.id;
      const wasStarted = started, tg = target, idx = index;
      cleanup();
      if (!wasStarted) return;
      const swallow = (c) => c.stopPropagation();
      view.addEventListener('click', swallow, true);
      setTimeout(() => view.removeEventListener('click', swallow, true), 0);
      if (!moved || !tg) { render(); return; }
      const list = sortTasks(visibleTasks().filter((t) => t.status === tg && t.id !== id));
      const prev = list[idx - 1]?.position, next = list[idx]?.position;
      const pos = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 1000 : next != null ? next - 1000 : 1000;
      moveTask(id, tg, pos);
    };
    function cleanup() {
      clearTimeout(timer);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', abort);
      ghost?.remove(); ph?.remove(); card.classList.remove('dragging');
      document.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
      dragging = false;
    }
    function abort() { const was = started; cleanup(); if (was) render(); }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', abort);
    if (touch) timer = setTimeout(() => { navigator.vibrate?.(15); begin({ clientX: sx, clientY: sy }); }, 350);
  });
}

/* ---------- app wiring ---------- */
function bindApp() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    render();
    if (state.view === 'activity') markSeen().then(render);
  });
  $('#bell').addEventListener('click', () => { state.view = 'activity'; render(); markSeen().then(render); });
  $('#meBtn').addEventListener('click', openSettings);
  $('#fProject').addEventListener('change', (e) => { state.fProject = e.target.value; render(); });
  $('#fWho').addEventListener('click', (e) => { const b = e.target.closest('[data-who]'); if (b) { state.fWho = b.dataset.who; render(); } });
  $('#fSearch').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('#newProject').addEventListener('click', () => openProjectDlg());
  $('#templateBtn').addEventListener('click', openTemplateDlg);
  const view = $('#view');
  view.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const card = e.target.closest('.card[data-id]');
    if (open) openTaskDlg(open.dataset.open);
    else if (card) openTaskDlg(card.dataset.id);
    const ep = e.target.closest('[data-edit-project]');
    if (ep) openProjectDlg(ep.dataset.editProject);
    const gp = e.target.closest('[data-goto-project]');
    if (gp) { state.fProject = gp.dataset.gotoProject; state.view = 'board'; render(); }
  });
  view.addEventListener('submit', (e) => {
    const f = e.target.closest('.quick');
    if (!f) return;
    e.preventDefault();
    const title = f.title.value;
    f.title.value = '';
    addTask(f.dataset.status, title).then(() => $(`.quick[data-status="${f.dataset.status}"] input`)?.focus());
  });
  bindDrag();
  bindTaskDlg();
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'open-url') openFromHash(new URL(e.data.url, location.href).hash); });
  window.addEventListener('hashchange', () => openFromHash(location.hash));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.ws) loadAll().then(render).catch(() => {}); });
  window.addEventListener('online', () => state.ws && loadAll().then(render));
}

function openFromHash(hash) {
  const m = /task=([0-9a-f-]{36})/.exec(hash || '');
  if (m && state.tasks.has(m[1])) openTaskDlg(m[1]);
}

/* ---------- auth and onboarding ---------- */
function show(which) {
  for (const id of ['app', 'auth', 'onboard']) $('#' + id).hidden = id !== which;
}

let signUpMode = false;
function bindAuth() {
  const form = $('#authForm');
  const msg = $('#authMsg');
  $('#authToggle').addEventListener('click', () => {
    signUpMode = !signUpMode;
    $('#authSubmit').textContent = signUpMode ? 'Create account' : 'Sign in';
    $('#authToggle').textContent = signUpMode ? 'Already have an account? Sign in' : 'New here? Create an account';
    $('#authLead').textContent = signUpMode ? 'Create an account, then create or join a workspace.' : 'Sign in to see the shared board.';
    form.password.autocomplete = signUpMode ? 'new-password' : 'current-password';
    msg.textContent = '';
  });
  const redirectTo = location.origin + location.pathname;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'msg'; msg.textContent = '';
    const email = form.email.value.trim();
    if (!email) { msg.textContent = 'Enter your email.'; return; }
    $('#authMagic').disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    $('#authMagic').disabled = false;
    if (error) { msg.textContent = error.message; return; }
    msg.className = 'msg ok'; msg.textContent = 'Check your email for a sign-in link, then open it on this device.';
  });
  $('#authSubmit').addEventListener('click', async () => {
    msg.className = 'msg'; msg.textContent = '';
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || password.length < 6) { msg.textContent = 'Enter your email and a password of at least 6 characters.'; return; }
    $('#authSubmit').disabled = true;
    const { data, error } = signUpMode
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
      : await sb.auth.signInWithPassword({ email, password });
    $('#authSubmit').disabled = false;
    if (error) { msg.textContent = error.message; return; }
    if (signUpMode && !data.session) { msg.className = 'msg ok'; msg.textContent = 'Check your email to confirm your account, then sign in.'; }
  });
  const ob = $('#obMsg');
  const name = () => $('#obName').value.trim();
  $('#obCreate').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name()) { ob.textContent = 'Enter your name first.'; return; }
    const { error } = await sb.rpc('pl_create_workspace', { ws_name: $('#obWs').value, my_name: name() });
    if (error) { ob.textContent = error.message; return; }
    await enter();
  });
  $('#obJoin').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name()) { ob.textContent = 'Enter your name first.'; return; }
    const { error } = await sb.rpc('pl_join_workspace', { code: $('#obCode').value, my_name: name() });
    if (error) { ob.textContent = error.message; return; }
    try { localStorage.removeItem('planner-join'); } catch { /* ignore */ }
    await enter();
  });
  $('#obSignOut').addEventListener('click', () => sb.auth.signOut());
}

function showOnboard() {
  const code = pendingJoin();
  $('#obCode').value = code;
  $('#obCreate').hidden = !!code;
  $('#obLead').hidden = !code;
  $('#obLead').textContent = code ? 'You have been invited to a shared workspace. Enter your name and join.' : '';
  $('.split', $('#onboard')).style.gridTemplateColumns = code ? '1fr' : '';
  show('onboard');
}

let appBound = false;
async function enter() {
  try {
    if (!(await loadWorkspace())) { showOnboard(); return; }
    try { localStorage.removeItem('planner-join'); } catch { /* ignore */ }
    await loadAll();
  } catch (e) {
    show('auth');
    $('#authMsg').textContent = 'Could not load your workspace: ' + (e.message || e);
    return;
  }
  show('app');
  if (!appBound) { bindApp(); appBound = true; }
  subscribe();
  render();
  openFromHash(location.hash);
  if (state.view === 'activity') markSeen();
}

let lastUser;
sb.auth.onAuthStateChange((event, session) => {
  const id = session?.user?.id ?? null;
  if (id === lastUser && event !== 'SIGNED_OUT') return;
  lastUser = id;
  state.user = session?.user ?? null;
  // Defer: supabase-js must not be called inside this callback.
  setTimeout(() => {
    if (!state.user) {
      if (channel) { sb.removeChannel(channel); channel = null; }
      state.ws = null; show('auth'); return;
    }
    enter();
  }, 0);
});

bindAuth();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
