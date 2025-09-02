import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import mercurius from 'mercurius';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const SUBSCRIPTION_PROBLEM_CHANCE = process.env.SUBSCRIPTION_PROBLEM_CHANCE
  ? parseFloat(process.env.SUBSCRIPTION_PROBLEM_CHANCE)
  : 1;

const MESSAGE_DELAY = process.env.MESSAGE_DELAY
  ? parseInt(process.env.MESSAGE_DELAY, 10)
  : 5;

const TRIGGER_PROBLEM_MIN = process.env.TRIGGER_PROBLEM_MIN
  ? parseInt(process.env.TRIGGER_PROBLEM_MIN, 10)
  : 2_000;
const TRIGGER_PROBLEM_MAX = process.env.TRIGGER_PROBLEM_MAX
  ? parseInt(process.env.TRIGGER_PROBLEM_MAX, 10)
  : 5_000;

const problems = ['unresponsive', 'close_connection', 'break_connection'];
const subscriptionProblems = {};
let problemIndex = 0;
function scheduleSubscriptionProblem(subscriptionId) {
  problemStats.totalSubscriptions++;

  // Check if this subscription should have problems
  if (Math.random() > SUBSCRIPTION_PROBLEM_CHANCE) {
    console.log(
      `[GRAPHQL SERVER] 🚨 Subscription ${subscriptionId} won't have problems`,
    );
    problemStats.subscriptionsWithoutProblems++;
    return; // This subscription won't have problems
  }

  problemStats.subscriptionsWithProblems++;

  // random
  // const problem = problems[Math.floor(Math.random() * problems.length)];
  // round robin
  const p = problems[problemIndex];
  problemIndex = (problemIndex + 1) % problems.length;

  const timeout = Math.round(
    TRIGGER_PROBLEM_MIN +
      Math.random() * (TRIGGER_PROBLEM_MAX - TRIGGER_PROBLEM_MIN),
  );
  console.log(`[GRAPHQL SERVER] 🚨 Scheduling subscription problem`, {
    subscriptionId,
    problem: p,
    timeout,
  });

  subscriptionProblems[subscriptionId] = {
    subscriptionId,
    [p]: { timeout },
  };

  return subscriptionProblems[subscriptionId];
}

async function triggerProblem(problem, context) {
  if (problem?.unresponsive) {
    setTimeout(() => {
      problemStats.problemsTriggered.unresponsive++;
      console.error('[GRAPHQL SERVER] ⏰ Subscription became unresponsive', {
        subscriptionId: problem.subscriptionId,
      });

      problem.run = true;
    }, problem.unresponsive.timeout).unref();
  } else if (problem?.close_connection) {
    setTimeout(() => {
      problemStats.problemsTriggered.close_connection++;
      console.error(
        '[GRAPHQL SERVER] 🔌 Gracefully closing subscription connection',
        {
          subscriptionId: problem.subscriptionId,
        },
      );

      context.request.raw.socket.end();
    }, problem.close_connection.timeout).unref();
  } else if (problem?.break_connection) {
    setTimeout(() => {
      problemStats.problemsTriggered.break_connection++;
      console.error(
        '[GRAPHQL SERVER] ⛓️‍💥 Force breaking subscription connection',
        { subscriptionId: problem.subscriptionId },
      );
      context.request.raw.socket.destroy();
    }, problem.break_connection.timeout).unref();
  }
  clearSubscriptionProblem(problem.subscriptionId);
}

function clearSubscriptionProblem(subscriptionId) {
  for (const problem in subscriptionProblems[subscriptionId]) {
    const t = subscriptionProblems[subscriptionId][problem];
    t && clearTimeout(t);
  }
  delete subscriptionProblems[subscriptionId];
}

function clearSubscriptionProblems() {
  for (const subscriptionId in subscriptionProblems) {
    clearSubscriptionProblem(subscriptionId);
  }
}

// Problem statistics tracking
const problemStats = {
  totalSubscriptions: 0,
  subscriptionsWithProblems: 0,
  subscriptionsWithoutProblems: 0,
  problemsTriggered: {
    unresponsive: 0,
    break_connection: 0,
    close_connection: 0,
  },
  problemsScheduled: {
    unresponsive: 0,
    break_connection: 0,
    close_connection: 0,
  },
};

class Pubsub {
  constructor(options) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
    this.onClose = options?.onClose ?? (() => {});
    this.subscriptions = new Map();
  }

  async subscribe(topic, queue, context, id) {
    const subscriptionId = context.id || randomUUID();
    // Schedule potential problems for this specific subscription
    const problem = scheduleSubscriptionProblem(subscriptionId);

    // dont respond to ping if the subscription became unresponsive
    context.ws.on('ping', () => {
      if (problem?.unresponsive && problem?.run) {
        return;
      }
      context.ws.pong();
    });

    const listener = async (message) => {
      // Become unresponsive
      // This will trigger a reconnection on proxy connection control
      if (problem?.unresponsive && problem?.run) {
        return;
      }
      await sleep(MESSAGE_DELAY);

      if (DEBUG) {
        console.log('[GRAPHQL SERVER] 🚨 Sending message', message);
      }
      queue.push(message);
    };
    const close = () => {
      this.emitter.removeListener(topic, listener);
    };
    const subscription = {
      topic,
      args: { id },
      queue,
      context,
      listener,
      close,
    };
    this.emitter.on(topic, subscription.listener);
    queue.on('close', subscription.close);

    this.subscriptions.set(subscriptionId, subscription);

    // Trigger the problem
    if (problem) {
      await triggerProblem(problem, context);
    }

    if (!id) {
      return;
    }

    const startIndex = storage.messages.findIndex((msg) => msg.id === id);

    if (startIndex !== -1) {
      console.log(
        '[GRAPHQL SERVER] 🚨 Starting from message id',
        id,
        startIndex,
      );
      const messagesToSend = storage.messages.slice(startIndex + 1);
      for (const message of messagesToSend) {
        // no delay on resend
        if (DEBUG) {
          console.log('[GRAPHQL SERVER] 🚨 Resending message', message);
        }
        queue.push({ onMessage: message });
      }
    } else {
      if (DEBUG) {
        console.log('[GRAPHQL SERVER] 🚨 Message id not found', id);
      }
    }
  }

  send(topic, message) {
    this.emitter.emit(topic, message);
  }

  close() {
    this.emitter.removeAllListeners();
    this.onClose();
  }
}

// Create the custom pubsub instance
const pubsub = new Pubsub();

const app = Fastify();

// Register @fastify/websocket before mercurius to disable autoPong to simulate unstable server
app.register(fastifyWebsocket, {
  options: {
    autoPong: false,
    maxPayload: 1048576,
  },
});

const schema = `
  type Message {
    id: ID!
    text: String!
    user: String!
    at: String!
  }

  type Query {
    messages: [Message]
  }

  type Mutation {
    sendMessage(text: String!, user: String!): Message
  }

  type Subscription {
    onMessage(id: String): Message
  }
`;

const storage = {
  messages: [],
};

const resolvers = {
  Query: {
    messages: () => storage.messages,
  },
  Mutation: {
    sendMessage: async (_, { text, user }, { pubsub }) => {
      const message = {
        id: randomUUID(),
        text,
        user,
        at: new Date().toISOString(),
      };
      storage.messages.push(message);

      pubsub.send('MESSAGE_SENT', { onMessage: message });

      return message;
    },
  },
  Subscription: {
    onMessage: {
      subscribe: (_, { id }, context, _info) => {
        console.log('[GRAPHQL SERVER] 🔗 Subscription started', {
          fromMessageId: id,
          query: context.__currentQuery,
        });
        return context.pubsub.subscribe('MESSAGE_SENT', context, id);
      },
    },
  },
};

app.register(mercurius, {
  schema,
  resolvers,
  subscription: {
    context: (ws, _request) => {
      return { ws };
    },
    pubsub,
  },
  graphiql: true,
});

export async function start() {
  try {
    await app.listen({ port: 4000, host: '0.0.0.0' });
    console.log(
      '[GRAPHQL SERVER] 🚀 Unstable Server ready at http://localhost:4000/graphql',
    );
    console.log(
      '[GRAPHQL SERVER] 🔗 Subscription endpoint: ws://localhost:4000/graphql',
    );
    console.log(
      '[GRAPHQL SERVER] 📝 Subscriptions support resuming from specific message IDs',
    );
    console.log(
      '[GRAPHQL SERVER] ⚠️  Subscriptions will randomly become unresponsive or close connections',
    );
    console.log(
      `[GRAPHQL SERVER] 📊 Per-subscription problem chance: ${SUBSCRIPTION_PROBLEM_CHANCE * 100}%`,
    );
  } catch (err) {
    console.error('[GRAPHQL SERVER] 🚨 Error starting server', err);
    process.exit(1);
  }
}

export async function stop() {
  clearSubscriptionProblems();

  // Generate problem report
  const totalTriggered = Object.values(problemStats.problemsTriggered).reduce(
    (sum, count) => sum + count,
    0,
  );
  const totalScheduled = Object.values(problemStats.problemsScheduled).reduce(
    (sum, count) => sum + count,
    0,
  );

  console.log('[GRAPHQL SERVER] \n📊 === PROBLEM REPORT ===');
  console.log(
    `[GRAPHQL SERVER] 📈 Total Subscriptions: ${problemStats.totalSubscriptions}`,
  );
  console.log(
    `[GRAPHQL SERVER] ✅ Subscriptions without problems: ${problemStats.subscriptionsWithoutProblems} (${problemStats.totalSubscriptions > 0 ? ((problemStats.subscriptionsWithoutProblems / problemStats.totalSubscriptions) * 100).toFixed(1) : 0}%)`,
  );
  console.log(
    `[GRAPHQL SERVER] ⚠️  Subscriptions with problems: ${problemStats.subscriptionsWithProblems} (${problemStats.totalSubscriptions > 0 ? ((problemStats.subscriptionsWithProblems / problemStats.totalSubscriptions) * 100).toFixed(1) : 0}%)`,
  );

  console.log('\n[GRAPHQL SERVER] 🚨 Problems:');
  console.log(
    `[GRAPHQL SERVER]   ⏰ unresponsive: ${problemStats.problemsTriggered.unresponsive} / ${problemStats.problemsScheduled.unresponsive}`,
  );
  console.log(
    `[GRAPHQL SERVER]   ⛓️‍💥 break_connection: ${problemStats.problemsTriggered.break_connection} / ${problemStats.problemsScheduled.break_connection}`,
  );
  console.log(
    `[GRAPHQL SERVER]   🔌 close_connection: ${problemStats.problemsTriggered.close_connection} / ${problemStats.problemsScheduled.close_connection}`,
  );
  console.log(
    `[GRAPHQL SERVER]    Total problems: ${totalTriggered} / ${totalScheduled}`,
  );

  console.log('\n[GRAPHQL SERVER] ⚙️  Configuration:');
  console.log(
    `[GRAPHQL SERVER]   🎲 Problem chance: ${SUBSCRIPTION_PROBLEM_CHANCE * 100}%`,
  );
  console.log(
    `[GRAPHQL SERVER]   ⏱️  Problem unresponsive range: ${TRIGGER_PROBLEM_MIN}ms - ${TRIGGER_PROBLEM_MAX}ms`,
  );

  console.log('[GRAPHQL SERVER] === END REPORT ===\n');

  await app.close();
}

if (process.env.RUN === 'true' || process.env.RUN === '1') {
  start();
}

export { app };
