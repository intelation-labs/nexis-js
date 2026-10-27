/** Nexis website, used for sign-up and plan upgrades. */
export const NEXIS_URL = 'https://nexis.intelation.com';

export class NexisError extends Error {
	/** Extra guidance on what to do next. */
	description?: string;
	/** HTTP status, when the error came from the API. */
	status?: number;
	/** API error code, when the API sent one. */
	code?: string;

	constructor(message: string, extra: { description?: string; status?: number; code?: string } = {}) {
		super(message);
		this.name = 'NexisError';
		Object.assign(this, extra);
	}
}

type Body = Record<string, unknown>;

/** Turns raw Nexis API errors into messages a non-technical user can act on. */
export function friendlyApiError(status: number, body: Body): NexisError {
	const nested = body.detail && typeof body.detail === 'object' ? (body.detail as Body) : {};
	const codes = [body.code, body.error_code, body.error, nested.code];
	const code = codes.find((c) => typeof c === 'string') as string | undefined;
	// Only the API's own message fields, never the request (which holds the user's text).
	const apiMessage = [body.detail, body.message, nested.message].filter((v) => typeof v === 'string').join(' ');
	const e = (message: string, description: string) => new NexisError(message, { description, status, code });

	if (codes.includes('country_not_subscribed')) {
		return e(
			"This action is not available for your plan's country",
			`Your plan does not include this country. Add countries by upgrading: ${NEXIS_URL}`,
		);
	}
	if (status === 429 || codes.includes('AUTH_RATE_LIMIT_EXCEEDED')) {
		return e('Too many requests to Nexis', 'The rate limit for your API key was reached. Try again in a minute.');
	}
	if (status === 401 || /not approved|inactive|invalid api key/i.test(apiMessage)) {
		return e(
			'Your Nexis API key is not active',
			`Check that the key is correct and active, or get a free key: ${NEXIS_URL}`,
		);
	}
	if (status === 402) {
		if (/no active subscription/i.test(apiMessage)) {
			return e('Your Nexis account has no active plan', `Choose a plan to use Nexis: ${NEXIS_URL}`);
		}
		const limit = apiMessage.replace(/\s*Upgrade your plan to continue\.?\s*$/i, '');
		const daily = /daily/i.test(limit);
		return e(
			daily ? 'Daily Nexis API call limit reached' : 'Nexis usage limit reached',
			`${limit ? `${limit} ` : ''}${daily ? 'The limit resets at midnight UTC. ' : ''}Upgrade your plan for a higher limit: ${NEXIS_URL}`,
		);
	}
	if (status === 403 && /not available on your (current )?plan/i.test(apiMessage)) {
		return e('Your Nexis plan does not include API access', `Upgrade your plan: ${NEXIS_URL}`);
	}
	return new NexisError(apiMessage || `Nexis API request failed (HTTP ${status})`, { status, code });
}
