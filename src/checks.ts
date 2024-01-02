import { env } from "bun";
import { consola } from "consola";
import {
	Client,
	OAuth2Scopes,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";

/**
 * Check if all required environment variables are set.
 */
export const checkEnvs = () => {
	// need to sync with env.d.ts
	const requiredEnvs = [
		"DISCORD_BOT_TOKEN",
		"DISCORD_GUILD_ID",
		"GOOGLE_SERVICE_ACCOUNT_EMAIL",
		"GOOGLE_SERVICE_ACCOUNT_KEY",
	];
	const missingEnv = requiredEnvs.filter((name) => !env[name]);
	if (!missingEnv.length) {
		return;
	}
	consola.error(
		`Environment variables ${missingEnv.join(
			", ",
		)} are not set. Follow the instructions in README.md and set them in .env.`,
	);
	process.exit(1);
};

/**
 * Check the status of the bot are valid.
 * @param client client after ready event
 */

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ignore for now
export const checkBotStatus = async (client: Client<true>) => {
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

	const guilds = client.guilds.cache;
	const isInTargetGuild = guilds.has(env.DISCORD_GUILD_ID);

	const bot = await guilds.get(env.DISCORD_GUILD_ID)?.members.fetchMe();
	const missingPermissions = bot?.permissions.missing(requiredPermissions);

	const application = await client.application.fetch();
	const botSettingsUrl = `https://discord.com/developers/applications/${application.id}/bot`;
	if (application.botPublic) {
		consola.warn(
			`Bot is public (can be added by anyone). Consider making it private from ${botSettingsUrl}.`,
		);
	}
	if (application.botRequireCodeGrant) {
		if (!(isInTargetGuild && missingPermissions) || missingPermissions.length) {
			if (isInTargetGuild) {
				consola.error(
					`Bot is missing the following required permissions: ${
						!missingPermissions || missingPermissions.join(", ")
					}.`,
				);
			} else {
				consola.error(
					`Bot is not in the target guild ${env.DISCORD_GUILD_ID}.`,
				);
			}
			consola.error(
				`The bot authorization URL cannot be generated because the bot requires OAuth2 code grant. Disable it from ${botSettingsUrl} and try again.`,
			);
			process.exit(1);
		}
		consola.warn(
			`Bot requires OAuth2 code grant. It is unnecessary for this bot. Consider disabling it from ${botSettingsUrl}.`,
		);
	}

	const oauth2Scopes = [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands];
	const authorizationUrl = application.botRequireCodeGrant
		? undefined
		: new URL("https://discord.com/api/oauth2/authorize");
	if (authorizationUrl) {
		authorizationUrl.searchParams.append("client_id", client.user.id);
		authorizationUrl.searchParams.append("scope", oauth2Scopes.join(" "));
		authorizationUrl.searchParams.append(
			"permissions",
			PermissionsBitField.resolve(requiredPermissions).toString(),
		);
	}

	if (!isInTargetGuild) {
		// exit if the bot is not in the target guild
		consola.error(
			`Bot is not in the target guild ${env.DISCORD_GUILD_ID}. ${
				authorizationUrl
					? `Follow this link to add the bot to the guild: ${authorizationUrl}`
					: `Bot requires OAuth2 code grant. It is unnecessary for this bot. Consider disabling it from ${botSettingsUrl}.`
			}`,
		);
		consola.error(
			`Bot requires OAuth2 code grant. It is unnecessary for this bot. Consider disabling it from ${botSettingsUrl}.`,
		);
		process.exit(1);
	}

	// exit if the bot is missing some required permissions
	if (!missingPermissions || missingPermissions.length) {
		consola.error(
			`Bot is missing the following required permissions: ${
				!missingPermissions || missingPermissions.join(", ")
			}. Follow this link to update the permissions: ${authorizationUrl}`,
		);
		process.exit(1);
	}

	// leave unauthorized guilds
	for (const [id, guild] of guilds) {
		if (id !== env.DISCORD_GUILD_ID) {
			await guild.leave();
			consola.warn(`Left unauthorized guild ${guild.name} (${id}).`);
		}
	}
};
