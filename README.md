# GraphQL Subscriptions Demo

This repository demonstrates GraphQL subscriptions with different scenarios including server instability, proxy configurations, and subscription resumption capabilities. The demos showcase how GraphQL subscriptions behave under various conditions and how to maintain reliable real-time communication.

## Features

- **Simple Subscriptions**: Basic GraphQL subscription implementation
- **Interactive Client Demo**: Command-line interface for manual message testing
- **Proxy Subscriptions**: Subscriptions through a proxy with resumption capabilities  
- **Massive Traffic Simulation**: High-load testing with unstable server conditions
- **Enhanced Client Reliability**: Single subscription per client with improved reconnection
- **Subscription Resumption**: Automatic reconnection and message recovery
- **Real-time Statistics**: Detailed delivery and performance metrics
- **Improved Tooling**: Built-in code formatting and linting with npm scripts

## Prerequisites

- Node.js (version 22 or higher)
- npm or pnpm package manager

## Installation

1. Clone the repository:
```bash
git clone https://github.com/platformatic/blog-graphql-subscription.git
cd blog-graphql-subscription
```

2. Install dependencies:
```bash
npm install
# or
pnpm install
```

## Run the Demo

The main demo that simulates massive traffic with an unstable server to test subscription reliability and message delivery under adverse conditions.

**Features:**
- Simulates server instability and crashes with automatic restarts
- Massive message throughput testing with configurable burst patterns
- Detailed per-client and overall delivery statistics
- Proxy server with resumption capabilities
- Message loss detection and duplicate message tracking
- Real-time message delivery rate analysis
- Graceful shutdown handling

**Run the demo:**
```bash
node src/demo.js
```

**Configuration options:**

```bash
# Basic configuration
CLIENTS=10 MESSAGES=2000 node src/demo.js

# Massive traffic simulation
CLIENTS=20 MESSAGES=5000 MESSAGES_PER_BURST=500 node src/demo.js

# High-throughput testing with custom burst settings
CLIENTS=15 MESSAGES=10000 MESSAGES_PER_BURST=200 BURST_PAUSE=100 node src/demo.js

# Longer wait time for message delivery
MAX_WAIT_TIME=180000 CLIENTS=5 MESSAGES=1000 node src/demo.js

# Enable debug output
DEBUG=true CLIENTS=3 MESSAGES=500 node src/demo.js
```

**Available environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIENTS` | 10 | Number of concurrent clients |
| `MESSAGES` | 2000 | Total messages to send during the demo |
| `MAX_WAIT_TIME` | 120000 | Maximum time to wait for message delivery (ms) |
| `MESSAGES_PER_BURST` | 250 | Messages sent per burst interval |
| `BURST_PAUSE` | 500 | Pause between bursts in milliseconds |
| `PROXY_PORT` | 3001 | Port for the proxy server |
| `SUBSCRIPTION_PROBLEM_CHANCE` | 0 | Chance of server problems (0.0-1.0) |
| `DEBUG` | false | Enable detailed debug logging |

## Understanding the Output

The main demo provides detailed statistics including:

- **Per-Client Statistics**: Individual delivery rates and lost messages
- **Overall Statistics**: System-wide performance metrics
- **Message Delivery Analysis**: Detection of duplicate and lost messages
- **Performance Metrics**: Messages per second and delivery rates

**Sample output:**
```
📊 DETAILED MESSAGE DELIVERY STATISTICS
═══════════════════════════════════════

👥 PER-CLIENT STATISTICS:
🔹 Client 1:
   📤 Sent: 45
   📥 Received: 200 ✅
   ❌ Lost Messages: 0 ✅
   📊 Delivery Rate: 100.00% ✅

👥 OVERALL STATISTICS:
🕐 Runtime: 30.1s
📊 Overall Delivery Rate: 100.00% ✅
📊 Duplicated Messages: 0 ✅
⚡ Messages/Second: 6.64
```

## Troubleshooting

### Common Issues

1. **Port already in use**:
   ```bash
   # Use different ports
   PROXY_PORT=3002 node src/demo-proxy.js
   ```

2. **High message loss**:
   - Lower the number of `CLIENTS`. Since the message delivery is broadcasting, adding clients increase exponentially the workload
   - Increase `BURST_PAUSE` for less aggressive traffic
   - Reduce `MESSAGES_PER_BURST` to send smaller batches
   - Increase `MAX_WAIT_TIME` to allow more time for message delivery

### Performance Tips

- Start with low client counts and gradually increase
- Use `DEBUG=true` to understand message flow
- Monitor system resources during high-load tests
- Adjust burst settings based on system capabilities

## Simple Client Demo

In addition to the massive traffic simulation, there's also a simple interactive client demo:

```bash
# Run the simple interactive client demo
node src/demo-client-simple.js
```

**Features:**
- Interactive command-line interface for sending messages
- Real-time message display with timestamps
- Manual message sending via keyboard input
- Optional message tracking and resumption capabilities

**Usage:**
1. Start the server: `node src/server-simple.js` 
2. In another terminal, run: `node src/demo-client-simple.js`
3. Type messages and press Enter to send them
4. Type `quit` or `exit` to disconnect gracefully

**Configuration options:**
```bash
# Enable message tracking for resumption capabilities  
TRACK_LAST_MESSAGE=true node src/demo-client-simple.js

# Connect to custom port
PORT=3000 node src/demo-client-simple.js

# Enable debug output
DEBUG=true node src/demo-client-simple.js

# Combined options
PORT=5000 DEBUG=true TRACK_LAST_MESSAGE=true node src/demo-client-simple.js
```

## Code Formatting and Linting

This project includes npm scripts for code formatting and linting:

```bash
# Format code using Biome
npm run format

# Check and fix linting issues
npm run lint:fix

# Check code (without fixing)
npm run lint
```

## Project Structure

```
src/
├── demo.js              # Main massive traffic demo
├── demo-simple.js       # Simple subscription demo
├── demo-client-simple.js # Interactive client demo (NEW)
├── demo-proxy.js        # Proxy subscription demo
├── client.js            # Enhanced GraphQL client implementation
├── client-with-resume.js # Client with resumption capabilities
├── proxy.js             # Proxy server with auto-start capability
├── server-simple.js     # Basic GraphQL server with auto-start
├── server-unstable.js   # Enhanced unstable server for testing
└── server-with-resume.js # Server with resumption support
```

## Architecture

The demos showcase different architectures:

1. **Direct Connection**: Clients connect directly to GraphQL server
2. **Proxy Architecture**: Clients connect through a proxy that manages subscriptions
3. **Resumption System**: Automatic reconnection and message recovery on failures

## License

This project is licensed under the terms specified in the LICENSE file.
