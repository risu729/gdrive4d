import { auth, drive_v3 } from "@googleapis/drive";
import { env } from "bun";

/**
 * Google Drive API client with a scope `https://www.googleapis.com/auth/drive.metadata.readonly`.
 */
export const driveClient = new drive_v3.Drive({
	auth: new auth.GoogleAuth({
		credentials: {
			// biome-ignore lint/style/useNamingConvention: library's naming convention
			client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
			// replace \n with actual newlines
			// biome-ignore lint/style/useNamingConvention: library's naming convention
			private_key: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, "\n"),
		},
		// we only need to read metadata of files, not their contents
		// ref: https://developers.google.com/identity/protocols/oauth2/scopes#drive
		scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
	}),
});

/**
 * Google Drive file types and their brand colors.
 */
// ref: https://developers.google.com/drive/api/guides/mime-types
export const fileTypes: Record<
	"docs" | "sheets" | "slides" | "forms" | "others",
	{ mime?: string; color: `#${string}` }
> = {
	docs: {
		mime: "application/vnd.google-apps.document",
		color: "#4285f4",
	},
	sheets: {
		mime: "application/vnd.google-apps.spreadsheet",
		color: "#0f9d58",
	},
	slides: {
		mime: "application/vnd.google-apps.presentation",
		color: "#f4b400",
	},
	forms: {
		mime: "application/vnd.google-apps.form",
		color: "#7627bb",
	},
	others: {
		color: "#e3e5e8",
	},
};
