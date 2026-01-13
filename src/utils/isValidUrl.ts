/**
 * Validates if a string is a valid HTTP or HTTPS URL.
 *
 * @param urlString - The URL string to validate
 * @returns true if the URL is valid HTTP/HTTPS, false otherwise
 */
export default function isValidUrl(urlString: string | undefined): boolean {
	if (!urlString) {
		return false;
	}

	try {
		const url = new URL(urlString);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch (_error) {
		return false;
	}
}
