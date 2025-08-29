import WebSocket from 'ws';

export class GraphQLClient {
	constructor(url = 'ws://localhost:4000/graphql') {
		this.url = url;
		this.ws = null;
		this.connected = false;
		this.subscriptions = new Map();
		this.subscriptionId = 0;
		this.messageHandlers = [];
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
			});

			this.ws.on('message', (data) => {
				const msg = JSON.parse(data.toString());

				if (msg.type === 'connection_ack') {
					console.log('✅ Connection acknowledged');
					this.connected = true;
					resolve();
				} else if (msg.type === 'data' && msg.payload?.data?.onMessage) {
					const message = msg.payload.data.onMessage;
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
				reject(error);
			});

			this.ws.on('close', () => {
				console.log('🔴 Disconnected from server');
				this.connected = false;
			});

			// Set timeout for connection
			setTimeout(() => {
				if (!this.connected) {
					reject(new Error('Connection timeout'));
				}
			}, 5000);
		});
	}

	subscribe(onMessage, id = null) {
		if (!this.connected) {
			throw new Error('Not connected to server');
		}

		const subscriptionId = `sub_${++this.subscriptionId}`;

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
			...(id && { variables: { id } })
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
		const httpUrl = this.url.replace('ws://', 'http://').replace('wss://', 'https://');

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

	unsubscribe(subscriptionId) {
		if (this.subscriptions.has(subscriptionId)) {
			this.ws.send(
				JSON.stringify({
					id: subscriptionId,
					type: 'stop',
				}),
			);
			this.subscriptions.delete(subscriptionId);
			console.log(`🔕 Unsubscribed: ${subscriptionId}`);
		}
	}

	disconnect() {
		if (this.ws) {
			this.ws.close();
			this.connected = false;
			this.subscriptions.clear();
			this.messageHandlers = [];
			console.log('👋 Disconnected from GraphQL server');
		}
	}
}

// Export default instance for backward compatibility
export default GraphQLClient;
