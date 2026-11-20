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
 * GatewayAPI's EU-owned setup, where our account is. Accounts on their Google Cloud setup use
 * https://messaging.gatewayapi.com instead (GATEWAYAPI_BASE_URL); a token only works on its own.
 */
export const GATEWAYAPI_BASE_URL = "https://messaging.gatewayapi.eu";

/**
 * An error from the SMS provider. Never carries the API token or the full phone number.
 * `outcome` says whether the SMS may still have gone out:
 * - "not_sent": the provider refused it or was never reached; sending again is safe
 * - "unknown": the request may have been accepted (timeout, connection lost, gateway error);
 *   sending again could send the SMS twice, so it is left for a person to check
 */
export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly outcome: "not_sent" | "unknown" = "not_sent",
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

/** Network errors raised before the request can have reached the provider */
const NOT_CONNECTED_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Responses after which the provider certainly did not take the message */
const isDefiniteRefusal = (status: number) => status < 500 || status === 501 || status === 503;

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
      // Provider messages may echo the number; logs and Last_error get it masked
      const redact = (s: string) => s.split(to.slice(1)).join(maskPhone(to).slice(1));
      let res: Response;
      try {
        res = await fetchImpl(url, {
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
      } catch (ex) {
        const err = ex as Error & { cause?: { code?: string } };
        const code = err?.cause?.code ?? (err as { code?: string })?.code;
        if (code && NOT_CONNECTED_CODES.has(code)) {
          throw new SmsProviderError(`GatewayAPI not reached (${code})`, null, "not_sent");
        }
        // Timed out or lost the connection after sending: GatewayAPI may have accepted it
        throw new SmsProviderError(
          `GatewayAPI request failed (${err?.name ?? "Error"}${code ? ` ${code}` : ""}), outcome unknown`,
          null,
          "unknown",
        );
      }
      if (!res.ok) {
        // The body names the offending field; it never echoes the token
        const body = await res.text().catch(() => "");
        throw new SmsProviderError(
          `GatewayAPI responded ${res.status}: ${redact(body).slice(0, 500)}`,
          res.status,
          isDefiniteRefusal(res.status) ? "not_sent" : "unknown",
        );
      }
      // 2xx: accepted. An unreadable body must not make it look unsent (it would be sent again)
      try {
        const parsed = JSON.parse(await res.text()) as { msg_id?: unknown };
        return { id: typeof parsed?.msg_id === "string" ? parsed.msg_id : null };
      } catch {
        return { id: null };
      }
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
