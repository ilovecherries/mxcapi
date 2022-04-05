const { MxBridge } = require("./mxbridge");
const { CAPI } = require("./capi");
const { store } = require("./store");
const { evtToMarkup } = require("./markup/htmlto12y");
const tohtml = require("./markup/12ytohtml");
const { DiscordBridge } = require("./discordbridge");
const { toMd } = require("./markup/12ytomd");
const { escapeMd } = require("./markup/escapes");
const { discordMessageTo12y } = require("./markup/mdto12y");

// bindings from matrix/discord room id to content id (matrix and discord ids don't interfere)
const bindingStore = store("data/bindings.json");
const bindings = bindingStore.store;

// create the matrix bridge
const mxbridge = new MxBridge(
	"data/capi-registration.yaml",
	"capi-config-schema.yaml",
	{
		capi_url: "http://localhost:5000", // todo: change to main qcs instance once i'm not scared
		matrix_enabled: true,
	},
	{
		localpart: "capi",
		regex: [
			{ type: "users", regex: "@capi_.*", exclusive: true },
			{ type: "aliases", regex: "#api_.*", exclusive: true },
		]
	},
	config => ({
		homeserver: config.matrix?.homeserver,
		homeserver_url: config.matrix?.homeserver_url,
		enabled: !!config.matrix,
	})
);
// persist uploaded avatar urls
const avatarStore = store("data/avatars.json");
mxbridge.avatars = avatarStore.store;
// save on change
mxbridge.on("avatarupload", () => {
	avatarStore.save().catch(err => {
		console.error("Error writing avatar store", err);
	});
});

mxbridge.on("config", config => {
	const matrixEnabled = !!config.matrix;
	const discordEnabled = !!config.discord;
	
	const getMxcOrUrl = async () => {
		const mxcToHttp = await mxbridge.getMxcToHttp();
		return url => url.startsWith("mxc://") ? mxcToHttp(url) : url;
	}
	
	// start contentapi bot
	const capi = new CAPI({
		...config.capi,
		bucket: "bridgeavatar",
	});
	// the same store is reused because the urls won't conflict
	capi.avatars = avatarStore.store;
	capi.on("avatarupload", () => {
		avatarStore.save().catch(err => {
			console.error("Error writing avatar store", err);
		});
	});
	
	/** @type {DiscordBridge} */
	let discord;
	if(discordEnabled) {
		discord = new DiscordBridge({
			...config.discord,
		});
	}
	
	// store associations for messages sent by the bridge so it can mirror edits and deletes
	const capiToMatrix = {};
	const capiToDiscord = {};
	const matrixToCapi = {};
	const matrixToDiscord = {};
	const discordToCapi = {};
	const discordToMatrix = {};
	
	
	
	
	// capi -> matrix/discord
	
	// functions for going backwards in bindings, from contentapi contentId to matrix/discord rooms
	const getBoundMatrixRoom = id => Object.entries(bindings).find(n => n[0].startsWith("!") && n[1] === id)?.[0];
	const getMxRoom = (contentId, fn) => {
		if(!matrixEnabled) {
			return;
		}
		const bound = getBoundMatrixRoom(contentId);
		if(bound) {
			fn(bound);
		}
	}
	const getBoundDiscordRoom = id => Object.entries(bindings).find(n => !n[0].startsWith("!") && n[1] === id)?.[0];
	const getDscRoom = (contentId, fn) => {
		if(!discordEnabled) {
			return;
		}
		const bound = getBoundDiscordRoom(contentId);
		if(bound) {
			fn(bound);
		}
	}
	
	capi.on("message", (message, user) => {
		const username = (message.values?.n && message.values.n !== user.username ? message.values.n + " (" + user.username + ")" : user.username);
		const avatar = user?.avatar && (user.avatar !== "0") ? capi.url + "/api/file/raw/" + user.avatar : undefined;
		
		getMxRoom(message.contentId, async room => {
			capiToMatrix[message.id] = await mxbridge.sendMessage(
				room,
				{
					localpart: "capi_" + message.createUserId,
					username,
					avatar,
				},
				message.text,
				message.values?.m === "12y" ? tohtml(message.text) : undefined,
			);
		})
		
		getDscRoom(message.contentId, async room => {
			capiToDiscord[message.id] = await discord.sendMessage(
				room,
				username,
				avatar,
				message.values?.m === "12y" ? toMd(message.text) : escapeMd(message.text),
			)
		})
	});
	
	capi.on("edit", (message, user) => {
		getMxRoom(message.contentId, async room => {
			if(!(message.id in capiToMatrix)) {
				console.error("capi edit for unknown matrix message");
				return;
			}
			
			await mxbridge.editMessage(
				room,
				{
					localpart: "capi_" + message.createUserId,
				},
				capiToMatrix[message.id],
				message.text,
				message.values?.m === "12y" ? tohtml(message.text) : undefined,
			);
		})
		
		getDscRoom(message.contentId, async room => {
			if(!(message.id in capiToDiscord)) {
				console.error("capi edit for unknown discord message");
				return;
			}
			
			capiToDiscord[message.id] = await discord.editMessage(
				capiToDiscord[message.id],
				message.values?.m === "12y" ? toMd(message.text) : escapeMd(message.text),
			)
		})
	});
	
	capi.on("delete", message => {
		getMxRoom(message.contentId, async room => {
			if(!(message.id in capiToMatrix)) {
				console.error("capi delete for unknown matrix message");
				return;
			}
			
			await mxbridge.redact(
				room,
				{
					localpart: "capi_" + message.createUserId
				},
				capiToMatrix[message.id],
			);
		})
		
		getDscRoom(message.contentId, async room => {
			if(!(message.id in capiToDiscord)) {
				console.error("capi delete for unknown discord message");
				return;
			}
			
			await discord.deleteMessage(
				capiToDiscord[message.id],
			)
		})
	});
	
	
	
	
	// matrix -> capi/discord
	
	const handleBindMessage = (evt, bridge) => {
		// command to bind a new room
		if(typeof(evt.content.body) === "string" && evt.content.body.startsWith("$bind ")) {
			const intent = bridge.getIntent();
			const text = msg => intent.sendText(evt.room_id, msg);
			
			if(!config.matrix.admins.includes(evt.sender)) {
				text("You're not a bridge admin!");
			} else {
				const num = parseInt(evt.content.body.substring("$bind ".length));
				if(isNaN(num)) {
					text("Invalid content ID");
				} else {
					bindings[evt.room_id] = num;
					text("Room bound successfully!");
					bindingStore.save();
				}
			}
		}
	}
	
	mxbridge.on("message", async (content, evt, bridge) => {
		if(!(evt.room_id in bindings)) {
			handleBindMessage(evt, bridge);
			return;
		}
		
		const member = (await bridge.getBot().getJoinedMembers(evt.room_id))?.[evt.sender];
		const { text, markup } = evtToMarkup(content, await getMxcOrUrl());
		const mxcToHttp = await mxbridge.getMxcToHttp();
		
		getDscRoom(bindings[evt.room_id], async channel => {
			matrixToDiscord[evt.event_id] = await discord.sendMessage(
				channel,
				member.display_name || evt.sender,
				member.avatar_url && mxcToHttp(member.avatar_url),
				// yes this is going html->12y->md
				// in this bridge the contentapi format is the canonical one
				// and i didn't feel like writing a separate html->md
				markup === "12y" ? toMd(text) : escapeMd(text),
			)
		})
		
		matrixToCapi[evt.event_id] = await capi.writeMessage(
			bindings[evt.room_id],
			text,
			markup,
			member.display_name || evt.sender,
			member.avatar_url && mxcToHttp(member.avatar_url)
		);
	});
	
	mxbridge.on("edit", async (content, replaces, evt) => {
		if(!(evt.room_id in bindings)) {
			return;
		}
		
		const { text, markup } = evtToMarkup(content, await getMxcOrUrl());
		
		getDscRoom(bindings[evt.room_id], async channel => {
			if(!(replaces in matrixToDiscord)) {
				console.error("matrix edit for unknown discord message");
				return;
			}
			
			matrixToDiscord[evt.event_id] = await discord.editMessage(
				matrixToDiscord[replaces],
				markup === "12y" ? toMd(text) : escapeMd(text),
			)
		})
		
		if(!(replaces in matrixToCapi)) {
			console.error("matrix edit for unknown capi message");
			return;
		}
		
		matrixToCapi[evt.event_id] = await capi.editMessage(matrixToCapi[replaces], bindings[evt.room_id], text, markup);
	});
	
	mxbridge.on("redact", async (redacts, evt) => {
		if(!(evt.room_id in bindings)) {
			return;
		}
		
		getDscRoom(bindings[evt.room_id], async channel => {
			if(!(redacts in matrixToDiscord)) {
				console.error("matrix redaction for unknown capi message");
				return;
			}
			
			await discord.deleteMessage(matrixToDiscord[redacts])
		})
		
		if(!(redacts in matrixToCapi)) {
			console.error("matrix redaction for unknown capi message");
			return;
		}
		
		await capi.deleteMessage(matrixToCapi[redacts]);
	});
	
	
	
	
	// discord -> capi/matrix
	
	if(!discordEnabled) {
		return;
	}
	
	const handleBindMessageDiscord = message => {
		// command to bind a new room
		if(message.content.startsWith("$bind ")) {
			const text = msg => discord.sendMessageAsBot(message.channelId, msg);
			
			if(!config.discord.admins.includes(message.author.id)) {
				text("You're not a bridge admin!");
			} else {
				const num = parseInt(message.content.substring("$bind ".length));
				if(isNaN(num)) {
					text("Invalid content ID");
				} else {
					bindings[message.channelId] = num;
					text("Room bound successfully!");
					bindingStore.save();
				}
			}
		}
	}
	
	discord.on("messageCreate", async message => {
		if(!(message.channelId in bindings)) {
			handleBindMessageDiscord(message);
			return;
		}
		
		const content12y = discordMessageTo12y(message);
		
		getMxRoom(bindings[message.channelId], async room => {
			discordToMatrix[message.id] = await mxbridge.sendMessage(
				room,
				{
					localpart: "capi_dsc_" + message.author.id,
					username: message.member.displayName,
					avatar: message.member.avatarURL(),
				},
				message.content,
				tohtml(content12y),
			);
		})
		
		discordToCapi[message.id] = await capi.writeMessage(
			bindings[message.channelId],
			content12y,
			"12y",
			message.member.displayName,
			message.member.avatarURL(),
		)
	})
	
	discord.on("messageUpdate", async (old, message) => {
		if(!(message.channelId in bindings)) {
			return;
		}
		
		const content12y = discordMessageTo12y(message);
		
		getMxRoom(bindings[message.channelId], async room => {
			if(!(message.id in discordToMatrix)) {
				console.error("discord edit for unknown matrix message");
				return;
			}
			
			await mxbridge.editMessage(
				room,
				{
					localpart: "capi_dsc_" + message.author.id,
				},
				discordToMatrix[message.id],
				message.content,
				tohtml(content12y),
			);
		})
		
		if(!(old.id in discordToCapi)) {
			console.error("discord edit for unknown capi message");
			return;
		}
		
		discordToCapi[message.id] = await capi.editMessage(matrixToCapi[old.id], bindings[message.channelId], content12y, "12y");
	})
	
	discord.on("messageDelete", async message => {
		if(!(message.channelId in bindings)) {
			return;
		}
		
		getMxRoom(bindings[message.channelId], async room => {
			if(!(message.id in discordToMatrix)) {
				console.error("discord delete for unknown matrix message");
				return;
			}
			
			await mxbridge.redact(
				room,
				{
					localpart: "capi_dsc_" + message.author.id,
				},
				discordToMatrix[message.id],
			);
		})
		
		if(!(message.id in discordToCapi)) {
			console.error("discord delete for unknown capi message");
			return;
		}
		
		await capi.deleteMessage(discordToCapi[message.id]);
	})
});

process.on("unhandledRejection", reason => {
	console.log("Unhandled rejection:", reason);
});
