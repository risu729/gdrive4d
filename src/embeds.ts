import { drive_v3 } from "@googleapis/drive";
import { deepMatch, sleep } from "bun";
import {
	BaseMessageOptions,
	EmbedBuilder,
	Message,
	PartialMessage,
	isJSONEncodable,
} from "discord.js";
import { GaxiosError } from "gaxios";
import { driveClient, fileTypes } from "./gdrive";
import { appendInvisible, decodeAppendedInvisible } from "./util";

/**
 * Extract Google Drive file IDs from a string.
 * @param content string to extract file IDs from
 * @returns extracted file IDs
 */
const extractFileIds = (content: string): string[] => {
	// file ID is the path segment after d (files), e (forms), or folders
	// ref: https://github.com/spamscanner/url-regex-safe/blob/6c1e2c3b5557709633a2cc971d599469ea395061/src/index.js#L80
	// ref: https://stackoverflow.com/questions/16840038/easiest-way-to-get-file-id-from-url-on-google-apps-script
	const regex =
		/https?:\/\/(?:drive|docs)\.google\.com\/[^\s'"\)]+\/(?:d|e|folders)\/([-\w]{25,})(?:\/[^\s'"\)]*[^\s"\)'.?!])?/g;
	// biome-ignore lint/style/noNonNullAssertion: the first matching group is always defined if the regex matches
	return [...content.matchAll(regex)].map(([, id]) => id!);
};

/**
 * Retrieve the old embeds message of a source message.
 * @param message source message
 * @param maxRetries maximum number of retries to retrieve the old embeds message
 * @returns old embeds message, or undefined if not found
 */
const retrieveOldEmbedsMessage = async (
	message: Message | PartialMessage,
	maxRetries = 0,
): Promise<Message | undefined> => {
	const {
		channel,
		id: sourceId,
		client: { user: { id: botUserId } },
	} = message;

	const history = await channel.messages.fetch({
		after: sourceId,
		limit: 10,
	});
	const oldEmbedsMessage = history
		.filter((message) => message.author.id === botUserId)
		// oldest to newest because we want to get the message nearest to the source message
		.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
		.find(({ embeds }) => {
			// source message ID is hidden in the title of the first embed
			const firstEmbed = embeds[0];
			// ignore messages without embeds
			if (!firstEmbed?.title) {
				return false;
			}
			return sourceId === decodeAppendedInvisible(firstEmbed.title);
		});
	if (oldEmbedsMessage || !maxRetries) {
		return oldEmbedsMessage;
	}

	// retry after 1 second if the message is not found
	await sleep(1000);
	return await retrieveOldEmbedsMessage(message, maxRetries - 1);
};

/**
 * Create an embeds message from a source message.
 * @param message source message
 * @returns embeds message, or undefined if no embeds are created
 */
const createEmbedsMessage = async ({
	content,
	id: sourceId,
}: Message): Promise<BaseMessageOptions | undefined> => {
	const fileIds = extractFileIds(content);
	const files = await Promise.all(
		fileIds.map((id) =>
			driveClient.files
				.get({
					fileId: id,
					// docs: https://developers.google.com/drive/api/guides/fields-parameter
					fields: "name,webViewLink,mimeType,modifiedTime",
				})
				.then(({ data }) => data)
				.catch((error) => {
					// ignore not found errors because the file might no be shared with the bot
					if (
						error instanceof GaxiosError &&
						error.response?.data.error.errors.some(
							({ reason }: { reason: string }) => reason === "notFound",
						)
					) {
						return undefined;
					}
					console.error(error);
					throw error;
				}),
		),
	).then((files) =>
		files.filter((file): file is drive_v3.Schema$File => file !== undefined),
	);
	if (!files.length) {
		return;
	}

	return {
		embeds: files.map(({ name, webViewLink, mimeType, modifiedTime }, i) => {
			// fields must be defined because we specified them in the fields parameter
			if (!(name && webViewLink && mimeType && modifiedTime)) {
				throw new Error(
					`Missing required fields: name=${name}, webViewLink=${webViewLink}, mimeType=${mimeType}, modifiedTime=${modifiedTime}`,
				);
			}

			// hide source message ID in the title of the first embed
			const title = i > 0 ? name : appendInvisible(name, sourceId);
			return new EmbedBuilder()
				.setTitle(title)
				.setURL(webViewLink)
				.setColor(
					(
						Object.values(fileTypes).find(({ mime }) => mime === mimeType) ??
						fileTypes.others
					).color,
				)
				.setTimestamp(new Date(modifiedTime))
				.toJSON();
		}),
	};
};

/**
 * Update the embeds message of a source message.
 * @param sourceMessage source message
 * @param newlyCreated whether the source message is newly created
 */
export const updateEmbedsMessage = async (
	sourceMessage: Message,
	newlyCreated = false,
) => {
	const [oldEmbedsMessage, newEmbedsMessage] = await Promise.all([
		// skip retrieving old embeds message if the source message is newly created
		// retry twice because the old embeds might not be sent yet when the source is updated in quick succession
		newlyCreated ? undefined : retrieveOldEmbedsMessage(sourceMessage, 2),
		createEmbedsMessage(sourceMessage),
	]);

	if (!oldEmbedsMessage) {
		if (!newEmbedsMessage) {
			return;
		}

		await sourceMessage.channel.send(newEmbedsMessage);
		return;
	}

	if (!newEmbedsMessage) {
		await oldEmbedsMessage.delete();
		return;
	}

	if (
		oldEmbedsMessage.embeds?.every(({ data: oldEmbedData }, i) => {
			const newEmbed = newEmbedsMessage.embeds?.[i];
			if (!newEmbed) {
				return false;
			}
			const newEmbedData = isJSONEncodable(newEmbed)
				? newEmbed.toJSON()
				: newEmbed;

			// do not use Embed#equals because it compares timestamps just as strings
			return (
				new Date(oldEmbedData.timestamp ?? 0).getTime() ===
					new Date(newEmbedData.timestamp ?? 0).getTime() &&
				// oldEmbedData includes some extra properties like `type` or `content_scan_version`
				deepMatch(
					Object.fromEntries(
						Object.entries(newEmbedData).filter(([key]) => key !== "timestamp"),
					),
					oldEmbedData,
				)
			);
		})
	) {
		// do not edit if the embeds are the same to avoid `(edited)` in the message
		return;
	}

	await oldEmbedsMessage.edit(newEmbedsMessage);
	return;
};

/**
 * Delete the embeds message of a source message.
 * @param sourceMessage source message
 */
export const deleteEmbedsMessage = async (
	sourceMessage: Message | PartialMessage,
) => {
	const oldEmbedsMessage = await retrieveOldEmbedsMessage(sourceMessage);
	await oldEmbedsMessage?.delete();
};
