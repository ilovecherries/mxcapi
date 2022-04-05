const EventEmitter = require("events");
const { Client, Intents, Message } = require("discord.js");

module.exports.DiscordBridge = class DiscordBridge extends EventEmitter {
	constructor({ token }) {
		super();
		
		const client = this.client = new Client({
			intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES],
		});
		
		client.login(token).then(() => {
			console.log("Connected to discord as", client.user.username);
		});
		
		// re-emit some events
		["messageCreate", "messageUpdate", "messageDelete"].forEach(n => {
			client.on(n, async (message, ...args) => {
				if(
					message.author !== client.user && // not from bot
					message.author.id !== (await this.getWebhook(message.channelId, false))?.id // not from webhook
				) {
					this.emit(n, message, ...args);
				}
			});
		})
	}
	
	async getWebhook(channelId, create = true) {
		const channel = await this.client.channels.fetch(channelId);
		if(!("fetchWebhooks" in channel)) {
			return;
		}
		
		let webhook = (await channel.fetchWebhooks())
			.find(wh => wh.owner === this.client.user);
		if(!webhook && create) {
			// make one
			webhook = await channel.createWebhook("contentapi bridge");
		}
		
		return webhook;
	}
	
	async sendMessageAsBot(channelId, content) {
		const channel = await this.client.channels.fetch(channelId);
		return await channel.send({
			content,
		})
	}
	
	async sendMessage(channel, username, avatar, content) {
		const webhook = await this.getWebhook(channel);
		
		return await webhook.send({
			username,
			avatarURL: avatar,
			content,
		})
	}
	
	/**
	 * @param {Message} message
	 * @param {string} content
	 */
	async editMessage(message, content) {
		const webhook = await this.getWebhook(message.channelId);
		
		return await webhook.editMessage(message, {
			content,
		})
	}
	
	/**
	 * @param {Message} message
	 */
	async deleteMessage(message) {
		const webhook = await this.getWebhook(message.channelId);
		
		return await webhook.deleteMessage(message)
	}
}
