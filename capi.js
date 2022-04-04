const EventEmitter = require("events");
const WebSocket = require("ws");
const { htmlto12y, escape12y } = require("./htmlto12y");

module.exports.CAPI = class CAPI extends EventEmitter {
	constructor(config, mxcToHttp) {
		super();
		
		this.url = config.capi_url;
		
		// log in and get the token
		this.token = import("node-fetch")
			.then(mod => mod.default(this.url + "/api/user/login", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					username: config.capi_user,
					password: config.capi_pass,
				})
			})).then(r => r.text());
		
		// create the websocket once the token exists
		this.ws = this.token.then(tok => {
			console.log("Logged in to contentapi, connecting to websocket", this.url.replace(/^http/i, "ws") + "/api/live/ws")
			return new WebSocket(this.url.replace(/^http/i, "ws") + "/api/live/ws?token=" + encodeURIComponent(tok))
		});
		this.handleWs();
		
		this.users = {};
		
		this.mxcToHttp = mxcToHttp;
		this.urlOrMxc = url => url.startsWith("mxc://") ? mxcToHttp(url) : url;
		
		this.self = this.api("/api/user/me").then(r => r.json());
	}
	
	// sets up event handlers for the websocket
	async handleWs() {
		const ws = await this.ws;
		
		ws.onmessage = evt => {
			try {
				const res = JSON.parse(evt.data.toString());
				
				if(res.type === "live") {
					this.handleLive(res.data);
				}
			} catch(err) {
				console.log("Error from websocket", err);
			}
		}
	}
	
	// handles live events from the websocket
	handleLive(data) {
		console.log("live data", JSON.stringify(data, null, "  "));
		
		this.emit("live", data)
		
		// handle users
		if(Array.isArray(data?.data?.message?.user)) {
			data.data.message.user.forEach(u => {
				this.users[u.id] = u;
			})
		}
		
		// handle messages
		(data?.events || []).forEach(async ev => {
			// ignore events from self
			if(ev.userId === (await this.self)?.id) {
				return;
			}
			
			if(ev.action === "create" && ev.type === "message") {
				const m = (data?.data?.message?.message || []).find(n => n.id === ev.refId);
				if(m) {
					const user = this.users[m.createUserId];
					this.emit("message", m, user, this);
				}
			}
			if(ev.action === "update" && ev.type === "message") {
				const m = (data?.data?.message?.message || []).find(n => n.id === ev.refId);
				if(m) {
					const user = this.users[m.createUserId];
					this.emit("update", m, user, this);
				}
			}
			if(ev.action === "delete" && ev.type === "message") {
				const m = (data?.data?.message?.message || []).find(n => n.id === ev.refId);
				if(m) {
					const user = this.users[m.createUserId];
					this.emit("delete", m, user, this);
				}
			}
		})
	}
	
	// make an api call to the http api
	async api(url, method, data) {
		return await (await import("node-fetch")).default(this.url + url, {
			method,
			headers: {
				Authorization: "Bearer " + await this.token,
				"Content-Type": data ? "application/json" : undefined,
			},
			body: data ? JSON.stringify(data) : undefined,
		})
	}
	
	evtToMarkup(evt) {
		let text;
		let markup = "plaintext";
		if(evt.body) { // fallback
			text = evt.body;
		}
		if(evt.format === "org.matrix.custom.html") {
			markup = "12y";
			text = htmlto12y(evt.formatted_body, this.urlOrMxc);
		}
		
		if(evt.msgtype === "m.image") {
			markup = "12y";
			text = "!" + this.mxcToHttp(evt.url) + (evt.body === "image.png" ? "" : "[" + escape12y(evt.body) + "]");
		}
		if(evt.msgtype === "m.emote") {
			if(markup !== "12y") {
				markup = "12y";
				text = "{/" + escape12y(text) + "}";
			} else {
				text = "{/" + text + "}";
			}
		}
		
		return {
			text, markup
		}
	}
	
	// send a matrix event to a contentapi chat
	writeMessage(evt, room_id, member) {
		const { text, markup } = this.evtToMarkup(evt.content);
		if(!text) {
			return;
		}
		
		return this.api("/api/write/message", "POST", {
			contentId: room_id,
			text,
			values: {
				m: markup,
				a: "0", // todo: grab display name and avatar of matrix users
				n: member?.display_name || evt.sender,
			}
		}).then(r => r.json()).then(r => r.id)
	}
	
	editMessage(id, evt, room_id) {
		const { text, markup } = this.evtToMarkup(evt.content["m.new_content"]);
		if(!text) {
			return;
		}
		
		return this.api("/api/write/message", "POST", {
			contentId: room_id,
			id,
			text,
			values: {
				m: markup,
				a: "0",
				n: evt.sender,
			}
		}).then(r => r.json()).then(r => r.id)
	}
	
	deleteMessage(id) {
		return this.api("/api/delete/message/" + id, "POST");
	}
}
