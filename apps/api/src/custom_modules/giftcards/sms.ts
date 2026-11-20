const config = require("../../config.js");

/**
 * Sends SMS. Providers:
 * - "gatewayapi": GatewayAPI's Messaging API, the production provider
 * - "log": prints the message instead of sending it; the default outside production and
 *   refused in production
 * Production without a configured provider fails closed: getSmsProvider throws and no gift card
 * is marked as sent.
 */
export interface SmsProvider {
  readonly name: string;
  /**
   * Sends one SMS to an E.164 number; resolves with the provider's message id. `reference` is
   * our own id, echoed back by the provider in delivery reports.
   */
  send(to: string, text: string, reference?: string): Promise<{ id: string | null }>;
}

export function maskPhone(to: string): string {
  return to.slice(0, 5) + "*".repeat(Math.max(0, to.length - 7)) + to.slice(-2);
}

const logProvider: SmsProvider = {
  name: "log",
  async send(to, text) {
    console.log(`[sms:log] to ${maskPhone(to)}:\n${text}`);
    return { id: null };
  },
};

/**
 * GatewayAPI's Google Cloud (EU region) platform. Accounts on their EU-owned platform use
 * https://messaging.gatewayapi.eu instead (GATEWAYAPI_BASE_URL); a token only works on its own.
 */
export const GATEWAYAPI_BASE_URL = "https://messaging.gatewayapi.com";

/** An error from the SMS provider. Never carries the API token. */
export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

/**
 * GatewayAPI (https://gatewayapi.com/docs/message/overview/): POST JSON with
 * `Authorization: Token <token>`; the recipient is MSISDN as an integer without "+".
 */
export function createGatewayApiProvider(opts: {
  token: string;
  sender: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): SmsProvider {
  const {
    token,
    sender,
    baseUrl = GATEWAYAPI_BASE_URL,
    fetchImpl = fetch,
    timeoutMs = 15_000,
  } = opts;
  const url = `${baseUrl.replace(/\/+$/, "")}/mobile/single`;
  if (!token) throw new Error("GATEWAYAPI_TOKEN is not set");
  if (!/^[A-Za-z0-9 ]{1,11}$/.test(sender)) {
    throw new Error(`Invalid SMS sender "${sender}" (1–11 characters, A–Z, a–z, 0–9)`);
  }
  return {
    name: "gatewayapi",
    async send(to, text, reference) {
      if (!/^\+\d{8,15}$/.test(to)) throw new SmsProviderError("Recipient is not E.164", null);
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender,
          message: text,
          recipient: Number(to.slice(1)),
          ...(reference ? { reference } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.text();
      if (!res.ok) {
        // The body names the offending field; it never echoes the token
        throw new SmsProviderError(
          `GatewayAPI responded ${res.status}: ${body.slice(0, 500)}`,
          res.status,
        );
      }
      let parsed: { msg_id?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new SmsProviderError(`GatewayAPI responded ${res.status} with non-JSON`, res.status);
      }
      return { id: typeof parsed.msg_id === "string" ? parsed.msg_id : null };
    },
  };
}

export function getSmsProvider(): SmsProvider {
  const name: string = config.sms_provider || (config.env === "production" ? "" : "log");
  switch (name) {
    case "log":
      if (config.env === "production") {
        throw new Error("SMS_PROVIDER=log is not allowed in production");
      }
      return logProvider;
    case "gatewayapi":
      return createGatewayApiProvider({
        token: config.gatewayapi_token,
        sender: config.sms_sender || "GiEffektivt",
        baseUrl: config.gatewayapi_base_url || undefined,
      });
    default:
      throw new Error(`SMS provider not configured (SMS_PROVIDER="${name}")`);
  }
}
