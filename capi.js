const EventEmitter = require("events");
const WebSocket = require("ws");
const { htmlto12y, escape12y } = require("./htmlto12y");
const { mxcToHttp, urlOrMxc } = require("./matrix");

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
		this.messages = {};
		
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
	
	evtToMarkup(evt) {
		let text;
		let markup = "plaintext";
		if(evt.body) { // fallback
			text = evt.body;
		}
		if(evt.format === "org.matrix.custom.html") {
			markup = "12y";
			text = htmlto12y(evt.formatted_body, urlOrMxc);
		}
		
		if(evt.msgtype === "m.image") {
			markup = "12y";
			text = "!" + mxcToHttp(evt.url) + (evt.body === "image.png" ? "" : "[" + escape12y(evt.body) + "]");
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
	writeMessage(evt, room_id) {
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
				n: evt.sender,
			}
		}).then(r => r.json()).then(r => {
			this.messages[evt.event_id] = r.id;
		})
	}
	
	editMessage(evt, room_id) {
		const id = this.messages[evt.content["m.relates_to"].event_id];
		if(id === undefined) {
			console.error("edit for unknown message");
			return;
		}
		
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
		})
	}
}
