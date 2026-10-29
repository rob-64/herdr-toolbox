import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { request, snapshot, subscribe } from './herdr.mjs';
import { plan, stripPrefix } from './labels.mjs';
import {
  loadConfig,
  loadMru,
  loadTabsState,
  loadWatcherPid,
  removeWatcherPid,
  saveMru,
  saveTabsState,
  saveWatcherPid,
  truncateWatcherLogIfNeeded,
  stateDir,
  updateMruFromSnapshot,
  watcherLogPath,
} from './state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = join(__dirname, 'main.mjs');
const PLUGIN_ID = process.env.HERDR_PLUGIN_ID || 'herdr-omo-toolbox';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function watcherRunningForSocket() {
  const info = loadWatcherPid();
  if (!info?.pid || !info.socket) return false;
  if (info.socket !== process.env.HERDR_SOCKET_PATH) return false;
  return isProcessAlive(info.pid);
}

export function ensureWatcher() {
  if (watcherRunningForSocket()) return;
  truncateWatcherLogIfNeeded();
  mkdirSync(stateDir(), { recursive: true });
  const logPath = watcherLogPath();
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [MAIN, 'watch'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
}

const BASE_SUBSCRIPTIONS = [
  { type: 'tab.focused' },
  { type: 'tab.renamed' },
  { type: 'tab.created' },
  { type: 'tab.closed' },
  { type: 'tab.moved' },
  { type: 'pane.created' },
  { type: 'pane.closed' },
  { type: 'pane.exited' },
  { type: 'pane.moved' },
  { type: 'pane.updated' },
  { type: 'pane.agent_detected' },
];

function agentPaneSubscriptions(snap) {
  const subs = [...BASE_SUBSCRIPTIONS];
  for (const agent of snap.agents ?? []) {
    if (agent.pane_id) subs.push({ type: 'pane.agent_status_changed', pane_id: agent.pane_id });
  }
  return subs;
}

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
}

async function restoreOwnedTabs() {
  const tabsState = loadTabsState();
  const owned = { ...tabsState.owned };
  for (const [tabId, label] of Object.entries(tabsState.owned)) {
    const bare = stripPrefix(label);
    try {
      await request('tab.rename', { tab_id: tabId, label: bare });
      logLine(`restore rename ${tabId} -> ${bare}`);
      owned[tabId] = bare;
    } catch (error) {
      logLine(`restore error ${tabId}: ${error.message}`);
    }
  }
  saveTabsState({ owned, released: tabsState.released });
  removeWatcherPid();
}

async function applyRenames(renames, ownedBefore, tabsState) {
  for (const { tab_id, label } of renames) {
    try {
      await request('tab.rename', { tab_id, label });
      logLine(`rename ${tab_id} -> ${label}`);
    } catch (error) {
      logLine(`rename error ${tab_id}: ${error.message}`);
      if (ownedBefore[tab_id] === undefined) {
        delete tabsState.owned[tab_id];
      } else {
        tabsState.owned[tab_id] = ownedBefore[tab_id];
      }
    }
  }
}

async function watchDaemon() {
  const socket = process.env.HERDR_SOCKET_PATH;
  if (!socket) {
    console.error('omo-tabs watch: HERDR_SOCKET_PATH not set');
    process.exit(1);
  }

  const existing = loadWatcherPid();
  if (
    existing?.pid &&
    existing.socket === socket &&
    existing.pid !== process.pid &&
    isProcessAlive(existing.pid)
  ) {
    process.exit(0);
  }

  saveWatcherPid({ pid: process.pid, socket });

  await new Promise((resolve) => setTimeout(resolve, 300));
  const pidAfterWrite = loadWatcherPid();
  if (pidAfterWrite?.pid !== process.pid) {
    process.exit(0);
  }

  let tabsState = loadTabsState();
  let mru = loadMru();
  let subscription = null;
  let refreshTimer = null;
  let fallbackTimer = null;
  let pluginCheckTimer = null;
  let lastAgentPanes = '';
  let refreshing = false;
  let refreshAgain = false;
  let lastSocketOk = Date.now();
  let shuttingDown = false;

  const debouncedRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void doRefresh();
    }, 150);
  };

  async function doRefresh() {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    refreshAgain = false;
    try {
      const snap = await snapshot();
      lastSocketOk = Date.now();
      mru = updateMruFromSnapshot(mru, snap);
      const config = loadConfig();
      const ownedBefore = { ...tabsState.owned };
      const before = JSON.stringify(tabsState);
      const result = plan(snap, tabsState, config);
      tabsState = result.state;
      await applyRenames(result.renames, ownedBefore, tabsState);
      const after = JSON.stringify(tabsState);
      if (before !== after) saveTabsState(tabsState);
      saveMru(mru);

      const paneKey = (snap.agents ?? [])
        .map((a) => a.pane_id)
        .filter(Boolean)
        .sort()
        .join(',');
      if (paneKey !== lastAgentPanes) {
        lastAgentPanes = paneKey;
        await resubscribe(snap);
      }
    } catch (error) {
      logLine(`refresh error: ${error.message}`);
      if (Date.now() - lastSocketOk > 30_000) {
        logLine('socket unreachable for 30s, exiting');
        await shutdown();
      }
    } finally {
      refreshing = false;
      if (refreshAgain) void doRefresh();
    }
  }

  async function resubscribe(snap) {
    subscription?.close();
    try {
      await setupSubscription(snap);
    } catch (error) {
      logLine(`subscribe error: ${error.message}`);
    }
  }

  function setupSubscription(snap) {
    return new Promise((resolve, reject) => {
      const subs = agentPaneSubscriptions(snap);
      const sub = subscribe(subs, () => debouncedRefresh());
      subscription = sub;
      sub.closed.catch((error) => {
        if (shuttingDown) return;
        if (sub !== subscription) return;
        logLine(`subscription closed: ${error?.message ?? 'closed'}`);
        setTimeout(async () => {
          if (shuttingDown) return;
          if (sub !== subscription) return;
          try {
            const s = await snapshot();
            lastSocketOk = Date.now();
            await resubscribe(s);
            debouncedRefresh();
          } catch (e) {
            logLine(`resubscribe failed: ${e.message}`);
          }
        }, 1000);
      });
      setTimeout(() => resolve(), 50);
    });
  }

  async function checkPlugin() {
    try {
      const result = await request('plugin.list', {});
      lastSocketOk = Date.now();
      const plugins = result.plugins ?? [];
      const self = plugins.find((p) => p.plugin_id === PLUGIN_ID);
      if (!self || !self.enabled) {
        logLine('plugin disabled or missing, exiting');
        await shutdown();
      }
    } catch (error) {
      logLine(`plugin.list error: ${error.message}`);
      if (Date.now() - lastSocketOk > 30_000) {
        logLine('socket unreachable for 30s, exiting');
        await shutdown();
      }
    }
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(refreshTimer);
    clearInterval(fallbackTimer);
    clearInterval(pluginCheckTimer);
    subscription?.close();
    await restoreOwnedTabs();
    process.exit(0);
  }

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });

  try {
    const snap = await snapshot();
    lastSocketOk = Date.now();
    await setupSubscription(snap);
  } catch (error) {
    logLine(`initial snapshot failed: ${error.message}`);
  }

  await doRefresh();

  fallbackTimer = setInterval(() => debouncedRefresh(), 3000);
  pluginCheckTimer = setInterval(() => void checkPlugin(), 10_000);
}

async function lastTab() {
  ensureWatcher();
  let snap;
  try {
    snap = await snapshot();
  } catch (error) {
    console.error(`omo-tabs last-tab: ${error.message}`);
    process.exit(1);
  }

  const mru = loadMru();
  const tabIds = new Set((snap.tabs ?? []).map((t) => t.tab_id));
  const focused = snap.focused_tab_id;
  let target = null;
  for (const id of mru.tabs) {
    if (id !== focused && tabIds.has(id)) {
      target = id;
      break;
    }
  }
  if (!target) process.exit(0);

  const targetTab = snap.tabs.find((t) => t.tab_id === target);
  if (targetTab && targetTab.workspace_id !== snap.focused_workspace_id) {
    try {
      await request('workspace.focus', { workspace_id: targetTab.workspace_id });
    } catch (error) {
      console.error(`omo-tabs workspace.focus: ${error.message}`);
    }
  }
  try {
    await request('tab.focus', { tab_id: target });
  } catch (error) {
    console.error(`omo-tabs tab.focus: ${error.message}`);
    process.exit(1);
  }

  const nextTabs = [target];
  if (focused && tabIds.has(focused) && focused !== target) nextTabs.push(focused);
  for (const id of mru.tabs) {
    if (!nextTabs.includes(id) && tabIds.has(id)) nextTabs.push(id);
  }
  saveMru({ tabs: nextTabs });
}

async function stopWatcher() {
  const info = loadWatcherPid();
  if (!info?.pid || !isProcessAlive(info.pid)) {
    console.log('omo-tabs: watcher not running');
    removeWatcherPid();
    return;
  }
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch (error) {
    console.log(`omo-tabs: could not signal watcher: ${error.message}`);
    return;
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(info.pid)) {
      console.log(`omo-tabs: watcher ${info.pid} stopped`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`omo-tabs: watcher ${info.pid} still running after 3s`);
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'ensure':
      ensureWatcher();
      break;
    case 'watch':
      await watchDaemon();
      break;
    case 'last-tab':
      await lastTab();
      break;
    case 'stop':
      await stopWatcher();
      break;
    default:
      console.error('omo-tabs: usage: ensure | watch | last-tab | stop');
      process.exit(2);
  }
}

main();
