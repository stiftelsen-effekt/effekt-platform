const config = require("../../config.js");

/**
 * Sends SMS. Which provider to use is not decided yet; until then only the "log" provider
 * exists, which prints the message instead of sending it. Production without a provider fails
 * closed: getSmsProvider throws and no gift card is marked as sent.
 */
export interface SmsProvider {
  readonly name: string;
  /** Sends one SMS to an E.164 number; resolves with the provider's message id */
  send(to: string, text: string): Promise<{ id: string | null }>;
}

const logProvider: SmsProvider = {
  name: "log",
  async send(to, text) {
    const masked = to.slice(0, 5) + "*".repeat(Math.max(0, to.length - 7)) + to.slice(-2);
    console.log(`[sms:log] to ${masked}:\n${text}`);
    return { id: null };
  },
};

export function getSmsProvider(): SmsProvider {
  const name: string = config.sms_provider || (config.env === "production" ? "" : "log");
  switch (name) {
    case "log":
      if (config.env === "production") {
        throw new Error("SMS_PROVIDER=log is not allowed in production");
      }
      return logProvider;
    default:
      throw new Error(`SMS provider not configured (SMS_PROVIDER="${name}")`);
  }
}
