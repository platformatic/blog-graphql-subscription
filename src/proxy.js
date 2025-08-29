'use strict'

import { setTimeout as wait } from 'node:timers/promises'
import fastify from 'fastify'
import fastifyHttpProxy from '@fastify/http-proxy'
import { StatefulSubscriptions } from '@platformatic/graphql-subscriptions-resume'

let app = null

const state = new StatefulSubscriptions({
	subscriptions: [{ name: 'onMessage', key: 'id' }],
})

let backup = []
let lastPong = Date.now()

// resend messages from last ping
// it may send messages more than once
// in case the target already received messages between last ping and the reconnection
async function resendMessages(target) {
	const now = Date.now()

	for (const m of backup) {
		if (m.timestamp < lastPong || m.timestamp > now) {
			continue
		}
		console.log(' >>> resending message #', m)
		target.send(m.message)
		// introduce a small delay to avoid to flood the target
		await wait(250)
	}
}

const wsHooks = {
	onConnect: (context, source, _target) => {
		context.log.info({ clientId: source.clientId }, 'onConnect')
	},
	onDisconnect: (context, source, _target) => {
		context.log.info(
			{ clientId: source.clientId },
			'onDisconnect (client disconnected)',
		)
		state.removeAllSubscriptions(source.clientId)
		// Clear backup on disconnect
		backup.length = 0
	},
	onReconnect: (context, source, target) => {
		context.log.info({ clientId: source.clientId }, 'onReconnect')
		state.restoreSubscriptions(source.clientId, target)
		// Resend messages from backup
		resendMessages(target)
	},
	onIncomingMessage: (context, source, _target, message) => {
		const m = JSON.parse(message.data.toString('utf-8'))
		source.clientId = m.id

		// Backup incoming messages for potential resend
		backup.push({ message: message.data.toString(), timestamp: Date.now() })

		if (m.type !== 'start') {
			return
		}

		try {
			state.addSubscription(
				source.clientId,
				m.payload.query,
				m.payload.variables,
			)
		} catch (err) {
			context.log.error(
				{ err, m, clientId: source.clientId },
				'Error adding subscription',
			)
		}
	},
	onOutgoingMessage: (_context, source, _target, message) => {
		const m = JSON.parse(message.data.toString('utf-8'))

		if (m.type !== 'data') {
			return
		}

		state.updateSubscriptionState(source.clientId, m.payload.data)
	},
	onPong: () => {
		console.log('onPong')
		lastPong = Date.now()
		// clean backup from the last ping
		backup = backup.filter((message) => message.timestamp > lastPong)
	},
}

export async function start() {
	const port = process.env.PORT || 3001
	
	const wsReconnect = {
		logs: true,
		pingInterval: 3000,
		reconnectOnClose: true,
	}

	app = fastify()
	
	app.register(fastifyHttpProxy, {
		upstream: 'http://localhost:4000/graphql',
		prefix: '/graphql',
		websocket: true,
		wsUpstream: 'ws://localhost:4000/graphql',
		wsReconnect,
		wsHooks,
	})

	try {
		await app.listen({ port, host: '0.0.0.0' })
		console.log('🚀 Proxy server ready at http://localhost:3001/graphql')
		console.log('🔗 Proxy subscription endpoint: ws://localhost:3001/graphql')
	} catch (err) {
		app.log.error(err)
		process.exit(1)
	}
}

export async function stop() {
	if (app) {
		await app.close()
		app = null
	}
}
