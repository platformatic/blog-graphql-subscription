import { setTimeout as sleep } from 'node:timers/promises';
import { GraphQLClient } from './client.js';
import { start as startProxy, stop as stopProxy } from './proxy.js';
import {
  start as startServer,
  stop as stopServer,
} from './server-with-resume.js';

const CLIENTS = process.env.CLIENTS || 3;
const INTERVAL = process.env.INTERVAL || 2_000; // 2 seconds between messages
const DURATION = process.env.DURATION || 10_000; // Run for 10 seconds
const PROXY_PORT = process.env.PROXY_PORT || 3001;

async function createClient(clientId) {
  const endpoint = `ws://localhost:${PROXY_PORT}/graphql`;
  const client = new GraphQLClient(endpoint);

  try {
    await client.connect();

    // Subscribe to messages with a handler that shows which client received the message
    const subscriptionId = client.subscribe((message) => {
      const timestamp = new Date(message.at).toLocaleTimeString();
      console.log(
        `📱 Client-${clientId} 🔄 received: [${timestamp}] ${message.user}: ${message.text}`,
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
    'Hello everyone via proxy!',
    'How is everyone doing through the proxy?',
    'GraphQL subscriptions with reconnection are awesome!',
    'Real-time messaging works great with proxy!',
    'Testing the proxy broadcast functionality',
    'Anyone there through the proxy?',
    'This is a resumable test message',
    'Proxy subscriptions are working perfectly!',
  ];

  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  const user = `User-${clientId}-Proxy`;

  try {
    await client.sendMessage(user, randomMessage);
    console.log(`💬 Client-${clientId} 🔄 sent: ${user}: ${randomMessage}`);
  } catch (error) {
    console.error(
      `❌ Client-${clientId} failed to send message:`,
      error.message,
    );
  }
}

async function runProxyDemo() {
  console.log('🚀 Starting GraphQL Proxy Subscription Demo');
  console.log('==========================================\n');

  // Start the backend server
  console.log('1️⃣ Starting resumable server...');
  try {
    await startServer();
    await sleep(1000); // Give server time to start
  } catch (err) {
    console.error('Failed to start backend server:', err);
    process.exit(1);
  }

  // Start the proxy server
  console.log('2️⃣ Starting proxy server...');
  try {
    await startProxy();
    console.log(
      `📡 Proxy connects to backend at: http://localhost:4000/graphql`,
    );
  } catch (err) {
    console.error('Failed to start proxy server:', err);
    await stopServer();
    process.exit(1);
  }

  await sleep(1000); // Give proxy time to start

  // Create multiple clients - all connecting through proxy
  console.log(
    `\n3️⃣ Creating ${CLIENTS} clients (all connecting through proxy)...`,
  );
  const clients = [];

  for (let i = 1; i <= CLIENTS; i++) {
    const clientWrapper = await createClient(i);
    if (clientWrapper) {
      clients.push(clientWrapper);
      await sleep(500); // Stagger client connections
    }
  }

  console.log(`✅ Created ${clients.length} proxy clients successfully\n`);

  // Start sending messages
  console.log('4️⃣ Starting message exchange through proxy...\n');

  const messageInterval = setInterval(() => {
    if (clients.length > 0) {
      // Pick a random client to send a message
      const randomClient = clients[Math.floor(Math.random() * clients.length)];
      sendRandomMessage(randomClient);
    }
  }, INTERVAL).unref();

  // Run for specified duration
  console.log(`⏰ Demo will run for ${DURATION / 1000} seconds...\n`);
  await sleep(DURATION);

  // Clean up
  console.log('\n5️⃣ Cleaning up...');
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

  // Stop the proxy server
  console.log('🛑 Stopping proxy server...');
  await stopProxy();

  // Stop the backend server
  console.log('🛑 Stopping resumable server...');
  await stopServer();

  console.log('\n✅ Proxy demo completed successfully!');
  console.log('=====================================');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
  try {
    await stopProxy();
    await stopServer();
  } catch (error) {
    console.error('Error stopping servers:', error.message);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
  try {
    await stopProxy();
    await stopServer();
  } catch (error) {
    console.error('Error stopping servers:', error.message);
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

// Run the proxy demo
runProxyDemo().catch((error) => {
  console.error('❌ Proxy demo failed:', error.message);
  process.exit(1);
});
