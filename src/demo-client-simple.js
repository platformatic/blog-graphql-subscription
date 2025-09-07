import { GraphQLClient } from './client.js';

const _DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

async function createClient(clientId, trackLastMessage) {
  const port = process.env.PORT || '4000';
  const url = `ws://localhost:${port}/graphql`;
  const client = new GraphQLClient(url, clientId, trackLastMessage);

  try {
    await client.connect();

    // Subscribe to messages
    const subscriptionId = client.subscribe((message) => {
      const timestamp = new Date(message.at).toLocaleTimeString();
      console.log(
        `📱 Client-${clientId} received: [${timestamp}] ${message.user}: ${message.text}`,
      );
    });

    console.log(`✅ Client-${clientId} connected and subscribed`);
    return { client, subscriptionId, clientId };
  } catch (error) {
    console.error(`❌ Failed to create Client-${clientId}:`, error.message);
    return null;
  }
}

async function sendMessage(client, clientId, text) {
  const user = `User-${clientId}`;
  try {
    const result = await client.sendMessage(user, text);
    console.log(`💬 Client-${clientId} sent: ${user}: ${text}`);
    return result;
  } catch (error) {
    console.error(
      `❌ Client-${clientId} failed to send message:`,
      error.message,
    );
    return null;
  }
}

async function runClient() {
  const port = process.env.PORT || '4000';
  
  console.log('🚀 Starting Simple GraphQL Client Demo');
  console.log('=====================================');
  console.log(`Make sure the server is running on port ${port}`);
  console.log(`Server: node src/server-simple.js (default port 4000)`);
  console.log(`Client connecting to: ws://localhost:${port}/graphql`);
  console.log('=====================================\n');

  const clientId = process.pid;

  const trackLastMessage = process.env.TRACK_LAST_MESSAGE === 'true' || process.env.TRACK_LAST_MESSAGE === '1';

  // Create a single client
  console.log('1️⃣ Creating client...');
  const clientWrapper = await createClient(clientId, trackLastMessage);

  if (!clientWrapper) {
    console.error(
      '❌ Failed to create client. Make sure the server is running.',
    );
    process.exit(1);
  }

  const { client } = clientWrapper;

  console.log('\n2️⃣ Client ready. You can now:');
  console.log('   - Send messages by typing and pressing Enter');
  console.log('   - Type "quit" or "exit" to disconnect');
  console.log('   - Press Ctrl+C to force quit\n');

  // Set up stdin for interactive messaging
  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  process.stdin.on('data', async (data) => {
    const input = data.toString().trim();

    if (input === 'quit' || input === 'exit') {
      console.log('\n3️⃣ Disconnecting client...');
      client.disconnect();
      console.log('✅ Client disconnected. Goodbye!');
      process.exit(0);
    } else if (input) {
      await sendMessage(client, clientId, input);
    }
  });

  console.log('💬 Type a message and press Enter:');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
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

// Run the client
runClient().catch((error) => {
  console.error('❌ Client demo failed:', error.message);
  process.exit(1);
});
