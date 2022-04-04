const EventEmitter = require("events");
const WebSocket = require("ws");

module.exports.CAPI = class CAPI extends EventEmitter {
	constructor({ url, username, password, bucket }) {
		super();
		
		this.url = url;
		this.bucket = bucket;
		
		// log in and get the token
		this.token = import("node-fetch")
			.then(mod => mod.default(this.url + "/api/user/login", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					username,
					password,
				})
			})).then(r => r.text());
		
		this.handleWs();
		
		this.users = {};
		this.avatars = {};
		
		this.self = this.api("/api/user/me").then(r => r.json());
	}
	
	// sets up event handlers for the websocket
	async handleWs(reconnects = 0, lastId) {
		const token = await this.token;
		
		console.log((reconnects ? "Rec" : "C") + "onnecting to websocket", this.url.replace(/^http/i, "ws") + "/api/live/ws")
		const ws = this.ws = new WebSocket(
			this.url.replace(/^http/i, "ws") +
			"/api/live/ws?token=" + encodeURIComponent(token) +
			(lastId !== undefined ? "&lastId=" + lastId : "")
		);
		
		ws.onmessage = evt => {
			try {
				const res = JSON.parse(evt.data.toString());
				
				if(res.type === "lastId") {
					lastId = res.data;
				}
				if(res.type === "live") {
					this.handleLive(res.data);
				}
			} catch(err) {
				console.log("Error from websocket", err);
			}
		}
		
		ws.onopen = () => {
			this.emit("login");
			reconnects = 0;
		}
		
		ws.onclose = () => {
			const delay = Math.min(30000, reconnects * 500);
			console.log("Websocket closed! Attempting to reconnect in", delay, "ms");
			setTimeout(() => {
				this.handleWs(reconnects + 1, lastId);
			}, delay);
		}
	}
	
	// handles live events from the websocket
	handleLive(data) {
		// console.log("live data", JSON.stringify(data, null, "  "));
		
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
					this.emit("message", m, user);
				}
			}
			if(ev.action === "update" && ev.type === "message") {
				const m = (data?.data?.message?.message || []).find(n => n.id === ev.refId);
				if(m) {
					const user = this.users[m.createUserId];
					this.emit("update", m, user);
				}
			}
			if(ev.action === "delete" && ev.type === "message") {
				const m = (data?.data?.message?.message || []).find(n => n.id === ev.refId);
				if(m) {
					const user = this.users[m.createUserId];
					this.emit("delete", m, user);
				}
			}
		})
	}
	
	/**
	 * make an api call to the http api
	 * @param {string} url
	 * @param {"GET"|"POST"} method
	 * @param {object?} data Object to send as JSON in the body, if sending data
	 */
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
	
	/**
	 * Uploads an HTTP URL, or returns the cached hash if it was already uploaded
	 * @param {string} url HTTP URL
	 * @returns {Promise<string>} The hash of the uploaded image
	 */
	async ensureUploaded(url, private = true) {
		if(!/^https?:\/\//i.test(url)) {
			// how about we just assume this is a hash already
			return url;
		}
		if(url in this.avatars) {
			return this.avatars[url];
		}
		
		console.log("fetching file", url);
		const { default: fetch, FormData } = await import("node-fetch");
		const res = await fetch(url);
		const blob = await res.blob();
		
		console.log("uploading to contentapi");
		const fd = new FormData();
		if(this.bucket) {
			fd.append("values[bucket]", this.bucket);
		}
		if(private) {
			fd.append("globalPerms", ".");
		}
		fd.append("file", blob);
		const upload = await fetch(this.url + "/api/file", {
			method: "POST",
			headers: {
				Authorization: "Bearer " + await this.token,
			},
			body: fd,
		})
		const result = await upload.json();
		console.log("got hash", result.hash);
		this.avatars[url] = result.hash;
		this.emit("avatarupload", result.hash, url, this.avatars);
		return result.hash;
	}
	
	/**
	 * Posts a message
	 * @param {number} contentId
	 * @param {string} text
	 * @param {string} markup
	 * @param {string?} displayname
	 * @param {string?} avatar
	 * @returns {Promise<object>} The message that was sent
	 */
	async writeMessage(contentId, text, markup, displayname, avatar) {
		return await this.api("/api/write/message", "POST", {
			contentId,
			text,
			values: {
				m: markup,
				a: avatar ? (await this.ensureUploaded(avatar)) : "0",
				n: displayname,
			}
		}).then(r => r.json());
	}
	
	/**
	 * Edits an existing message
	 * @param {object} oldmsg The returned value from writeMessage
	 * @param {number} contentId
	 * @param {string} text
	 * @param {string} markup
	 * @returns {Promise<object>}
	 */
	editMessage(oldmsg, contentId, text, markup) {
		return this.api("/api/write/message", "POST", {
			contentId,
			id: oldmsg.id,
			text,
			values: {
				m: markup,
				a: oldmsg.values.a,
				n: oldmsg.values.n,
			}
		}).then(r => r.json())
	}
	
	/**
	 * Deletes a message
	 * @param {object} oldmsg The returned value from writeMessage
	 */
	deleteMessage(oldmsg) {
		return this.api("/api/delete/message/" + oldmsg.id, "POST");
	}
}
