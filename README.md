# GraphQL Subscriptions Demo

This repository demonstrates GraphQL subscriptions with different scenarios including server instability, proxy configurations, and subscription resumption capabilities. The demos showcase how GraphQL subscriptions behave under various conditions and how to maintain reliable real-time communication.

## Features

- **Simple Subscriptions**: Basic GraphQL subscription implementation
- **Proxy Subscriptions**: Subscriptions through a proxy with resumption capabilities  
- **Massive Traffic Simulation**: High-load testing with unstable server conditions
- **Subscription Resumption**: Automatic reconnection and message recovery
- **Real-time Statistics**: Detailed delivery and performance metrics

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
- Simulates server instability and crashes, tricking the connection
- Massive message throughput testing
- Detailed delivery statistics and analysis
- Proxy server with resumption capabilities
- Message loss detection and reporting

**Run the demo:**
```bash
node src/demo.js
```

**Configuration options:**

```bash
# Basic configuration
CLIENTS=10 DURATION=30000 node src/demo.js

# Massive traffic simulation
CLIENTS=20 MESSAGES=5000 DURATION=60000 node src/demo.js

# With server problems (chance of issues: 0.0-1.0)
SUBSCRIPTION_PROBLEM_CHANCE=0.1 CLIENTS=5 DURATION=20000 node src/demo.js

# High-throughput testing
CLIENTS=15 MESSAGES=10000 MESSAGES_PER_BURST=200 BURST_PAUSE=50 DURATION=45000 node src/demo.js

# Enable debug output
DEBUG=true CLIENTS=3 DURATION=10000 node src/demo.js
```

**Available environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIENTS` | 5 | Number of concurrent clients |
| `MESSAGES` | 1000 | Total messages to send during the demo |
| `DURATION` | 30000 | Demo duration in milliseconds |
| `MESSAGES_PER_BURST` | 100 | Messages sent per burst interval |
| `BURST_PAUSE` | 100 | Pause between bursts in milliseconds |
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
   - Reduce `SUBSCRIPTION_PROBLEM_CHANCE`
   - Increase `BURST_PAUSE` for less aggressive traffic

### Performance Tips

- Start with low client counts and gradually increase
- Use `DEBUG=true` to understand message flow
- Monitor system resources during high-load tests
- Adjust burst settings based on system capabilities

## Project Structure

```
src/
├── demo.js              # Main massive traffic demo
├── demo-simple.js       # Simple subscription demo
├── demo-proxy.js        # Proxy subscription demo
├── client.js            # GraphQL client implementation
├── client-with-resume.js # Client with resumption capabilities
├── proxy.js             # Proxy server implementation
├── server-simple.js     # Basic GraphQL server
├── server-unstable.js   # Unstable server for testing
└── server-with-resume.js # Server with resumption support
```

## Architecture

The demos showcase different architectures:

1. **Direct Connection**: Clients connect directly to GraphQL server
2. **Proxy Architecture**: Clients connect through a proxy that manages subscriptions
3. **Resumption System**: Automatic reconnection and message recovery on failures

## License

This project is licensed under the terms specified in the LICENSE file.
