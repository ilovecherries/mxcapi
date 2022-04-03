const { Cli, Bridge, AppServiceRegistration } = require("matrix-appservice-bridge");
const CAPI = require("./capi");
const tohtml = require("./12ytohtml");
const { store } = require("./store");
const { ensureUploaded } = require("./matrix");

const bindings = store("data/bindings.json");

const bridgeUser = () => bridge.getBot().getUserId();

/*
 * Matrix handlers
 */

async function handleMatrixInvites(evt) {
	if(
		evt.type !== "m.room.member" ||
		evt.state_key !== bridgeUser() ||
		evt.content?.membership !== "invite"
	) {
		return;
	}
	
	console.log("got invite! joining")
	await bridge.getIntent().join(evt.room_id);
}

async function handleMatrixMessages(evt) {
	if(
		evt.type !== "m.room.message" ||
		!evt.content ||
		!(evt.room_id in bindings)
	) {
		return;
	}
	
	// edit message
	if(evt.content["m.relates_to"]?.["rel_type"] === "m.replace" && evt.content["m.new_content"]) {
		await capi.editMessage(evt, bindings[evt.room_id]);
		return;
	}
	
	// new message
	await capi.writeMessage(evt, bindings[evt.room_id]);
}

/*
 * CAPI handlers
 */

async function handleCAPIMessage(message, user) {
	const binding = Object.entries(bindings).find(n => n[1] === message.contentId);
	if(!binding) {
		return;
	}
	const room_id = binding[0];
	
	const intent = bridge.getIntentFromLocalpart("capi_" + message.createUserId);
	if(user?.username) {
		await intent.setDisplayName(user.username);
	}
	if(user?.avatar) {
		const url = await ensureUploaded(user.avatar, intent);
		if(url) {
			await intent.setAvatarUrl(url);
		}
	}
	await intent.sendMessage(room_id, {
		msgtype: "m.text",
		body: message.text,
		...(message.values?.m === "12y" ? {
			format: "org.matrix.custom.html",
			formatted_body: tohtml(message.text),
		} : {})
	})
}

new Cli({
	registrationPath: "data/capi-registration.yaml",
	bridgeConfig: {
		schema: "capi-config-schema.yaml",
		defaults: {
			capi_url: "http://localhost:5000", // todo: change to main qcs instance once i'm not scared
		},
	},
	generateRegistration(reg, cb) {
		reg.setId(AppServiceRegistration.generateToken());
		reg.setHomeserverToken(AppServiceRegistration.generateToken());
		reg.setAppServiceToken(AppServiceRegistration.generateToken());
		reg.setSenderLocalpart("capi");
		reg.addRegexPattern("users", "@capi_.*", true);
		reg.addRegexPattern("aliases", "#capi_.*", true);
		cb(reg);
	},
	async run(port, config) {
		/** @global */
		const bridge = global.bridge = new Bridge({
			homeserverUrl: config.homeserver_url,
			domain: config.homeserver,
			registration: "data/capi-registration.yaml",
			controller: {
				onUserQuery(u) {
					return {};
				},
				async onEvent(req, ctx) {
					const evt = req.getData();
					console.log("got event", evt);
					
					await handleMatrixInvites(evt);
					await handleMatrixMessages(evt);
				},
			}
		});
		console.log("Matrix-side listening on port", port);
		await bridge.run(port);
		
		/** @global */
		const capi = global.capi = new CAPI(config);
		capi.on("message", handleCAPIMessage);
	}
}).run();
