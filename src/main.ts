import { env } from "bun";
import {
	ActivityType,
	Client,
	Events,
	GatewayIntentBits,
	Message,
	PartialMessage,
	Partials,
	PermissionFlagsBits,
} from "discord.js";
import { commandsListener, registerCommands } from "./commands";
import { deleteEmbedsMessage, updateEmbedsMessage } from "./embeds";
import { driveClient } from "./gdrive";

console.info("Starting Google Drive API client...");
console.info(`Service account email: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
// test if the client is working, fail fast
const files = await driveClient.files.list();
// exit if the service account has access to no files
if (!files.data.files?.length) {
	throw new Error(
		"No files are shared to the service account in Google Drive.",
	);
}
console.info("Google Drive API client is now ready!");

console.info("Starting Discord bot...");
const discordClient = new Client({
	intents: [
		// required to receive messages
		// ref: https://discordjs.guide/popular-topics/intents.html#enabling-intents
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
	partials: [Partials.Message],
});

discordClient.once(Events.ClientReady, async (client) => {
	console.info("Discord bot is now ready!");
	console.info(`Logged in as ${client.user.tag}.`);

	await registerCommands(client);

	client.user.setActivity("Google Drive", { type: ActivityType.Watching });
});

discordClient.on(Events.InteractionCreate, commandsListener);

const isValidRequest = (message: Message | PartialMessage): boolean => {
	// ignore self messages
	// false positive for partial messages without author
	if (message.author?.id === message.client.user.id) {
		return false;
	}
	// ignore commands from unauthorized guilds or DMs
	if (message.guildId !== env.DISCORD_GUILD_ID) {
		console.warn(
			`Message event was sent in ${
				message.inGuild() ? "an unauthorized guild" : "DM"
			}.`,
		);
		return false;
	}
	return true;
};

discordClient.on(Events.MessageCreate, async (message) => {
	if (!isValidRequest(message)) {
		return;
	}
	await updateEmbedsMessage(message, true);
});

discordClient.on(Events.MessageUpdate, async (_, newMessage) => {
	if (!isValidRequest(newMessage)) {
		return;
	}
	// ignore embeds only updates events, which are triggered immediately after MessageCreate
	if (newMessage.editedTimestamp === null) {
		return;
	}

	// retrieve the full message to get the content
	const fullMessage = newMessage.partial
		? await newMessage.fetch()
		: newMessage;
	await updateEmbedsMessage(fullMessage);
});

discordClient.on(Events.MessageDelete, async (message) => {
	if (!isValidRequest(message)) {
		return;
	}
	await deleteEmbedsMessage(message);
});

discordClient.on(Events.MessageBulkDelete, async (messages) => {
	// do not parallelize to avoid rate limit
	for (const message of messages.values()) {
		if (!isValidRequest(message)) {
			continue;
		}
		await deleteEmbedsMessage(message);
	}
});

discordClient.login(env.DISCORD_BOT_TOKEN);
