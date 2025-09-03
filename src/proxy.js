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

const wsHooks = {
  onConnect: (_context, source, _target) => {
    if (DEBUG) {
      const timestamp = new Date().toISOString();
      console.log(
        `[PROXY] 🔌 [${timestamp}] Client connected (clientId: ${source.id || 'pending'})`,
      );
    }
  },

  onDisconnect: (_context, source, _target) => {
    const timestamp = new Date().toISOString();

    if (DEBUG) {
      console.log(
        `[PROXY] 🔌❌ [${timestamp}] Client disconnected (clientId: ${source.id})`,
      );
    }

    state.removeAllSubscriptions(source.id);
    if (DEBUG) {
      console.log(
        `[PROXY]   🗑️  Removed all subscriptions for client ${source.id}`,
      );
    }
  },

  onReconnect: (_context, source, target) => {
    // don't reconnect if the demo is done
    if (process.env.DONE) {
      return;
    }
    const timestamp = new Date().toISOString();

    console.log(
      `[PROXY] 🔌🔄 [${timestamp}] Client reconnecting (clientId: ${source.id})`,
    );

    console.log('[PROXY] 🔌🔄 onReconnect', {
      clientId: source.id,
      timestamp,
    });

    state.restoreSubscriptions(source.id, target);
  },

  onIncomingMessage: (_context, source, _target, message) => {
    const m = JSON.parse(message.data.toString('utf-8'));
    const timestamp = new Date().toISOString();
    if (!source.id) {
      source.id = m.id || randomUUID();
    }

    if (m.type !== 'start') {
      return;
    }

    if (DEBUG) {
      console.log('[PROXY] 📤 Adding subscription', {
        clientId: source.id,
        query: m.payload.query,
        variables: m.payload.variables,
      });
    }

    try {
      state.addSubscription(source.id, m.payload.query, m.payload.variables);
    } catch (err) {
      console.error(
        { err, m, clientId: source.id, timestamp },
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
          clientId: source.id,
          data: m.payload.data,
        });
      }
      state.updateSubscriptionState(source.id, m.payload.data);
    } else if (m.type === 'error') {
      if (DEBUG) {
        console.log(
          `[PROXY] 📤❌ [${timestamp}] Outgoing error to client ${source.id}:`,
          m.payload,
        );
      }
    } else if (m.type === 'complete') {
      state.removeSubscription(source.id);
      console.log(
        `[PROXY] 📤✅ [${timestamp}] Subscription completed for client ${source.id}`,
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
