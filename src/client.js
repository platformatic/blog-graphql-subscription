import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// Connection and retry constants
const CONNECTION_TIMEOUT = 5000; // 5 seconds
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds

export class GraphQLClient {
  constructor(url = 'ws://localhost:4000/graphql', clientId = null) {
    this.url = url;
    this.clientId = clientId;
    this.ws = null;
    this.connected = false;
    this.subscriptions = new Map();
    this.subscriptionId = 0;
    this.messageHandlers = [];
    this.lastMessageId = null;
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY;
    this.shouldReconnect = true;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, 'graphql-ws');

      this.ws.on('open', () => {
        console.log(
          `🟢 Client connected to GraphQL subscription server at ${this.url}`,
        );

        // Initialize connection
        const payload = {
          type: 'connection_init',
          payload: {},
        };
        this.ws.send(JSON.stringify(payload));

        // Start heartbeat mechanism
        this.startHeartbeat();

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'connection_ack') {
          if (DEBUG) {
            console.log('✅ Connection acknowledged');
          }
          this.connected = true;
          resolve();
        } else if (msg.type === 'data' && msg.payload?.data?.onMessage) {
          const message = msg.payload.data.onMessage;

          // Track the last received message ID for resume functionality
          if (message.id) {
            this.lastMessageId = message.id;
          }

          // Call all registered message handlers
          this.messageHandlers.forEach((handler) => {
            handler(message);
          });
        } else if (msg.type === 'error') {
          console.error('❌ GraphQL error:', msg.payload);
          reject(new Error(msg.payload));
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        this.stopHeartbeat();
        if (!this.connected) {
          reject(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        if (DEBUG) {
          console.log(
            `🔴 Disconnected from server (code: ${code}, reason: ${reason})`,
          );
        }
        this.connected = false;
        this.stopHeartbeat();

        // Attempt reconnection if enabled
        if (
          this.shouldReconnect &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.attemptReconnect();
        }
      });

      // Set timeout for connection
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, CONNECTION_TIMEOUT).unref();
    });
  }

  subscribe(onMessage, id = null) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }

    const subscriptionId = `subscription:${this.clientId}-${++this.subscriptionId}`;

    // Add message handler
    this.messageHandlers.push(onMessage);

    // Build subscription query with optional id parameter
    const query = id
      ? `subscription OnMessageWithId($id: String) {
            onMessage(id: $id) {
              id
              text
              user
              at
            }
          }`
      : `subscription {
            onMessage {
              id
              text
              user
              at
            }
          }`;

    const payload = {
      query,
      ...(id && { variables: { id } }),
    };

    // Send subscription
    this.ws.send(
      JSON.stringify({
        id: subscriptionId,
        type: 'start',
        payload,
      }),
    );

    this.subscriptions.set(subscriptionId, onMessage);
    const resumeMessage = id ? ` (resuming from message ${id})` : '';
    console.log(`🔔 Subscribed to messages${resumeMessage}`);

    return subscriptionId;
  }

  async sendMessage(user, text) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }

    const mutation = `
      mutation SendMessage($text: String!, $user: String!) {
        sendMessage(text: $text, user: $user) {
          id
          text
          user
          at
        }
      }
    `;

    // Convert WebSocket URL to HTTP URL for mutations
    const httpUrl = this.url
      .replace('ws://', 'http://')
      .replace('wss://', 'https://');

    try {
      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: mutation,
          variables: { text, user },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        throw new Error(result.errors[0].message);
      }

      return result.data.sendMessage;
    } catch (error) {
      console.error('❌ Error sending message:', error.message);
      throw error;
    }
  }

  startHeartbeat() {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    // Use WebSocket-level ping instead of GraphQL-WS protocol ping
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (DEBUG) {
          console.log('💗 Sending WebSocket ping to server');
        }
        // Use WebSocket ping instead of GraphQL message
        this.ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async attemptReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * 2 ** (this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY,
    );

    if (DEBUG) {
      console.log(
        `🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`,
      );
    }

    await sleep(delay);

    if (!this.shouldReconnect) {
      return;
    }

    try {
      await this.connect();

      // Re-subscribe to existing subscriptions with resume logic
      if (this.messageHandlers.length > 0) {
        if (DEBUG) {
          console.log('🔄 Resuming subscription...');
        }
        this.subscribeWithResume();
      }
    } catch (error) {
      console.error(
        `❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
        error.message,
      );

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.attemptReconnect();
      } else {
        console.error(
          '❌ Max reconnection attempts reached. Please reconnect manually.',
        );
      }
    }
  }

  subscribeWithResume() {
    if (this.messageHandlers.length > 0 && this.connected) {
      // Clear existing subscriptions first
      this.subscriptions.clear();

      // Use the last received message ID for resume
      const resumeId = this.lastMessageId;

      // Re-subscribe with all handlers (though typically there's one)
      this.messageHandlers.forEach((handler) => {
        this.subscribe(handler, resumeId);
      });
    }
  }

  unsubscribe(subscriptionId) {
    if (this.subscriptions.has(subscriptionId)) {
      this.ws.send(
        JSON.stringify({
          id: subscriptionId,
          type: 'stop',
        }),
      );
      this.subscriptions.delete(subscriptionId);
      if (DEBUG) {
        console.log(`🔕 Unsubscribed: ${subscriptionId}`);
      }
    }
  }

  disconnect() {
    this.shouldReconnect = false; // Disable auto-reconnection
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.connected = false;
      this.subscriptions.clear();
      this.messageHandlers = [];
      if (DEBUG) {
        console.log('👋 Disconnected from GraphQL server');
      }
      this.ws = null;
    }
  }
}

// Export default instance for backward compatibility
export default GraphQLClient;
