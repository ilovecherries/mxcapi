const { MxBridge } = require("./mxbridge");
const { CAPI } = require("./capi");
const { store } = require("./store");
const { evtToMarkup } = require("./markup/htmlto12y");
const tohtml = require("./markup/12ytohtml");

// bindings from matrix room id to content id
const bindingStore = store("data/bindings.json");
const bindings = bindingStore.store;

// functions for going backwards in bindings, from contentapi contentId to matrix room
const getBoundMatrixRoom = id => Object.entries(bindings).find(n => n[1] === id)?.[0];
const getMxRoom = (message, fn) => {
	const bound = getBoundMatrixRoom(message.contentId);
	if(bound) {
		fn(bound);
	}
}

// create the matrix bridge
const mxbridge = new MxBridge(
	"data/capi-registration.yaml",
	"capi-config-schema.yaml",
	{
		capi_url: "http://localhost:5000", // todo: change to main qcs instance once i'm not scared
	},
	{
		localpart: "capi",
		regex: [
			{ type: "users", regex: "@capi_.*", exclusive: true },
			{ type: "aliases", regex: "#api_.*", exclusive: true },
		]
	}
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

mxbridge.on("login", async (bridge, config) => {
	const mxcToHttp = await mxbridge.getMxcToHttp();
	const mxcOrUrl = url => url.startsWith("mxc://") ? mxcToHttp(url) : url;
	
	// start contentapi bot
	const capi = new CAPI({
		username: config.capi_user,
		password: config.capi_pass,
		url: config.capi_url,
	});
	// the same store is reused because the urls won't conflict
	capi.avatars = avatarStore.store;
	capi.on("avatarupload", () => {
		avatarStore.save().catch(err => {
			console.error("Error writing avatar store", err);
		});
	});
	
	// store associations for messages sent by the bridge so it can mirror edits and deletes
	const capiToMatrix = {};
	const matrixToCapi = {};
	
	// capi -> matrix
	
	capi.on("message", (message, user) => getMxRoom(message, async room => {
		capiToMatrix[message.id] = await mxbridge.sendMessage(
			room,
			{
				localpart: "capi_" + message.createUserId,
				username: (message.values?.n && message.values.n !== user.username ? message.values.n + " (" + user.username + ")" : user.username),
				avatar: user.avatar && (user.avatar !== "0") ? capi.url + "/api/file/raw/" + user.avatar : undefined
			},
			message.text,
			message.values?.m === "12y" ? tohtml(message.text) : undefined,
		);
	}));
	
	capi.on("edit", (message, user) => getMxRoom(message, async room => {
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
	}));
	
	capi.on("delete", message => getMxRoom(message, async room => {
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
	}));
	
	// matrix -> capi
	
	const handleBindMessage = evt => {
		// command to bind a new room
		if(typeof(evt.content.body) === "string" && evt.content.body.startsWith("$bind ")) {
			const intent = bridge.getIntent();
			const text = msg => intent.sendText(evt.room_id, msg);
			
			if(!config.admins.includes(evt.sender)) {
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
	
	mxbridge.on("message", async (content, evt) => {
		if(!(evt.room_id in bindings)) {
			handleBindMessage(evt);
			return;
		}
		
		const member = (await bridge.getBot().getJoinedMembers(evt.room_id))?.[evt.sender];
		const { text, markup } = evtToMarkup(content, mxcOrUrl);
		
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
		if(!(replaces in matrixToCapi)) {
			console.error("matrix edit for unknown capi message");
			return;
		}
		
		const { text, markup } = evtToMarkup(content, mxcOrUrl);
		matrixToCapi[evt.event_id] = await capi.editMessage(matrixToCapi[replaces], bindings[evt.room_id], text, markup);
	});
	
	mxbridge.on("redact", async (redacts, evt) => {
		if(!(evt.room_id in bindings)) {
			return;
		}
		if(!(redacts in matrixToCapi)) {
			console.error("matrix redaction for unknown capi message");
			return;
		}
		
		await capi.deleteMessage(matrixToCapi[redacts]);
	});
});

process.on("unhandledRejection", reason => {
	console.log("Unhandled rejection:", reason);
});
