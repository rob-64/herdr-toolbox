import { execFile } from 'node:child_process';

// Roles the viewer can have on a PR. Reviews count as commenting for the role filter.
export const ROLES = ['opened', 'committed', 'commented', 'reviewed'];

const DAY = 24 * 60 * 60 * 1000;
export const RECENT_DAYS = 30;
const MAX_BRANCHES = 40;
const MAX_COMMITS = 40;
const SEARCH_LIMIT = 50;

const PR_FIELDS = `... on PullRequest {
  number title url state isDraft createdAt updatedAt
  repository { nameWithOwner }
  author { login }
  reviewDecision
  comments { totalCount }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 0) {
    totalCount checkRunCountsByState { state count } statusContextCountsByState { state count }
  } } } } }
}`;

// Last-commit checks of one PR, for the drill-down: GitHub Actions jobs, other apps' check runs, commit statuses.
const CHECKS_QUERY = `query($url: URI!) { resource(url: $url) { ... on PullRequest {
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun {
      name status conclusion startedAt completedAt detailsUrl
      checkSuite { app { name } workflowRun { runNumber url workflow { name } } }
    }
    ... on StatusContext { context state targetUrl description createdAt }
  } } } } } }
} } }`;

// Check-run states/conclusions and commit-status states, folded into what the board shows.
const CHECK_STATE = {
  SUCCESS: 'success', COMPLETED: 'success',
  NEUTRAL: 'skipped', SKIPPED: 'skipped', STALE: 'skipped',
  FAILURE: 'failure', ERROR: 'failure', TIMED_OUT: 'failure', ACTION_REQUIRED: 'failure', STARTUP_FAILURE: 'failure',
  CANCELLED: 'cancelled',
  PENDING: 'pending', EXPECTED: 'pending', QUEUED: 'pending', IN_PROGRESS: 'pending', WAITING: 'pending', REQUESTED: 'pending',
};

export const checkState = value => CHECK_STATE[value] ?? 'pending';

/** Passed / failed / pending out of the checks that matter (skipped and neutral ones are left out). */
export function ciCounts(contexts) {
  if (!contexts) return undefined;
  const counts = { success: 0, failure: 0, cancelled: 0, pending: 0, skipped: 0 };
  for (const { state, count } of [...(contexts.checkRunCountsByState ?? []), ...(contexts.statusContextCountsByState ?? [])]) {
    counts[checkState(state)] += count;
  }
  const failed = counts.failure + counts.cancelled;
  return { passed: counts.success, failed, pending: counts.pending, relevant: counts.success + failed + counts.pending };
}

const STATE_RANK = ['failure', 'pending', 'cancelled', 'success', 'skipped'];

export function rollupState(states) {
  if (!states.length) return 'skipped';
  return STATE_RANK.find(state => states.includes(state)) ?? 'pending';
}

/** Group check contexts: one group per workflow run (jobs inside), per other check app, and one for commit statuses. */
export function normalizeChecks(nodes) {
  const groups = new Map();
  const group = (key, init) => {
    if (!groups.has(key)) groups.set(key, { key, ...init, jobs: [] });
    return groups.get(key);
  };
  for (const node of nodes ?? []) {
    if (node?.__typename === 'CheckRun') {
      const run = node.checkSuite?.workflowRun;
      const target = run
        ? group(`run:${run.url ?? run.workflow?.name}`, { kind: 'workflow', name: `${clean(run.workflow?.name) || 'workflow'} #${run.runNumber}`, url: run.url })
        : group(`app:${node.checkSuite?.app?.name}`, { kind: 'app', name: clean(node.checkSuite?.app?.name) || 'checks', url: undefined });
      target.jobs.push({
        name: clean(node.name),
        state: checkState(node.status === 'COMPLETED' ? node.conclusion : node.status),
        url: node.detailsUrl ?? undefined,
        startedAt: Date.parse(node.startedAt) || undefined,
        completedAt: Date.parse(node.completedAt) || undefined,
      });
    } else if (node?.__typename === 'StatusContext') {
      group('statuses', { kind: 'status', name: 'Commit statuses', url: undefined }).jobs.push({
        name: clean(node.context),
        state: checkState(node.state),
        url: node.targetUrl ?? undefined,
        description: clean(node.description),
      });
    }
  }
  const list = [...groups.values()];
  for (const item of list) {
    item.state = rollupState(item.jobs.map(job => job.state));
    const starts = item.jobs.map(job => job.startedAt).filter(Boolean);
    const ends = item.jobs.map(job => job.completedAt).filter(Boolean);
    item.startedAt = starts.length ? Math.min(...starts) : undefined;
    item.completedAt = item.state !== 'pending' && ends.length ? Math.max(...ends) : undefined;
  }
  // Failing and running groups first; jobs keep GitHub's order, which follows the workflow.
  return list.sort((a, b) => STATE_RANK.indexOf(a.state) - STATE_RANK.indexOf(b.state));
}

const clean = value => String(value ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();

/** Run `gh` and resolve `{ ok, stdout, stderr }`; never rejects. */
export function ghRunner(env = process.env) {
  const bin = env.GH_BIN || 'gh';
  return args => new Promise(resolve => {
    execFile(bin, args, { timeout: 30000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const missing = error?.code === 'ENOENT' ? `${bin} not found - install the GitHub CLI: https://cli.github.com` : '';
      resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: missing || String(stderr ?? '') || (error ? error.message : '') });
    });
  });
}

async function ghJson(run, args) {
  const result = await run(args);
  if (!result.ok) throw new Error(firstLine(result.stderr || result.stdout) || 'gh failed');
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`gh returned invalid JSON for ${args.slice(0, 2).join(' ')}`); }
}

function firstLine(text) {
  return clean(String(text ?? '').split('\n').find(line => line.trim()) ?? '');
}

async function graphql(run, query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) args.push('-f', `${key}=${value}`);
  const json = await ghJson(run, args);
  if (json.errors?.length && !json.data) throw new Error(clean(json.errors[0].message));
  return json.data ?? {};
}

export function normalizePr(raw) {
  if (!raw?.url) return undefined;
  const state = raw.state === 'MERGED' ? 'merged' : raw.state === 'CLOSED' ? 'closed' : raw.isDraft ? 'draft' : 'open';
  return {
    key: raw.url,
    url: raw.url,
    number: raw.number,
    title: clean(raw.title),
    repo: clean(raw.repository?.nameWithOwner),
    author: clean(raw.author?.login),
    state,
    review: raw.reviewDecision ?? undefined,
    checks: raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? undefined,
    ci: ciCounts(raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts),
    comments: raw.comments?.totalCount ?? 0,
    createdAt: Date.parse(raw.createdAt) || undefined,
    updatedAt: Date.parse(raw.updatedAt) || undefined,
    roles: new Set(),
  };
}

/** Search qualifier that narrows each source to the board filter. */
export function filterQualifier(filter, now = Date.now()) {
  if (filter === 'open') return 'is:open';
  if (filter === 'recent') return `updated:>=${new Date(now - RECENT_DAYS * DAY).toISOString().slice(0, 10)}`;
  return '';
}

export const SEARCHES = { opened: 'author', commented: 'commenter', reviewed: 'reviewed-by' };

// One request per role: a single 3x100 query with check rollups times out (HTTP 502) on `all`.
async function searchPrs(run, login, role, filter, now) {
  const q = ['is:pr', `${SEARCHES[role]}:${login}`, filterQualifier(filter, now), 'sort:updated-desc'].filter(Boolean).join(' ');
  const data = await graphql(run, `query($q: String!) { search(query: $q, type: ISSUE, first: ${SEARCH_LIMIT}) { nodes { ${PR_FIELDS} } } }`, { q });
  return { role, nodes: data.search?.nodes ?? [] };
}

/** Branches the user pushed to recently (GitHub keeps 90 days / 300 events). */
export async function pushedBranches(run, login) {
  const result = await run(['api', '--paginate', `users/${login}/events?per_page=100`, '--jq', '.[] | select(.type == "PushEvent") | [.repo.name, .payload.ref] | @tsv']);
  if (!result.ok) throw new Error(firstLine(result.stderr) || 'gh events failed');
  const seen = new Set();
  const branches = [];
  for (const line of result.stdout.split('\n')) {
    const [repo, ref] = line.split('\t');
    if (!repo || !ref?.startsWith('refs/heads/')) continue;
    const branch = ref.slice('refs/heads/'.length);
    const key = `${repo}\t${branch}`;
    if (seen.has(key)) continue;
    seen.add(key);
    branches.push({ repo, branch });
    if (branches.length >= MAX_BRANCHES) break;
  }
  return branches;
}

/** Commits the user authored that landed on a default branch (commit search only indexes those). */
export async function authoredCommits(run, login, filter, now) {
  const since = filter === 'recent' ? ` author-date:>=${new Date(now - RECENT_DAYS * DAY).toISOString().slice(0, 10)}` : '';
  const json = await ghJson(run, ['api', '-X', 'GET', 'search/commits', '-f', `q=author:${login}${since}`, '-f', 'sort=author-date', '-f', `per_page=${MAX_COMMITS}`]);
  return (json.items ?? []).map(item => ({ repo: item.repository?.full_name, sha: item.sha })).filter(item => item.repo && /^[0-9a-f]{40}$/.test(item.sha ?? ''));
}

const literal = value => JSON.stringify(String(value));

function repoArgs(repo) {
  const [owner, name] = repo.split('/');
  return `owner: ${literal(owner)}, name: ${literal(name)}`;
}

/** PRs whose head branch the user pushed to, or that contain a commit they authored. */
async function committedPrs(run, branches, commits) {
  const parts = [];
  branches.forEach(({ repo, branch }, index) => {
    parts.push(`b${index}: repository(${repoArgs(repo)}) { pullRequests(headRefName: ${literal(branch)}, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } } }`);
  });
  commits.forEach(({ repo, sha }, index) => {
    parts.push(`c${index}: repository(${repoArgs(repo)}) { object(oid: ${literal(sha)}) { ... on Commit { associatedPullRequests(first: 3) { nodes { ${PR_FIELDS} } } } } }`);
  });
  if (!parts.length) return [];
  const data = await graphql(run, `query { ${parts.join('\n')} }`);
  const nodes = [];
  for (const value of Object.values(data)) {
    nodes.push(...(value?.pullRequests?.nodes ?? value?.object?.associatedPullRequests?.nodes ?? []));
  }
  return nodes;
}

export function mergePrs(sources, login) {
  const byUrl = new Map();
  for (const { role, nodes } of sources) {
    for (const raw of nodes) {
      const pr = normalizePr(raw);
      if (!pr) continue;
      const existing = byUrl.get(pr.url) ?? pr;
      byUrl.set(pr.url, existing);
      existing.roles.add(role);
      // A PR found through another source (e.g. a push) is still one the user opened.
      if (login && existing.author === login) existing.roles.add('opened');
    }
  }
  return [...byUrl.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * What changed since the PRs recorded in `seen` (url -> review decision), which it updates:
 * open PRs someone else opened that are new to the board, and PRs you opened or committed to that became approved.
 */
export function prChanges(seen, prs, login) {
  const events = [];
  for (const pr of prs) {
    const known = seen.has(pr.url);
    const wasApproved = seen.get(pr.url) === 'APPROVED';
    seen.set(pr.url, pr.review);
    if (!known) {
      if ((pr.state === 'open' || pr.state === 'draft') && pr.author !== login) events.push({ kind: 'new', pr });
    } else if (pr.review === 'APPROVED' && !wasApproved && (pr.roles.has('opened') || pr.roles.has('committed'))) {
      events.push({ kind: 'approved', pr });
    }
  }
  return events;
}

/**
 * Fetch every PR the gh user opened, committed to, commented on, or reviewed.
 * A failing source is reported in `errors`; the other sources still load.
 */
export class PrStore {
  constructor({ run = ghRunner(), now = () => Date.now() } = {}) {
    this.run = run;
    this.now = now;
    this.login = undefined;
  }

  async viewer() {
    if (this.login) return this.login;
    const result = await this.run(['api', 'user', '--jq', '.login']);
    const login = result.stdout.trim();
    if (!result.ok || !login) {
      const reason = firstLine(result.stderr).replace(/^gh:\s*/, '');
      const auth = !reason || /auth|401|log ?in/i.test(reason);
      throw new Error(auth && !reason.includes('gh auth login') ? `${reason || 'not logged in'} - run \`gh auth login\`` : reason);
    }
    this.login = login;
    return login;
  }

  async load(filter = 'open') {
    const now = this.now();
    let login;
    try { login = await this.viewer(); }
    catch (error) { return { login: undefined, prs: [], errors: [`gh: ${error.message}`], fetchedAt: now }; }
    const errors = [];
    const attempt = async (label, fn, fallback) => {
      try { return await fn(); }
      catch (error) { errors.push(`${label}: ${error.message}`); return fallback; }
    };
    const [branches, commits, ...searched] = await Promise.all([
      attempt('push events', () => pushedBranches(this.run, login), []),
      // Default-branch commits only belong to merged PRs, which the open filter hides anyway.
      filter === 'open' ? [] : attempt('commit search', () => authoredCommits(this.run, login, filter, now), []),
      ...Object.keys(SEARCHES).map(role => attempt(`${role} search`, () => searchPrs(this.run, login, role, filter, now), { role, nodes: [] })),
    ]);
    const committed = await attempt('commits', () => committedPrs(this.run, branches, commits), []);
    const prs = mergePrs([...searched, { role: 'committed', nodes: committed }], login);
    return { login, prs, errors, fetchedAt: this.now() };
  }

  /** Grouped checks of one PR's last commit; throws on a gh failure. */
  async checks(url) {
    const data = await graphql(this.run, CHECKS_QUERY, { url });
    return normalizeChecks(data.resource?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes);
  }
}
