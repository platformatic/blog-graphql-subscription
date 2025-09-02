import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { GraphQLClient } from './client.js';
import { start as startProxy, stop as stopProxy } from './proxy.js';
import { start, stop } from './server-unstable.js';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const PROXY_PORT = parseInt(process.env.PROXY_PORT, 10) || 3001;

const CLIENTS = parseInt(process.env.CLIENTS, 10) || 5;
const MESSAGES = parseInt(process.env.MESSAGES, 10) || 1_000; // Total messages to send
const DURATION = parseInt(process.env.DURATION, 10) || 30_000;
const MESSAGES_PER_BURST = parseInt(process.env.MESSAGES_PER_BURST, 10) || 100; // Send multiple messages per interval
const BURST_PAUSE = parseInt(process.env.BURST_PAUSE, 10) || 100;

const messages = [
  'Banana!',
  'Poopaye!',
  'Hana, dul, sae!',
  'Kampai!',
  'Tulaliloo ti amo!',
  'Bello!',
];

// Global stats tracking
const globalStats = {
  startTime: Date.now(),
  clientStats: new Map(),
  sentMessages: [],
  duplicatedMessages: [],
};

// Function to group consecutive numbers into intervals
function groupConsecutiveNumbers(numbers) {
  if (numbers.length === 0) return [];

  // Sort numbers to ensure proper grouping
  const sortedNumbers = [...numbers].sort((a, b) => a - b);
  const intervals = [];
  let start = sortedNumbers[0];
  let end = sortedNumbers[0];

  for (let i = 1; i < sortedNumbers.length; i++) {
    if (sortedNumbers[i] === end + 1) {
      // Consecutive number, extend the current interval
      end = sortedNumbers[i];
    } else {
      // Gap found, close current interval and start a new one
      if (start === end) {
        intervals.push(start.toString());
      } else {
        intervals.push(`${start}-${end}`);
      }
      start = sortedNumbers[i];
      end = sortedNumbers[i];
    }
  }

  // Add the last interval
  if (start === end) {
    intervals.push(start.toString());
  } else {
    intervals.push(`${start}-${end}`);
  }

  return intervals;
}

class ClientTracker {
  constructor(clientId) {
    this.clientId = clientId;
    this.sentMessages = [];
    this.receivedMessages = [];
    this.lastReceivedMessageId = null;
    this.client = null;
    this.subscriptionId = null;
    this.isConnected = false;
  }

  async connect() {
    const endpoint = `ws://localhost:${PROXY_PORT}/graphql`;

    this.client = new GraphQLClient(endpoint, this.clientId);

    try {
      await this.client.connect();
      this.isConnected = true;

      // Subscribe with message tracking
      this.subscriptionId = this.client.subscribe((message) => {
        if (this.receivedMessages.includes(message.id)) {
          console.warn(
            `❌ Client ${this.clientId} received duplicate message: ${message.id}`,
          );
          globalStats.duplicatedMessages.push({
            clientId: this.clientId,
            messageId: message.id,
          });
          return;
        }
        this.receivedMessages.push(message.id);
        this.lastReceivedMessageId = message.id;

        if (DEBUG) {
          const timestamp = new Date(message.at).toLocaleTimeString();
          console.log(
            `📱 Client ${this.clientId} 🔄 [${this.receivedMessages.length}] received: [${timestamp}] ${message.user}: ${message.text}`,
          );
        }
      });

      console.log(`✅ Client ${this.clientId} connected`);
    } catch (error) {
      this.isConnected = false;
      console.error(
        `❌ Failed to connect Client ${this.clientId}:`,
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
          `❌ Error disconnecting Client ${this.clientId}:`,
          error.message,
        );
      }
    }
  }

  async sendMessage(text, index) {
    if (!this.client || !this.isConnected) {
      console.warn(`⚠️ Client ${this.clientId} not connected, skipping message`);
      return null;
    }

    const messageId = randomUUID();
    const user = `Minion-${this.clientId}`;

    try {
      const result = await this.client.sendMessage(
        user,
        `${text} [${messageId.slice(0, 8)}]`,
      );
      this.sentMessages.push(result.id);
      globalStats.sentMessages.push(result.id);

      if (DEBUG) {
        console.log(
          `💬 Client ${this.clientId} 🔄 [${index}] sent: ${user}: ${text}`,
        );
      }

      return result;
    } catch (error) {
      console.error(
        `❌ Client ${this.clientId} failed to send message:`,
        error.message,
      );
      return null;
    }
  }
}

async function createMassiveTraffic(clients) {
  // Send multiple messages per interval to simulate massive traffic
  for (let i = 0; i < MESSAGES; i++) {
    // Pick random clients to send messages
    const randomClient = clients[Math.floor(Math.random() * clients.length)];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    // Send message asynchronously without waiting
    randomClient.sendMessage(randomMessage, i).catch((err) => {
      console.error(
        `Failed to send message for Client ${randomClient.clientId}:`,
        err.message,
      );
    });

    // Small delay between bursts within the same interval
    if (i % MESSAGES_PER_BURST === 0) {
      await sleep(BURST_PAUSE);
    } else {
      // Break the loop
      await sleep(10);
    }
  }

  console.log(`✅ Sent ${MESSAGES} messages`);
}

function printDetailedStats(clients) {
  console.log('\n📊 ======================================');
  console.log('📊 DETAILED MESSAGE DELIVERY STATISTICS');
  console.log('📊 ======================================');

  const totalRunTime = (Date.now() - globalStats.startTime) / 1000;

  const totalSentMessages = clients.reduce(
    (sum, c) => sum + c.sentMessages.length,
    0,
  );
  const messagesPerSecond = (totalSentMessages / totalRunTime).toFixed(2);

  console.log('\n👥 PER-CLIENT STATISTICS:');
  console.log('═══════════════════════════════════════');

  let overallMisses = 0;
  clients.forEach((client) => {
    // check lost messages
    const missingIndices = [];
    for (const sentMessage of globalStats.sentMessages) {
      if (!client.receivedMessages.includes(sentMessage)) {
        missingIndices.push(globalStats.sentMessages.indexOf(sentMessage));
      }
    }
    const deliveryRate =
      globalStats.sentMessages.length > 0
        ? (
            ((globalStats.sentMessages.length - missingIndices.length) /
              globalStats.sentMessages.length) *
            100
          ).toFixed(2)
        : '100.00';

    console.log(`\n🔹 Client ${client.clientId}:`);
    console.log(`   📤 Sent: ${client.sentMessages.length}`);
    console.log(
      `   📥 Received: ${client.receivedMessages.length} ${missingIndices.length > 0 ? '❌' : '✅'}`,
    );
    console.log(
      `   ❌ Lost Messages: ${missingIndices.length} ${missingIndices.length > 0 ? '❌' : '✅'}`,
    );
    if (missingIndices.length > 0) {
      const intervals = groupConsecutiveNumbers(missingIndices);
      console.log(`   ❌ Lost Messages indices: ${intervals.join(', ')}`);
    }
    console.log(
      `   📊 Delivery Rate: ${deliveryRate}% ${deliveryRate === '100.00' ? '✅' : '❌'}`,
    );

    overallMisses += missingIndices.length;
  });

  const overallDeliveryRate =
    overallMisses > 0
      ? (
          100 -
          (globalStats.sentMessages.length / overallMisses / clients.length) *
            100
        ).toFixed(2)
      : '100.00';

  console.log('\n👥 OVERALL STATISTICS:');
  console.log('═══════════════════════════════════════');

  console.log(`\n🕐 Runtime: ${totalRunTime.toFixed(1)}s`);
  console.log(
    `📊 Overall Delivery Rate: ${overallDeliveryRate}% ${overallDeliveryRate === '100.00' ? '✅' : '❌'}`,
  );
  console.log(
    `📊 Duplicated Messages: ${globalStats.duplicatedMessages.length} ${globalStats.duplicatedMessages.length > 0 ? '❌' : '✅'}`,
  );
  console.log(`⚡ Messages/Second: ${messagesPerSecond}`);

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

  // Start the unstable server
  console.log('1️⃣ Starting unstable server ...');

  async function startServer() {
    try {
      await start();
      console.log(`🔄 Server started`);
    } catch (err) {
      console.error('Server failed to start:', err);
      // Auto-restart after a delay
      setTimeout(startServer, 2000).unref();
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

  // Create many clients for massive traffic
  console.log(
    `\n3️⃣ Creating ${CLIENTS} clients for massive traffic simulation...`,
  );
  const clients = [];

  for (let i = 1; i <= CLIENTS; i++) {
    const clientTracker = new ClientTracker(i);

    try {
      await clientTracker.connect();
      clients.push(clientTracker);
      globalStats.clientStats.set(i, clientTracker);
      await sleep(200); // Stagger connections
    } catch (error) {
      console.error(`Failed to create Client ${i}:`, error.message);
    }
  }

  console.log(`✅ Created ${clients.length} clients successfully`);

  // Start massive traffic generation
  console.log('4️⃣ Starting MASSIVE TRAFFIC generation...\n');
  console.log(
    `🔥 Sending ${MESSAGES} messages, ${MESSAGES_PER_BURST} messages every ${BURST_PAUSE}ms`,
  );

  // Wait for all clients to be connected
  await sleep(1000);

  createMassiveTraffic(clients);

  // Run for specified duration
  console.log(
    `⏰ Demo will run for ${DURATION / 1000} seconds with massive traffic...\n`,
  );
  await sleep(DURATION);

  // Clean up
  console.log('\n5️⃣ Cleaning up...');

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

  await sleep(1_500);

  // Final detailed statistics
  printDetailedStats(clients);
}

// Enhanced error handling
process.on('uncaughtException', (error) => {
  if (error.message === 'UNHANDLED EXCEPTION') {
    console.log('❌ Server crashed');
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
