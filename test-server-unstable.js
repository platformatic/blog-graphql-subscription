import { GraphQLClient } from './src/client.js';
import {
  start as startServer,
  stop as stopServer,
} from './src/server-unstable.js';

async function runTest() {
  console.log(
    '🚀 Starting test: GraphQL server with WebSocket client subscription',
  );
  console.log('⏱️  Test duration: 30 seconds\n');

  const server = null;
  let client = null;
  let messageCount = 0;

  try {
    // Step 1: Start the GraphQL server
    console.log('1. Starting GraphQL server...');
    await startServer();

    // Wait a moment for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 2: Create and connect WebSocket client
    console.log('2. Creating WebSocket client...');
    client = new GraphQLClient('ws://localhost:4000/graphql', 'test-client');

    console.log('3. Connecting to server...');
    await client.connect();

    // Step 3: Subscribe to messages
    console.log('4. Subscribing to messages...');
    const _subscriptionId = client.subscribe((message) => {
      messageCount++;
      console.log(`📨 Received message #${messageCount}:`, {
        id: message.id,
        text: message.text,
        user: message.user,
        at: message.at,
      });
    });

    // Step 4: Send a test message to trigger subscription
    console.log('5. Sending test message...');
    await client.sendMessage('test-user', 'Hello from test client!');

    // Step 5: Stay connected for 30 seconds
    console.log('6. Maintaining connection for 30 seconds...\n');

    let timeRemaining = 30;
    const countdown = setInterval(() => {
      console.log(
        `⏳ Time remaining: ${timeRemaining} seconds (Messages received: ${messageCount})`,
      );
      timeRemaining--;

      if (timeRemaining <= 0) {
        clearInterval(countdown);
      }
    }, 1000);

    // Wait for 30 seconds
    await new Promise((resolve) => setTimeout(resolve, 30000));
    clearInterval(countdown);

    console.log('\n✅ Test completed successfully!');
    console.log(`📊 Total messages received: ${messageCount}`);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');

    if (client) {
      console.log('- Disconnecting client...');
      client.disconnect();
    }

    if (server !== null) {
      console.log('- Stopping server...');
      await stopServer();
    }

    console.log('✨ Cleanup completed');
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received interrupt signal, shutting down gracefully...');
  await stopServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received terminate signal, shutting down gracefully...');
  await stopServer();
  process.exit(0);
});

// Run the test
runTest().catch(console.error);
