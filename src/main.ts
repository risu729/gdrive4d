import { env } from "bun";
import {
	ActivityType,
	Client,
	Events,
	GatewayIntentBits,
	Message,
	MessageFlags,
	PartialMessage,
	Partials,
	PermissionFlagsBits,
} from "discord.js";
import { commandsListener, registerCommands } from "./commands";
import { deleteEmbedsMessage, updateEmbedsMessage } from "./embeds";
import { driveClient } from "./gdrive";

// check environment variables are set
for (const name of [
	"DISCORD_BOT_TOKEN",
	"DISCORD_GUILD_ID",
	"GOOGLE_SERVICE_ACCOUNT_EMAIL",
	"GOOGLE_SERVICE_ACCOUNT_KEY",
]) {
	if (!env[name]) {
		throw new Error(
			`Environment variable ${name} is not set. Set it in .env file.`,
		);
	}
}

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

	const guilds = client.guilds.cache;
	if (!guilds.has(env.DISCORD_GUILD_ID)) {
		// exit if the bot is not in the target guild
		console.error(`Bot is not in the target guild ${env.DISCORD_GUILD_ID}.`);
		// bun does not exit with a thrown error in listener
		process.exit(1);
	}

	// exit if the bot is missing some required permissions
	const requiredPermissions = [
		PermissionFlagsBits.ViewChannel,
		PermissionFlagsBits.SendMessages,
		PermissionFlagsBits.SendMessagesInThreads,
		// required to send embeds
		PermissionFlagsBits.EmbedLinks,
		PermissionFlagsBits.ReadMessageHistory,
		// required to suppress embeds of original messages
		PermissionFlagsBits.ManageMessages,
	];
	// biome-ignore lint/style/noNonNullAssertion: already ensured that the bot is in the target guild
	const bot = await guilds.get(env.DISCORD_GUILD_ID)!.members.fetchMe();
	const missingPermissions = bot.permissions.missing(requiredPermissions);
	if (missingPermissions.length) {
		console.error(
			`Bot is missing the following required permissions: ${missingPermissions.join(
				", ",
			)}.`,
		);
		// bun does not exit with a thrown error in listener
		process.exit(1);
	}

	// leave unauthorized guilds
	for (const [id, guild] of guilds) {
		if (id !== env.DISCORD_GUILD_ID) {
			await guild.leave();
			console.warn(`Left unauthorized guild ${guild.name} (${id}).`);
		}
	}
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
