const { Cli, Bridge, WeakEvent, Intent, BridgeContext } = require("matrix-appservice-bridge");
const EventEmitter = require("events");

/**
 * @typedef {{
 * 	localpart?: string,
 * 	regex?: {type: "users"|"rooms"|"aliases", regex: string, exclusive?: boolean}[],
 * }} Registration
 */

/**
 * @typedef {{
 * 	localpart: string,
 * 	username?: string,
 * 	avatar?: string,
 * }} User
 */

module.exports.MxBridge = class MxBridge extends EventEmitter {
	/**
	 * @param {string} registrationPath
	 * @param {string} schema
	 * @param {Record<string, unknown>} defaults
	 * @param {Registration} registration
	 */
	constructor(registrationPath, schema, defaults, registration) {
		super();
		
		let bridgeResolve;
		/** @type {Promise<Bridge>} */
		this.bridge = new Promise(r => bridgeResolve = r);
		
		this.avatars = {};
		
		new Cli({
			registrationPath,
			bridgeConfig: {
				schema,
				defaults,
			},
			generateRegistration(reg, cb) {
				reg.setId(AppServiceRegistration.generateToken());
				reg.setHomeserverToken(AppServiceRegistration.generateToken());
				reg.setAppServiceToken(AppServiceRegistration.generateToken());
				if(registration.localpart) {
					reg.setSenderLocalpart(registration.localpart);
				}
				if(Array.isArray(registration.regex)) {
					registration.regex.forEach(r => {
						reg.addRegexPattern(r.type, r.regex, r.exclusive);
					});
				}
				cb(reg);
			},
			run: async (port, config) => {
				const bridge = new Bridge({
					homeserverUrl: config.homeserver_url,
					domain: config.homeserver,
					registration: registrationPath,
					controller: {
						onUserQuery(u) {
							return {};
						},
						onEvent: async (req, ctx) => {
							const evt = req.getData();
							console.log("got event", evt);
							
							/**
							 * @event MxBridge#evt
							 * @param {WeakEvent} event
							 * @param {Bridge} bridge
							 */
							this.emit("evt", evt, bridge);
						},
					}
				});
				console.log("Matrix appservice listening on port", port);
				await bridge.run(port);
				bridgeResolve(bridge);
				
				/**
				 * @event MxBridge#login
				 * @param {Bridge} bridge
				 * @param {Record<string, unknown>} config
				 */
				this.emit("login", bridge, config);
			}
		}).run();
		
		this.on("evt", async (evt, ctx, bridge) => {
			// the bridge user should autojoin on invites
			if(
				evt.type === "m.room.member" &&
				evt.state_key === bridge.getBot().getUserId() &&
				evt.content?.membership === "invite"
			) {
				console.log("got invite! joining")
				await bridge.getIntent().join(evt.room_id);
				/**
				 * @event MxBridge#room
				 * @param {string} room_id
				 * @param {Bridge} bridge
				 */
				this.emit("room", evt.room_id, bridge);
			}
			
			if(
				evt.type === "m.room.message" &&
				evt.content
			) {
				if(evt.content["m.relates_to"]?.["rel_type"] === "m.replace" && evt.content["m.new_content"]) {
					/**
					 * @event MxBridge#edit
					 * @param {object} content
					 * @param {string} replaces
					 * @param {WeakEvent} event
					 * @param {Bridge} bridge
					 */
					this.emit("edit", evt.content["m.new_content"], evt.content["m.relates_to"].event_id, evt, bridge);
				} else {
					/**
					 * @event MxBridge#message
					 * @param {object} content
					 * @param {WeakEvent} event
					 * @param {Bridge} bridge
					 */
					this.emit("message", evt.content, evt, bridge);
				}
			}
			
			if(
				evt.type === "m.room.redaction" &&
				evt.redacts
			) {
				/**
				 * @event MxBridge#redact
				 * @param {string} redacts
				 * @param {WeakEvent} event
				 * @param {Bridge} bridge
				 */
				this.emit("redact", evt.redacts, evt, bridge);
			}
			
			if(
				evt.type === "m.reaction" &&
				evt.content?.["m.relates_to"]?.rel_type === "m.annotation"
			) {
				/**
				 * @event MxBridge#react
				 * @param {string} reacts_to
				 * @param {string} reaction
				 * @param {WeakEvent} event
				 * @param {Bridge} bridge
				 */
				this.emit("react", evt.content["m.relates_to"].event_id, evt.content["m.relates_to"].key, evt, bridge);
			}
		})
	}
	
	/**
	 * Uploads a user's avatar to the content repository if it isn't already
	 * @param {string} url
	 * @param {Intent} intent
	 */
	async ensureUploaded(url, intent) {
		if(url in this.avatars) {
			return this.avatars[url];
		}
		
		console.log("fetching file", url);
		const { default: fetch } = await import("node-fetch");
		const res = await fetch(url);
		const blob = await res.blob();
		const buffer = Buffer.from(await blob.arrayBuffer());
		
		console.log("uploading to matrix: content type", blob.type);
		const mxc = await intent.uploadContent(buffer, blob.type);
		
		console.log("got mxc url", mxc);
		this.avatars[url] = mxc;
		
		/**
		 * @event MxBridge#avatarupload
		 * @param {string} mxc Matrix content repository URL
		 * @param {string} url Original HTTP URL
		 * @param {{[key: string]: string}} avatars The current avatar cache
		 */
		this.emit("avatarupload", mxc, url, this.avatars);
		return mxc;
	}
	
	/**
	 * @param {string} room
	 * @param {User} user
	 * @param {string} body
	 * @param {string?} formatted_body
	 */
	async sendMessage(room, user, body, formatted_body) {
		const bridge = await this.bridge;
		const intent = bridge.getIntentFromLocalpart(user.localpart);
		
		let avatar;
		if(user.avatar) {
			avatar = await this.ensureUploaded(user.avatar, intent);
		}
		await intent.ensureProfile(user.username, avatar);
		
		const { event_id } = await intent.sendMessage(room, {
			msgtype: "m.text",
			body,
			...(formatted_body !== undefined ? {
				format: "org.matrix.custom.html",
				formatted_body
			} : {})
		})
		
		return event_id;
	}
	
	/**
	 * @param {string} room
	 * @param {User} user
	 * @param {string} eventId
	 * @param {string} body
	 * @param {string?} formatted_body
	 */
	async editMessage(room, user, eventId, body, formatted_body) {
		const bridge = await this.bridge;
		const intent = bridge.getIntentFromLocalpart(user.localpart);
		const { event_id } = intent.sendMessage(room, {
			body: "* " + body,
			msgtype: "m.text",
			"m.new_content": {
				msgtype: "m.text",
				body,
				...(formatted_body !== undefined ? {
					format: "org.matrix.custom.html",
					formatted_body
				} : {})
			},
			"m.relates_to": {
				event_id: eventId,
				rel_type: "m.replace",
			}
		})
		
		return event_id;
	}
	
	/**
	 * @param {string} room
	 * @param {User} user
	 * @param {string} event_id
	 */
	async redact(room, user, event_id) {
		const bridge = await this.bridge;
		const intent = bridge.getIntentFromLocalpart(user.localpart);
		return await intent.matrixClient.redactEvent(room, event_id);
	}
	
	async getMxcToHttp() {
		const bridge = await this.bridge;
		return url => bridge.getBot().getClient().mxcToHttp(url);
	}
}
