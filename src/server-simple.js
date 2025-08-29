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
    onMessage: Message
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
			subscribe: async (_, __, { pubsub }) => {
				return pubsub.subscribe('MESSAGE_SENT');
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
		console.log('🚀 Server ready at http://localhost:4000/graphql');
		console.log('🔗 Subscription endpoint: ws://localhost:4000/graphql');
	} catch (err) {
		app.log.error(err);
		process.exit(1);
	}
}

export async function stop() {
	await app.close();
}
