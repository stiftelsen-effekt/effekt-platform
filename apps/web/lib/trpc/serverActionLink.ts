import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { TRPC_ERROR_CODES_BY_KEY, type TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import type { AppRouter, TrpcClient } from "./client";

type MutationResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; httpStatus: number; message: string } };

/**
 * A tRPC link for Min Side on the App Router: each mutation goes to a Server Action (`run`, which
 * calls the API on the server with the session's token), so components keep their tRPC calls and
 * the browser never holds a token. Queries aren't sent: the pages render their data on the server.
 * A failure becomes a TRPCClientError with `data.code` and `data.httpStatus`, as from the API.
 */
export const serverActionLink =
  <TRouter extends AnyRouter>(
    run: (path: string, input: unknown) => Promise<MutationResult>,
  ): TRPCLink<TRouter> =>
  () =>
  ({ op }) =>
    observable((observer) => {
      const fail = (code: string, httpStatus: number, message: string) =>
        observer.error(
          TRPCClientError.from<AnyRouter>({
            error: {
              code: TRPC_ERROR_CODES_BY_KEY[code as TRPC_ERROR_CODE_KEY] ?? -32603,
              message,
              data: { code, httpStatus, path: op.path },
            },
          }) as TRPCClientError<TRouter>,
        );

      if (op.type !== "mutation") {
        fail("NOT_IMPLEMENTED", 501, `${op.path}: queries are rendered on the server`);
        return;
      }
      run(op.path, op.input).then(
        (result) => {
          if (result.ok) {
            observer.next({ result: { type: "data", data: result.data } } as never);
            observer.complete();
          } else {
            fail(result.error.code, result.error.httpStatus, result.error.message);
          }
        },
        (error: unknown) => fail("INTERNAL_SERVER_ERROR", 500, String(error)),
      );
    });

export const createServerActionTrpcClient = (
  run: (path: string, input: unknown) => Promise<MutationResult>,
): TrpcClient => createTRPCClient<AppRouter>({ links: [serverActionLink<AppRouter>(run)] });
