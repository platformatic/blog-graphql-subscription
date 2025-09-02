import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import mercurius from 'mercurius';

const app = Fastify();

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

      // Publish to subscription
      await pubsub.publish({
        topic: 'MESSAGE_SENT',
        payload: { onMessage: message },
      });

      return message;
    },
  },
  Subscription: {
    onMessage: {
      subscribe: async (_, { id }, { pubsub }) => {
        if (!id) {
          // Default behavior: just subscribe to new messages
          return pubsub.subscribe('MESSAGE_SENT');
        }
        // If an id is provided, send all messages starting from that id first
        // Find the index of the message with the given id
        const startIndex = storage.messages.findIndex((msg) => msg.id === id);

        if (startIndex !== -1) {
          // Send all messages from that point forward
          const messagesToSend = storage.messages.slice(startIndex);

          // Create a custom async iterator that first sends existing messages
          // then subscribes to new ones
          return (async function* () {
            // Send existing messages first
            for (const message of messagesToSend) {
              yield { onMessage: message };
            }

            // Then subscribe to new messages
            const subscription = await pubsub.subscribe('MESSAGE_SENT');
            let resumeFromNext = false;

            for await (const message of subscription) {
              // Start yielding new messages only after we see the last stored message
              // or immediately if we don't have any stored messages
              if (messagesToSend.length === 0 || resumeFromNext) {
                yield message;
              } else if (
                message.onMessage.id ===
                messagesToSend[messagesToSend.length - 1].id
              ) {
                // Found the last stored message in the live stream, start yielding from next message
                resumeFromNext = true;
              }
            }
          })();
        }
      },
    },
  },
};

app.register(mercurius, {
  schema,
  resolvers,
  subscription: true,
  graphiql: true,
});

export async function start() {
  try {
    await app.listen({ port: 4000, host: '0.0.0.0' });
    console.log('🚀 Resumable Server ready at http://localhost:4000/graphql');
    console.log('🔗 Subscription endpoint: ws://localhost:4000/graphql');
    console.log('📝 Subscriptions support resuming from specific message IDs');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

export async function stop() {
  await app.close();
}

export { app };
