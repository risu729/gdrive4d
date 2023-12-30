// use 0x2060 to 0x206f as invisible characters
// 0x2065 is unassigned, so use 0x200b instead
// ref: https://www.unicode.org/charts/PDF/U2000.pdf
const invisibleChars = Array.from(
	{ length: 16 },
	(_, i) =>
		// i === 5 ? 0x200b :
		0x2060 + i,
);

/**
 * Encode a string into invisible string.
 * @param str string to encode
 * @returns encoded invisible string
 */
const encode = (str: string): string => {
	const nibbles = Array.from(new TextEncoder().encode(str))
		// byte is an octet
		// split into upper and lower nibbles
		.flatMap((byte) => [byte >> 4, byte & 0xf])
		// biome-ignore lint/style/noNonNullAssertion: i is a nibble
		.map((i) => invisibleChars[i]!);
	return String.fromCodePoint(...nibbles);
};

/**
 * Decode an invisible string into a string.
 * @param encoded invisible string to decode
 * @returns decoded string
 */
const decode = (encoded: string): string => {
	// convert to codePoints to handle surrogate pairs in encoded
	const nibbles = Array.from(encoded)
		// biome-ignore lint/style/noNonNullAssertion: char must be a single char
		.map((char) => char.codePointAt(0)!)
		.map((codepoint) => {
			const index = invisibleChars.indexOf(codepoint);
			if (index === -1) {
				throw new Error(
					`Invalid invisible character: ${String.fromCodePoint(
						codepoint,
					)} (U+${codepoint.toString(16).toUpperCase().padStart(4, "0")})`,
				);
			}
			return index;
		});
	const bytes = new Uint8Array(nibbles.length / 2);
	for (let i = 0; i < nibbles.length - 1; i += 2) {
		// biome-ignore lint/style/noNonNullAssertion: i < nibbles.length - 1
		bytes[i / 2] = (nibbles[i]! << 4) | nibbles[i + 1]!;
	}
	return new TextDecoder().decode(bytes);
};

/**
 * Append an invisible string to a visible string.
 * @param visible string to append to
 * @param invisible string to encode and append
 * @returns appended string
 */
export const appendInvisible = (visible: string, invisible: string): string => {
	return `${visible}${encode(invisible)}`;
};

/**
 * Decode the invisible string appended to a visible string.
 * @param text string with invisible string to decode appended
 * @returns decoded string
 */
export const decodeAppendedInvisible = (text: string): string => {
	const indexOfInvisible = Math.min(
		...invisibleChars
			.map((char) => text.indexOf(String.fromCodePoint(char)))
			.filter((i) => i !== -1),
	);
	return decode(text.substring(indexOfInvisible));
};
