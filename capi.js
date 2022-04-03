const EventEmitter = require("events");
const WebSocket = require("ws");
const { htmlto12y } = require("./htmlto12y");

module.exports = class CAPI extends EventEmitter {
	constructor(config) {
		super();
		
		this.url = config.capi_url;
		this.token = config.token;
		console.log("Connecting to websocket", this.url.replace(/^http/i, "ws") + "/api/live/ws")
		this.ws = new WebSocket(this.url.replace(/^http/i, "ws") + "/api/live/ws?token=" + encodeURIComponent(this.token));
		this.handlers = {};
		this.handleWs();
		
		this.users = {};
		
		this.api("/api/user/me").then(r => r.json()).then(u => {
			this.self = u;
		});
	}
	
	// sends data to the websocket
	send(type, data) {
		const id = String(Math.random()).substring(2);
		
		const prom = new Promise(res => {
			this.handlers[id] = res;
		})
		
		this.ws.send(JSON.stringify({
			type,
			data,
			id
		}))
		
		return prom;
	}
	
	// sets up event handlers for the websocket
	handleWs() {
		this.ws.onmessage = evt => {
			try {
				const res = JSON.parse(evt.data.toString());
				
				if(res.type === "live") {
					this.handleLive(res.data);
				} else if(res.id in this.handlers) {
					this.handlers[res.id](res);
					delete this.handlers[res.id];
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
		(data?.events || []).forEach(ev => {
			// ignore events from self
			if(ev.userId === this.self?.id) {
				return;
			}
			
			if(ev.action === "create" && ev.type === "message") {
				const m = (data?.data?.message?.message || []).find(n => n.id === ev.refId);
				if(m) {
					const user = this.users[m.createUserId];
					this.emit("message", m, user, this);
				}
			}
		})
	}
	
	// make an api call to the http api
	api(url, method, data) {
		return import("node-fetch").then(mod => mod.default(this.url + url, {
			method,
			headers: {
				Authorization: "Bearer " + this.token,
				"Content-Type": data ? "application/json" : undefined,
			},
			body: data ? JSON.stringify(data) : undefined,
		}))
	}
	
	// send a matrix event to a contentapi chat
	writeMessage(evt, room_id) {
		let text;
		let markup = "plaintext";
		if(evt.content?.body) {
			text = evt.content.body;
		}
		if(evt.content?.formatted_body) {
			markup = "12y";
			text = htmlto12y(evt.content.formatted_body);
		}
		
		return this.api("/api/write/message", "POST", {
			contentId: room_id,
			text,
			values: {
				m: markup,
				a: "0", // todo: grab display name and avatar of matrix users
				n: evt.sender,
			}
		})
	}
}
