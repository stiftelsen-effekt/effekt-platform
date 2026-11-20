import { describe, expect, it } from "vitest";
import {
  createGatewayApiProvider,
  GATEWAYAPI_BASE_URL,
  maskPhone,
  SmsProviderError,
} from "../custom_modules/giftcards/sms";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: string) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("GatewayAPI SMS provider", () => {
  it("posts the message with a token header and integer MSISDN", async () => {
    const { impl, calls } = fakeFetch(
      200,
      JSON.stringify({ msg_id: "01JNN696A9E0WS89FPYGT15NBX" }),
    );
    const provider = createGatewayApiProvider({
      token: "tok",
      sender: "GiEffektivt",
      fetchImpl: impl,
    });

    const result = await provider.send("+4791234567", "Hei!", "giftcard-10");

    expect(result).toEqual({ id: "01JNN696A9E0WS89FPYGT15NBX" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GATEWAYAPI_BASE_URL}/mobile/single`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Token tok");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      sender: "GiEffektivt",
      message: "Hei!",
      recipient: 4791234567,
      reference: "giftcard-10",
    });
  });

  it("uses another platform's base URL when given", async () => {
    const { impl, calls } = fakeFetch(200, "{}");
    const provider = createGatewayApiProvider({
      token: "tok",
      sender: "GiEffektivt",
      baseUrl: "https://messaging.gatewayapi.com/",
      fetchImpl: impl,
    });
    await provider.send("+4791234567", "Hei!");
    expect(calls[0].url).toBe("https://messaging.gatewayapi.com/mobile/single");
  });

  it("throws with the status and body on an error response, without the token", async () => {
    const { impl } = fakeFetch(422, '{"message":"invalid recipient"}');
    const provider = createGatewayApiProvider({
      token: "secret-token",
      sender: "GiEffektivt",
      fetchImpl: impl,
    });

    const err = await provider.send("+4791234567", "Hei!").catch((e) => e);

    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain("invalid recipient");
    expect(err.message).not.toContain("secret-token");
  });

  it("masks the recipient's number in an error body that echoes it", async () => {
    const { impl } = fakeFetch(422, '{"message":"invalid recipient 4791234567"}');
    const provider = createGatewayApiProvider({
      token: "t",
      sender: "GiEffektivt",
      fetchImpl: impl,
    });
    const err = await provider.send("+4791234567", "Hei!").catch((e) => e);
    expect(err.message).not.toContain("4791234567");
    expect(err.message).toContain("4791****67");
    expect(err.outcome).toBe("not_sent");
  });

  it("treats an accepted request with an unreadable body as sent", async () => {
    const { impl } = fakeFetch(202, "<html>ok</html>");
    const provider = createGatewayApiProvider({
      token: "t",
      sender: "GiEffektivt",
      fetchImpl: impl,
    });
    await expect(provider.send("+4791234567", "Hei!")).resolves.toEqual({ id: null });
  });

  it("calls a timeout or lost connection an unknown outcome, and a refused connection not sent", async () => {
    const failing = (err: unknown) =>
      createGatewayApiProvider({
        token: "t",
        sender: "GiEffektivt",
        fetchImpl: (async () => {
          throw err;
        }) as unknown as typeof fetch,
      });
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    for (const [err, outcome] of [
      [timeout, "unknown"],
      [reset, "unknown"],
      [refused, "not_sent"],
    ] as const) {
      const e = await failing(err)
        .send("+4791234567", "Hei!")
        .catch((x) => x);
      expect(e).toBeInstanceOf(SmsProviderError);
      expect(e.outcome, String(err)).toBe(outcome);
    }
  });

  it("calls a gateway error an unknown outcome and a refusal not sent", async () => {
    for (const [status, outcome] of [
      [400, "not_sent"],
      [429, "not_sent"],
      [503, "not_sent"],
      [500, "unknown"],
      [504, "unknown"],
    ] as const) {
      const { impl } = fakeFetch(status, "{}");
      const provider = createGatewayApiProvider({
        token: "t",
        sender: "GiEffektivt",
        fetchImpl: impl,
      });
      const err = await provider.send("+4791234567", "Hei!").catch((e) => e);
      expect(err.outcome, String(status)).toBe(outcome);
    }
  });

  it("refuses numbers that aren't E.164 without calling the API", async () => {
    const { impl, calls } = fakeFetch(200, "{}");
    const provider = createGatewayApiProvider({
      token: "tok",
      sender: "GiEffektivt",
      fetchImpl: impl,
    });

    await expect(provider.send("91234567", "Hei!")).rejects.toThrow(SmsProviderError);
    expect(calls).toHaveLength(0);
  });

  it("requires a token and a valid alphanumeric sender", () => {
    expect(() => createGatewayApiProvider({ token: "", sender: "GiEffektivt" })).toThrow(/TOKEN/);
    expect(() => createGatewayApiProvider({ token: "t", sender: "Gi Effektivt!" })).toThrow(
      /sender/,
    );
    expect(() => createGatewayApiProvider({ token: "t", sender: "GiEffektivtX" })).toThrow(
      /sender/,
    );
  });

  it("masks phone numbers for logs", () => {
    expect(maskPhone("+4791234567")).toBe("+4791****67");
  });
});
