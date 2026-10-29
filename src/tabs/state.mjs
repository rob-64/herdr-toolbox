import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MRU_CAP = 50;
const LOG_MAX = 1024 * 1024;

function defaultStateDir() {
  return join(homedir(), '.local', 'state', 'herdr-omo-toolbox');
}

export function stateDir() {
  const base =
    process.env.HERDR_PLUGIN_STATE_DIR ?? defaultStateDir();
  return join(base, 'tabs');
}

export function configDir() {
  return process.env.HERDR_PLUGIN_CONFIG_DIR ?? join(homedir(), '.config', 'herdr-omo-toolbox');
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return structuredClone(fallback);
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

function atomicWrite(path, data) {
  ensureDir(stateDir());
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, path);
}

export function loadTabsState() {
  const path = join(stateDir(), 'tabs.json');
  const data = readJson(path, { owned: {}, released: [] });
  if (!data.owned || typeof data.owned !== 'object') data.owned = {};
  if (!Array.isArray(data.released)) data.released = [];
  return data;
}

export function saveTabsState(state) {
  atomicWrite(join(stateDir(), 'tabs.json'), JSON.stringify(state, null, 2) + '\n');
}

export function loadMru() {
  const path = join(stateDir(), 'mru.json');
  const data = readJson(path, { tabs: [] });
  if (!Array.isArray(data.tabs)) data.tabs = [];
  return data;
}

export function saveMru(mru) {
  atomicWrite(join(stateDir(), 'mru.json'), JSON.stringify(mru, null, 2) + '\n');
}

export function loadWatcherPid() {
  const path = join(stateDir(), 'watcher.pid');
  return readJson(path, null);
}

export function saveWatcherPid(info) {
  atomicWrite(join(stateDir(), 'watcher.pid'), JSON.stringify(info, null, 2) + '\n');
}

export function removeWatcherPid() {
  const path = join(stateDir(), 'watcher.pid');
  try {
    unlinkSync(path);
  } catch {
    /* missing ok */
  }
}

export function watcherLogPath() {
  return join(stateDir(), 'watcher.log');
}

export function truncateWatcherLogIfNeeded() {
  const path = watcherLogPath();
  try {
    if (existsSync(path) && statSync(path).size > LOG_MAX) {
      writeFileSync(path, '');
    }
  } catch {
    /* ignore */
  }
}

let configMtime = 0;
let cachedConfig = null;

const DEFAULT_CONFIG = {
  icons: {},
  status: true,
  max_title: 32,
};

export function loadConfig() {
  const path = join(configDir(), 'config.json');
  try {
    if (!existsSync(path)) {
      return { ...DEFAULT_CONFIG, icons: { ...DEFAULT_CONFIG.icons } };
    }
    const mtime = statSync(path).mtimeMs;
    if (cachedConfig && mtime === configMtime) return cachedConfig;
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    configMtime = mtime;
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      icons:
        parsed.icons === false
          ? false
          : { ...DEFAULT_CONFIG.icons, ...(parsed.icons ?? {}) },
    };
    return cachedConfig;
  } catch {
    return { ...DEFAULT_CONFIG, icons: { ...DEFAULT_CONFIG.icons } };
  }
}

/**
 * @param {{ tabs: string[] }} mru
 * @param {{ focused_tab_id?: string, tabs?: Array<{ tab_id: string }> }} snap
 */
export function updateMruFromSnapshot(mru, snap) {
  const tabIds = new Set((snap.tabs ?? []).map((t) => t.tab_id));
  mru.tabs = mru.tabs.filter((id) => tabIds.has(id));
  const focused = snap.focused_tab_id;
  if (focused && tabIds.has(focused)) {
    if (mru.tabs[0] !== focused) {
      mru.tabs = mru.tabs.filter((id) => id !== focused);
      mru.tabs.unshift(focused);
    }
  }
  if (mru.tabs.length > MRU_CAP) mru.tabs = mru.tabs.slice(0, MRU_CAP);
  return mru;
}
