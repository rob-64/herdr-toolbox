/** @typedef {{ owned: Record<string, string>, released: string[] }} TabsState */

const STATUS_GLYPH = {
  blocked: '◉',
  working: '◐',
  done: '●',
  idle: '✓',
  unknown: '○',
};

const URGENCY = ['blocked', 'working', 'done', 'idle', 'unknown'];

const DEFAULT_ICONS = {
  omo: '\u{F09DF}',
  claude: '\u{F06C4}',
  codex: '\u{F0169}',
  pi: '\u{F03FF}',
  gemini: '\u{F0AE2}',
  cursor: '\u{F01BF}',
  opencode: '\u{F018D}',
  copilot: '\u{F4B8}',
  default: '\u{F06A9}',
};

const ALL_GLYPHS = new Set(Object.values(STATUS_GLYPH));
const ALL_ICONS = new Set(Object.values(DEFAULT_ICONS));

/**
 * @param {string | undefined | null} status
 */
export function glyphFor(status) {
  if (!status || !(status in STATUS_GLYPH)) return STATUS_GLYPH.unknown;
  return STATUS_GLYPH[status];
}

/**
 * @param {string | undefined} kind
 * @param {object} config
 */
export function iconFor(kind, config) {
  if (config.icons === false) return '';
  const icons = config.icons && typeof config.icons === 'object' ? config.icons : {};
  const key = kind ?? 'default';
  if (icons[key]) return icons[key];
  if (DEFAULT_ICONS[key]) return DEFAULT_ICONS[key];
  return DEFAULT_ICONS.default;
}

/**
 * Remove leading icon + status glyph from a label we wrote.
 * @param {string} label
 */
export function stripPrefix(label) {
  const parts = label.trim().split(/\s+/);
  if (parts.length <= 1) return label.trim();

  let i = 0;
  const nextIsGlyph = (idx) => idx + 1 < parts.length && ALL_GLYPHS.has(parts[idx + 1]);
  if (ALL_ICONS.has(parts[0]) || nextIsGlyph(0)) i = 1;
  if (i < parts.length && ALL_GLYPHS.has(parts[i])) i += 1;
  if (i === 0) return label.trim();
  return parts.slice(i).join(' ');
}

function cleanTitle(title) {
  if (title == null) return '';
  return String(title)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateTitle(text, maxTitle) {
  const max = maxTitle ?? 32;
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return text.slice(0, max - 1) + '…';
}

function isDefaultNumberLabel(label) {
  return /^\d+$/.test(label);
}

function isStaleOmoLabel(label) {
  return label.startsWith('OmO - ');
}

function configuredIcons(config) {
  if (config.icons === false || !config.icons || typeof config.icons !== 'object') {
    return [];
  }
  return Object.values(config.icons).filter(Boolean);
}

function hasManagedPrefix(label, config) {
  const trimmed = label.trim();
  if (stripPrefix(label) !== trimmed) return true;
  for (const icon of configuredIcons(config)) {
    if (trimmed.startsWith(`${icon} `)) return true;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && ALL_GLYPHS.has(parts[0])) return true;
  return false;
}

function isClaimable(tab, owned, config) {
  const id = tab.tab_id;
  if (owned[id] === tab.label) return true;
  if (isDefaultNumberLabel(tab.label)) return true;
  if (isStaleOmoLabel(tab.label)) return true;
  if (hasManagedPrefix(tab.label, config)) return true;
  return false;
}

function urgencyRank(status) {
  const idx = URGENCY.indexOf(status ?? 'unknown');
  return idx === -1 ? URGENCY.length : idx;
}

/**
 * @param {Array<object>} agents
 */
function pickPrimaryAgent(agents) {
  if (!agents.length) return null;
  let best = agents[0];
  for (let i = 1; i < agents.length; i++) {
    const agent = agents[i];
    const rank = urgencyRank(agent.agent_status);
    const bestRank = urgencyRank(best.agent_status);
    if (rank < bestRank) {
      best = agent;
      continue;
    }
    if (rank > bestRank) continue;
    if (agent.focused && !best.focused) best = agent;
  }
  return best;
}

/**
 * @param {object} snapshot
 * @param {TabsState} state
 * @param {object} config
 */
export function plan(snapshot, state, config) {
  const owned = { ...state.owned };
  const released = new Set(state.released);
  const renames = [];
  const tabIds = new Set((snapshot.tabs ?? []).map((t) => t.tab_id));

  for (const id of Object.keys(owned)) {
    if (!tabIds.has(id)) delete owned[id];
  }
  for (const id of [...released]) {
    if (!tabIds.has(id)) released.delete(id);
  }

  for (const tab of snapshot.tabs ?? []) {
    const tabId = tab.tab_id;
    if (released.has(tabId)) continue;

    const agents = (snapshot.agents ?? []).filter((a) => a.tab_id === tabId);

    if (owned[tabId] !== undefined && tab.label !== owned[tabId]) {
      delete owned[tabId];
      released.add(tabId);
      continue;
    }

    if (!isClaimable(tab, owned, config)) continue;

    if (agents.length === 0) {
      if (owned[tabId] !== undefined) {
        const bare = stripPrefix(owned[tabId]);
        if (bare !== tab.label) {
          renames.push({ tab_id: tabId, label: bare });
        }
        owned[tabId] = bare;
      }
      continue;
    }

    const primary = pickPrimaryAgent(agents);
    let base = cleanTitle(primary?.title);
    if (!base) {
      if (owned[tabId] !== undefined) {
        base = stripPrefix(owned[tabId]);
      } else {
        base = String(tab.number ?? '');
      }
    }
    base = truncateTitle(base, config.max_title);

    const parts = [];
    if (config.icons !== false) {
      const icon = iconFor(primary?.agent ?? primary?.display_agent, config);
      if (icon) parts.push(icon);
    }
    if (config.status !== false) {
      parts.push(glyphFor(primary?.agent_status));
    }
    if (base) parts.push(base);

    const label = parts.join(' ');
    if (label !== tab.label) {
      renames.push({ tab_id: tabId, label });
      owned[tabId] = label;
    } else if (owned[tabId] === undefined) {
      owned[tabId] = label;
    }
  }

  return {
    renames,
    state: {
      owned,
      released: [...released],
    },
  };
}

export { DEFAULT_ICONS, STATUS_GLYPH };
