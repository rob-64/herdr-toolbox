import { createConnection } from 'node:net';

const REQUEST_ID = 'omo-tabs';

function socketPath() {
  const path = process.env.HERDR_SOCKET_PATH;
  if (!path) throw new Error('HERDR_SOCKET_PATH is not set');
  return path;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

/**
 * @param {string} method
 * @param {object} [params]
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<object>}
 */
export function request(method, params = {}, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath());
    let buffer = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };

    const timer = setTimeout(() => {
      const err = new Error(`herdr request timeout: ${method}`);
      err.code = 'ETIMEDOUT';
      fail(err);
    }, timeoutMs);

    socket.setEncoding('utf8');

    socket.on('error', (error) => {
      fail(error);
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let msg;
      try {
        msg = parseLine(line);
      } catch (error) {
        fail(error);
        return;
      }
      if (!msg) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      if (msg.error) {
        const err = new Error(msg.error.message ?? 'herdr error');
        err.code = msg.error.code;
        reject(err);
        return;
      }
      resolve(msg.result ?? {});
    });

    const payload = JSON.stringify({ id: REQUEST_ID, method, params }) + '\n';
    socket.write(payload);
  });
}

/**
 * @param {Array<{ type: string, pane_id?: string }>} subscriptions
 * @param {(event: object) => void} onEvent
 * @returns {{ close: () => void, closed: Promise<void> }}
 */
export function subscribe(subscriptions, onEvent) {
  let socket;
  let buffer = '';
  let ackDone = false;
  let resolveClosed;
  let rejectClosed;

  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });

  const settleClosed = (error) => {
    if (error) rejectClosed(error);
    else resolveClosed();
  };

  const fail = (error) => {
    socket?.destroy();
    settleClosed(error);
  };

  socket = createConnection(socketPath());
  socket.setEncoding('utf8');

  socket.on('error', (error) => {
    if (!ackDone) fail(error);
    else settleClosed(error);
  });

  socket.on('close', () => {
    if (!ackDone) fail(new Error('subscription closed before ack'));
    else settleClosed(new Error('subscription closed'));
  });

  socket.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let msg;
      try {
        msg = parseLine(line);
      } catch (error) {
        fail(error);
        return;
      }
      if (!msg) continue;

      if (!ackDone) {
        ackDone = true;
        if (msg.error) {
          const err = new Error(msg.error.message ?? 'subscribe failed');
          err.code = msg.error.code;
          fail(err);
          return;
        }
        continue;
      }

      if (msg.error?.code === 'events_lost') {
        const err = new Error(msg.error.message ?? 'events lost');
        err.code = 'events_lost';
        socket.destroy();
        settleClosed(err);
        return;
      }

      if (msg.type) onEvent(msg);
    }
  });

  const payload =
    JSON.stringify({
      id: REQUEST_ID,
      method: 'events.subscribe',
      params: { subscriptions },
    }) + '\n';
  socket.write(payload);

  return {
    close() {
      socket.destroy();
      settleClosed(new Error('subscription closed by client'));
    },
    closed,
  };
}

export async function snapshot() {
  const result = await request('session.snapshot', {});
  return result.snapshot;
}
