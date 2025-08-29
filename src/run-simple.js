import { setTimeout as sleep } from 'node:timers/promises';
import { GraphQLClient } from './client.js';
import { start, stop } from './server-simple.js';

const CLIENTS = process.env.CLIENTS || 3;
const INTERVAL = process.env.INTERVAL || 2_000; // 2 seconds between messages
const DURATION = process.env.DURATION || 10_000; // Run for 10 seconds

async function createClient(clientId) {
	const client = new GraphQLClient();

	try {
		await client.connect();

		// Subscribe to messages with a handler that shows which client received the message
		const subscriptionId = client.subscribe((message) => {
			const timestamp = new Date(message.at).toLocaleTimeString();
			console.log(
				`📱 Client-${clientId} received: [${timestamp}] ${message.user}: ${message.text}`,
			);
		});

		return { client, subscriptionId, clientId };
	} catch (error) {
		console.error(`❌ Failed to create Client-${clientId}:`, error.message);
		return null;
	}
}

async function sendRandomMessage(clientWrapper) {
	const { client, clientId } = clientWrapper;
	const messages = [
		'Hello everyone!',
		'How is everyone doing?',
		'GraphQL subscriptions are awesome!',
		'Real-time messaging works great!',
		'Testing the broadcast functionality',
		'Anyone there?',
		'This is a test message',
		'Subscriptions are working perfectly!',
	];

	const randomMessage = messages[Math.floor(Math.random() * messages.length)];
	const user = `User-${clientId}`;

	try {
		await client.sendMessage(user, randomMessage);
		console.log(`💬 Client-${clientId} sent: ${user}: ${randomMessage}`);
	} catch (error) {
		console.error(
			`❌ Client-${clientId} failed to send message:`,
			error.message,
		);
	}
}

async function runDemo() {
	console.log('🚀 Starting GraphQL Subscription Demo');
	console.log('=====================================\n');

	// Start the server
	console.log('1️⃣ Starting server...');
	await start();
	await sleep(1000); // Give server time to start

	// Create multiple clients
	console.log(`\n2️⃣ Creating ${CLIENTS} clients...`);
	const clients = [];

	for (let i = 1; i <= CLIENTS; i++) {
		const clientWrapper = await createClient(i);
		if (clientWrapper) {
			clients.push(clientWrapper);
			await sleep(500); // Stagger client connections
		}
	}

	console.log(`✅ Created ${clients.length} clients successfully\n`);

	// Start sending messages
	console.log('3️⃣ Starting message exchange...\n');

	const messageInterval = setInterval(() => {
		if (clients.length > 0) {
			// Pick a random client to send a message
			const randomClient = clients[Math.floor(Math.random() * clients.length)];
			sendRandomMessage(randomClient);
		}
	}, INTERVAL);

	// Run for specified duration
	console.log(`⏰ Demo will run for ${DURATION / 1000} seconds...\n`);
	await sleep(DURATION);

	// Clean up
	console.log('\n4️⃣ Cleaning up...');
	clearInterval(messageInterval);

	// Disconnect all clients
	for (const { client, subscriptionId, clientId } of clients) {
		try {
			client.unsubscribe(subscriptionId);
			client.disconnect();
			console.log(`🔌 Client-${clientId} disconnected`);
		} catch (error) {
			console.error(
				`❌ Error disconnecting Client-${clientId}:`,
				error.message,
			);
		}
	}

	// Stop the server
	console.log('🛑 Stopping server...');
	await stop();

	console.log('\n✅ Demo completed successfully!');
	console.log('=====================================');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
	console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
	try {
		await stop();
	} catch (error) {
		console.error('Error stopping server:', error.message);
	}
	process.exit(0);
});

process.on('SIGTERM', async () => {
	console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
	try {
		await stop();
	} catch (error) {
		console.error('Error stopping server:', error.message);
	}
	process.exit(0);
});

// Enhanced error handling
process.on('unhandledRejection', (reason, promise) => {
	console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
	process.exit(1);
});

process.on('uncaughtException', (error) => {
	console.error('❌ Uncaught Exception:', error);
	process.exit(1);
});

// Run the demo
runDemo().catch((error) => {
	console.error('❌ Demo failed:', error.message);
	process.exit(1);
});
