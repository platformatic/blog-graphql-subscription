import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { GraphQLClient } from './client.js';
import { start as startProxy, stop as stopProxy } from './proxy.js';
import { start, stop } from './server-unstable.js';

const CLIENTS = parseInt(process.env.CLIENTS) || 10;
const INTERVAL = parseInt(process.env.INTERVAL) || 500; // 500ms between messages - much faster for massive traffic
const DURATION = parseInt(process.env.DURATION) || 60_000; // Run for 60 seconds
const PROXY_PORT = parseInt(process.env.PROXY_PORT) || 3001;
const MESSAGES_PER_BURST = parseInt(process.env.MESSAGES_PER_BURST) || 5; // Send multiple messages per interval

// Global stats tracking
const globalStats = {
	totalMessagesSent: 0,
	totalMessagesReceived: 0,
	clientStats: new Map(),
	serverRestarts: 0,
	startTime: Date.now(),
};

class ClientTracker {
	constructor(clientId) {
		this.clientId = clientId;
		this.messagesSent = 0;
		this.messagesReceived = 0;
		this.lastReceivedMessageId = null;
		this.expectedMessages = new Set(); // Track messages we sent
		this.receivedMessages = new Set(); // Track messages we received
		this.connectionLost = 0;
		this.reconnections = 0;
		this.client = null;
		this.subscriptionId = null;
		this.isConnected = false;
	}

	async connect() {
		const endpoint = `ws://localhost:${PROXY_PORT}/graphql`;

		this.client = new GraphQLClient(endpoint);

		try {
			await this.client.connect();
			this.isConnected = true;

			// Subscribe with message tracking
			this.subscriptionId = this.client.subscribe((message) => {
				this.messagesReceived++;
				globalStats.totalMessagesReceived++;
				this.receivedMessages.add(message.id);
				this.lastReceivedMessageId = message.id;

				const timestamp = new Date(message.at).toLocaleTimeString();
				console.log(
					`📱 Client-${this.clientId} 🔄 [${this.messagesReceived}] received: [${timestamp}] ${message.user}: ${message.text}`,
				);
			});

			this.reconnections++;
			console.log(`✅ Client-${this.clientId} connected (proxy)`);
		} catch (error) {
			this.isConnected = false;
			console.error(
				`❌ Failed to connect Client-${this.clientId}:`,
				error.message,
			);
			throw error;
		}
	}

	async disconnect() {
		if (this.client && this.subscriptionId) {
			try {
				this.client.unsubscribe(this.subscriptionId);
				this.client.disconnect();
				this.isConnected = false;
			} catch (error) {
				console.error(
					`❌ Error disconnecting Client-${this.clientId}:`,
					error.message,
				);
			}
		}
	}

	async sendMessage(text) {
		if (!this.client || !this.isConnected) {
			console.warn(`⚠️ Client-${this.clientId} not connected, skipping message`);
			return null;
		}

		const messageId = randomUUID();
		const user = `User-${this.clientId}-Proxy`;

		try {
			const result = await this.client.sendMessage(
				user,
				`${text} [${messageId.slice(0, 8)}]`,
			);
			this.messagesSent++;
			globalStats.totalMessagesSent++;
			this.expectedMessages.add(result.id);

			console.log(
				`💬 Client-${this.clientId} 🔄 [${this.messagesSent}] sent: ${user}: ${text}`,
			);

			return result;
		} catch (error) {
			console.error(
				`❌ Client-${this.clientId} failed to send message:`,
				error.message,
			);
			this.connectionLost++;
			return null;
		}
	}

	getStats() {
		const lostMessages = Math.max(0, this.expectedMessages.size - this.receivedMessages.size);
		const deliveryRate =
			this.expectedMessages.size > 0
				? Math.min(100, (this.receivedMessages.size / this.expectedMessages.size) * 100).toFixed(2)
				: '0.00';

		return {
			clientId: this.clientId,
			messagesSent: this.messagesSent,
			messagesReceived: this.messagesReceived,
			expectedMessages: this.expectedMessages.size,
			receivedMessages: this.receivedMessages.size,
			lostMessages,
			deliveryRate: `${deliveryRate}%`,
			connectionLost: this.connectionLost,
			reconnections: this.reconnections,
			isConnected: this.isConnected,
		};
	}
}

async function createMassiveTraffic(clients) {
	const messages = [
		'High frequency message',
		'Stress test message',
		'Massive traffic simulation',
		'Load testing message',
		'Performance test data',
		'Heavy load message',
		'Burst test message',
		'Throughput test message',
		'Resilience test message',
		'Scale test message',
	];

	return setInterval(async () => {
		// Send multiple messages per interval to simulate massive traffic
		for (let i = 0; i < MESSAGES_PER_BURST; i++) {
			if (clients.length > 0) {
				// Pick random clients to send messages
				const randomClient =
					clients[Math.floor(Math.random() * clients.length)];
				const randomMessage =
					messages[Math.floor(Math.random() * messages.length)];

				// Send message asynchronously without waiting
				randomClient.sendMessage(randomMessage).catch((err) => {
					console.error(
						`Failed to send message for Client-${randomClient.clientId}:`,
						err.message,
					);
				});
			}

			// Small delay between bursts within the same interval
			if (i < MESSAGES_PER_BURST - 1) {
				await sleep(50); // 50ms between messages in a burst
			}
		}
	}, INTERVAL);
}

function printDetailedStats(clients) {
	console.log('\n📊 ======================================');
	console.log('📊 DETAILED MESSAGE DELIVERY STATISTICS');
	console.log('📊 ======================================');

	const totalRunTime = (Date.now() - globalStats.startTime) / 1000;

	console.log(`\n🕐 Runtime: ${totalRunTime.toFixed(1)}s`);
	console.log(`📤 Total Messages Sent: ${globalStats.totalMessagesSent}`);
	console.log(
		`📥 Total Messages Received: ${globalStats.totalMessagesReceived}`,
	);
	console.log(`🔄 Server Restarts: ${globalStats.serverRestarts}`);

	const overallDeliveryRate =
		globalStats.totalMessagesSent > 0
			? Math.min(100, (globalStats.totalMessagesReceived / globalStats.totalMessagesSent) * 100).toFixed(2)
			: '0.00';
	console.log(`📊 Overall Delivery Rate: ${overallDeliveryRate}%`);

	const messagesPerSecond = (
		globalStats.totalMessagesSent / totalRunTime
	).toFixed(2);
	console.log(`⚡ Messages/Second: ${messagesPerSecond}`);

	console.log('\n👥 PER-CLIENT STATISTICS (All via Proxy):');
	console.log('═══════════════════════════════════════');

	clients.forEach((client) => {
		const stats = client.getStats();
		console.log(`\n🔹 Client-${stats.clientId} (Proxy):`);
		console.log(`   📤 Sent: ${stats.messagesSent}`);
		console.log(`   📥 Received: ${stats.messagesReceived}`);
		console.log(`   📊 Delivery Rate: ${stats.deliveryRate}`);
		console.log(`   ❌ Lost: ${stats.lostMessages}`);
		console.log(`   🔌 Reconnections: ${stats.reconnections}`);
		console.log(`   🔗 Connected: ${stats.isConnected ? '✅' : '❌'}`);
	});

	// Overall proxy statistics
	const totalSent = clients.reduce((sum, c) => sum + c.messagesSent, 0);
	const totalReceived = clients.reduce((sum, c) => sum + c.messagesReceived, 0);
	const proxyDeliveryRate = totalSent > 0 ? Math.min(100, (totalReceived / totalSent) * 100).toFixed(2) : '0.00';

	console.log(`\n🔄 ALL PROXY CLIENTS SUMMARY:`);
	console.log(`   📤 Total Sent: ${totalSent}`);
	console.log(`   📥 Total Received: ${totalReceived}`);
	console.log(`   📊 Delivery Rate: ${proxyDeliveryRate}%`);
	console.log(`   👥 Active Clients: ${clients.filter(c => c.isConnected).length}/${clients.length}`);

	console.log('\n📊 ======================================\n');
}

async function runMassiveTrafficDemo() {
	console.log(
		'🚀 Starting MASSIVE TRAFFIC GraphQL Subscription Demo with Unstable Server',
	);
	console.log(
		'=========================================================================\n',
	);

	globalStats.startTime = Date.now();

	// Start the unstable server with auto-restart capability
	console.log('1️⃣ Starting unstable server with auto-restart...');
	const _serverProcess = null;

	async function startServer() {
		try {
			await start();
			globalStats.serverRestarts++;
			console.log(`🔄 Server started (restart #${globalStats.serverRestarts})`);
		} catch (err) {
			console.error('Server failed to start:', err);
			// Auto-restart after a delay
			setTimeout(startServer, 2000);
		}
	}

	await startServer();
	await sleep(2000); // Give server time to start

	// Start the proxy server
	console.log('2️⃣ Starting proxy server...');
	try {
		await startProxy();
	} catch (err) {
		console.error('Failed to start proxy server:', err);
		await stop();
		process.exit(1);
	}

	await sleep(1000);

	// Create many clients for massive traffic (all via proxy)
	console.log(
		`\n3️⃣ Creating ${CLIENTS} proxy clients for massive traffic simulation...`,
	);
	const clients = [];

	for (let i = 1; i <= CLIENTS; i++) {
		// All clients connect through proxy
		const clientTracker = new ClientTracker(i);

		try {
			await clientTracker.connect();
			clients.push(clientTracker);
			globalStats.clientStats.set(i, clientTracker);
			await sleep(200); // Stagger connections
		} catch (error) {
			console.error(`Failed to create Client-${i}:`, error.message);
		}
	}

	console.log(`✅ Created ${clients.length} proxy clients successfully`);

	// Start massive traffic generation
	console.log('4️⃣ Starting MASSIVE TRAFFIC generation...\n');
	console.log(`🔥 Sending ${MESSAGES_PER_BURST} messages every ${INTERVAL}ms`);
	console.log(
		`⚡ Expected ~${(MESSAGES_PER_BURST * 1000) / INTERVAL} messages/second\n`,
	);

	const trafficInterval = await createMassiveTraffic(clients);

	// Print periodic stats
	const statsInterval = setInterval(() => {
		printDetailedStats(clients);
	}, 10000); // Print stats every 10 seconds

	// Run for specified duration
	console.log(
		`⏰ Demo will run for ${DURATION / 1000} seconds with massive traffic...\n`,
	);
	await sleep(DURATION);

	// Clean up
	console.log('\n5️⃣ Cleaning up...');
	clearInterval(trafficInterval);
	clearInterval(statsInterval);

	// Final detailed statistics
	printDetailedStats(clients);

	// Disconnect all clients
	console.log('🔌 Disconnecting all clients...');
	for (const client of clients) {
		await client.disconnect();
	}

	// Stop servers
	console.log('🛑 Stopping proxy server...');
	await stopProxy();

	console.log('🛑 Stopping unstable server...');
	await stop();

	console.log('\n✅ Massive traffic demo completed!');
	console.log('==================================');
}

// Enhanced error handling with auto-restart
process.on('uncaughtException', (error) => {
	if (error.message === 'UNHANDLED EXCEPTION') {
		console.log('🔄 Server crashed, restarting...');
		globalStats.serverRestarts++;
		// The server will be restarted by the monitoring process
		setTimeout(() => {
			start().catch(console.error);
		}, 1000);
	} else {
		console.error('❌ Uncaught Exception:', error);
		process.exit(1);
	}
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
	console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
	try {
		await stopProxy();
		await stop();
	} catch (error) {
		console.error('Error stopping servers:', error.message);
	}
	process.exit(0);
});

process.on('SIGTERM', async () => {
	console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
	try {
		await stopProxy();
		await stop();
	} catch (error) {
		console.error('Error stopping servers:', error.message);
	}
	process.exit(0);
});

// Run the massive traffic demo
runMassiveTrafficDemo().catch((error) => {
	console.error('❌ Massive traffic demo failed:', error.message);
	process.exit(1);
});
