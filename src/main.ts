import { env } from "bun";
import { consola } from "consola";
import {
	ActivityType,
	Client,
	Events,
	GatewayIntentBits,
	type Message,
	MessageFlags,
	type PartialMessage,
	Partials,
} from "discord.js";
import { checkBotStatus, checkEnvs } from "./checks";
import { commandsListener, registerCommands } from "./commands";
import { deleteEmbedsMessage, updateEmbedsMessage } from "./embeds";
import { driveClient } from "./gdrive";

consola.start("gdrive4d is starting...");

checkEnvs();

consola.start("Starting Google Drive API client...");
consola.info(`Service account email: ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
// test if the client is working, fail fast
const files = await driveClient.files.list();
// exit if the service account has access to no files
if (files.data.files?.length === 0) {
	consola.warn(
		"No files are shared to the service account in Google Drive. Share some files to the service account and try again.",
	);
}
consola.ready("Google Drive API client is now ready!");

consola.start("Starting Discord bot...");
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
	consola.ready("Discord bot is now ready!");
	consola.info(`Logged in as ${client.user.tag}.`);

	client.user.setActivity("Google Drive", { type: ActivityType.Watching });

	await checkBotStatus(client);

	await registerCommands(client);

	consola.ready("gdrive4d is successfully started!");
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
		consola.warn(
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
	await updateEmbedsMessage(message, { isNewlyCreated: true });
});

discordClient.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
	if (!isValidRequest(newMessage)) {
		return;
	}

	// retrieve the full message to get the content
	const fullNewMessage = newMessage.partial
		? await newMessage.fetch()
		: newMessage;
	await updateEmbedsMessage(fullNewMessage, {
		isEmbedsSuppressed:
			// do not treat the event as suppressed if the old message is partial
			!(
				oldMessage.partial || oldMessage.flags.has(MessageFlags.SuppressEmbeds)
			) && fullNewMessage.flags.has(MessageFlags.SuppressEmbeds),
	});
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
