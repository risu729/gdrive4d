import { env } from "bun";
import { consola } from "consola";
import {
	ApplicationCommandType,
	type ChatInputCommandInteraction,
	type Client,
	ContextMenuCommandBuilder,
	type Interaction,
	type MessageContextMenuCommandInteraction,
	type RESTPostAPIChatInputApplicationCommandsJSONBody,
	type RESTPostAPIContextMenuApplicationCommandsJSONBody,
	type RESTPutAPIApplicationGuildCommandsJSONBody,
	Routes,
	type UserContextMenuCommandInteraction,
} from "discord.js";
import { updateEmbedsMessage } from "./embeds";

type ExecutableCommand =
	| {
			type: ApplicationCommandType.ChatInput;
			data: RESTPostAPIChatInputApplicationCommandsJSONBody;
			execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
	  }
	| {
			type: ApplicationCommandType.Message;
			data: RESTPostAPIContextMenuApplicationCommandsJSONBody;
			execute: (
				interaction: MessageContextMenuCommandInteraction,
			) => Promise<void>;
	  }
	| {
			type: ApplicationCommandType.User;
			data: RESTPostAPIContextMenuApplicationCommandsJSONBody;
			execute: (
				interaction: UserContextMenuCommandInteraction,
			) => Promise<void>;
	  };

/**
 * Application commands registered to the bot.
 */
export const commands: ExecutableCommand[] = [
	{
		type: ApplicationCommandType.Message,
		data: new ContextMenuCommandBuilder()
			.setType(ApplicationCommandType.Message)
			.setName("Update Embeds")
			.toJSON(),
		execute: async (interaction) => {
			interaction.deferReply({ ephemeral: true });
			await updateEmbedsMessage(interaction.targetMessage);
			interaction.deleteReply();
		},
	},
];

/**
 * Register application commands of the bot to Discord.
 * @param client client used to register commands
 */
export const registerCommands = async (client: Client<true>) => {
	consola.start("Registering application commands...");
	try {
		const body: RESTPutAPIApplicationGuildCommandsJSONBody = commands.map(
			(command) => command.data,
		);
		await client.rest.put(
			// register as guild commands to avoid accessing data from DMs or other guilds
			Routes.applicationGuildCommands(
				client.application.id,
				env.DISCORD_GUILD_ID,
			),
			{ body },
		);

		consola.success(
			`Successfully registered application commands: ${commands
				.map((command) => command.data.name)
				.join(", ")}`,
		);
	} catch (error) {
		consola.error("Failed to register application commands.");
		// do not use consola#error to throw Error since it cannot handle line numbers correctly
		console.error(error);
		// bun does not exit with a thrown error in listener
		process.exit(1);
	}
};

/**
 * Listener for application command interactions.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: if-else statements are necessary here
export const commandsListener = async (interaction: Interaction) => {
	if (!interaction.isCommand()) {
		return;
	}

	// ignore commands from unauthorized guilds or DMs
	if (interaction.guildId !== env.DISCORD_GUILD_ID) {
		consola.warn(
			`Command ${interaction.commandName} was triggered in ${
				interaction.inGuild() ? "an unauthorized guild" : "DM"
			}.`,
		);
		return;
	}

	for (const command of commands) {
		if (command.data.name !== interaction.commandName) {
			continue;
		}

		// do not use switch-case here because the types are not narrowed
		if (
			interaction.isChatInputCommand() &&
			command.type === ApplicationCommandType.ChatInput
		) {
			await command.execute(interaction);
			return;
		}
		if (
			interaction.isMessageContextMenuCommand() &&
			command.type === ApplicationCommandType.Message
		) {
			await command.execute(interaction);
			return;
		}
		if (
			interaction.isUserContextMenuCommand() &&
			command.type === ApplicationCommandType.User
		) {
			await command.execute(interaction);
			return;
		}

		consola.error(`Command ${command.data.name} not found.`);
	}
};
