import { setTimeout as wait } from 'node:timers/promises';
import fastifyHttpProxy from '@fastify/http-proxy';
import { StatefulSubscriptions } from '@platformatic/graphql-subscriptions-resume';
import fastify from 'fastify';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
const PING_INTERVAL = process.env.PING_INTERVAL
  ? parseInt(process.env.PING_INTERVAL, 10)
  : 1_000;

let app = null;

const state = new StatefulSubscriptions({
  subscriptions: [{ name: 'onMessage', key: 'id' }],
});

let backup = [];
let lastPong = Date.now();

// resend messages from last ping
// it may send messages more than once
// in case the target already received messages between last ping and the reconnection
async function resendMessages(target) {
  const now = Date.now();
  const messagesToResend = backup.filter(
    (m) => m.timestamp > lastPong && m.timestamp <= now,
  );

  if (messagesToResend.length === 0) {
    if (DEBUG) {
      console.log('[PROXY] 📦 No messages to resend from backup');
    }
    return;
  }

  console.log(
    `[PROXY] 📦 Resending ${messagesToResend.length} messages from backup (since last pong: ${new Date(lastPong).toISOString()})`,
  );

  for (const m of messagesToResend) {
    if (DEBUG) {
      console.log(
        `[PROXY] 📤 Resending message from ${new Date(m.timestamp).toISOString()}:`,
        JSON.stringify(JSON.parse(m.message), null, 2),
      );
    }
    target.send(m.message);
    // introduce a small delay to avoid to flood the target
    await wait(250);
  }

  if (DEBUG) {
    console.log(
      `[PROXY] ✅ Finished resending ${messagesToResend.length} messages`,
    );
  }
}

const wsHooks = {
  onConnect: (_context, source, _target) => {
    const timestamp = new Date().toISOString();
    console.log(
      `[PROXY] 🔌 [${timestamp}] Client connected (clientId: ${source.clientId || 'pending'})`,
    );
  },

  onDisconnect: (_context, source, _target) => {
    const timestamp = new Date().toISOString();
    const backupCount = backup.length;

    if (DEBUG) {
      console.log(
        `[PROXY] 🔌❌ [${timestamp}] Client disconnected (clientId: ${source.clientId})`,
      );
      console.log(`[PROXY]   📦 Messages in backup: ${backupCount}`);
    }

    state.removeAllSubscriptions(source.clientId);
    // Clear backup on disconnect
    backup.length = 0;
    if (DEBUG) {
      console.log(
        `[PROXY]   🗑️  Cleared ${backupCount} messages from backup and removed all subscriptions`,
      );
    }
  },

  onReconnect: (_context, source, target) => {
    const timestamp = new Date().toISOString();
    const backupCount = backup.length;
    const timeSinceLastPong = Date.now() - lastPong;

    console.log(
      `[PROXY] 🔌🔄 [${timestamp}] Client reconnecting (clientId: ${source.clientId})`,
    );
    console.log(`[PROXY]   📦 Messages in backup: ${backupCount}`);
    console.log(`[PROXY]   ⏱️  Time since last pong: ${timeSinceLastPong}ms`);

    console.log('[PROXY] 🔌🔄 onReconnect', {
      clientId: source.clientId,
      timestamp,
      backupCount,
      timeSinceLastPong,
    });

    state.restoreSubscriptions(source.clientId, target);

    console.log(`[PROXY]   📤 Starting message resend process...`);
    // Resend messages from backup
    resendMessages(target);
  },

  onIncomingMessage: (_context, source, _target, message) => {
    const m = JSON.parse(message.data.toString('utf-8'));
    const timestamp = new Date().toISOString();
    source.clientId = m.id;

    if (m.type !== 'start') {
      return;
    }

    // Backup incoming messages for potential resend
    backup.push({ message: message.data.toString(), timestamp: Date.now() });

    if (DEBUG) {
      console.log('[PROXY] 📤 Adding subscription', {
        clientId: source.clientId,
        query: m.payload.query,
        variables: m.payload.variables,
      });
    }

    try {
      state.addSubscription(
        source.clientId,
        m.payload.query,
        m.payload.variables,
      );
    } catch (err) {
      console.error(
        { err, m, clientId: source.clientId, timestamp },
        '❌ Error adding subscription',
      );
    }
  },

  onOutgoingMessage: (_context, source, _target, message) => {
    const m = JSON.parse(message.data.toString('utf-8'));
    const timestamp = new Date().toISOString();

    if (m.type === 'data') {
      if (DEBUG) {
        console.log('[PROXY] 📤 Updating subscription state', {
          clientId: source.clientId,
          data: m.payload.data,
        });
      }
      state.updateSubscriptionState(source.clientId, m.payload.data);
    } else if (m.type === 'error') {
      console.log(
        `[PROXY] 📤❌ [${timestamp}] Outgoing error to client ${source.clientId}:`,
        m.payload,
      );
    } else if (m.type === 'complete') {
      state.removeSubscription(source.clientId);
      console.log(
        `[PROXY] 📤✅ [${timestamp}] Subscription completed for client ${source.clientId}`,
      );
    }
  },

  onPong: () => {
    const previousPong = lastPong;
    lastPong = Date.now();
    const oldBackupCount = backup.length;

    // clean backup from the last ping
    backup = backup.filter((message) => message.timestamp > lastPong);
    const newBackupCount = backup.length;
    const cleaned = oldBackupCount - newBackupCount;

    if (DEBUG) {
      console.log(
        `[PROXY] 🏓 [${new Date().toISOString()}] Received pong - heartbeat successful`,
      );
      console.log(
        `[PROXY]   ⏱️  Time since previous pong: ${lastPong - previousPong}ms`,
      );
      console.log(
        `[PROXY]   📦 Cleaned ${cleaned} old messages from backup (${newBackupCount} remaining)`,
      );
    }
  },
};

export async function start() {
  const port = process.env.PORT || 3001;

  const wsReconnect = {
    logs: true,
    pingInterval: PING_INTERVAL,
    reconnectOnClose: true,
  };

  app = fastify();

  app.register(fastifyHttpProxy, {
    upstream: 'http://localhost:4000/graphql',
    prefix: '/graphql',
    websocket: true,
    wsUpstream: 'ws://localhost:4000/graphql',
    wsReconnect,
    wsHooks,
  });

  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(
      '[PROXY] 🚀 Proxy server ready at http://localhost:3001/graphql',
    );
    console.log(
      '[PROXY] 🔗 Proxy subscription endpoint: ws://localhost:3001/graphql',
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

export async function stop() {
  if (app) {
    await app.close();
    app = null;
  }
}
