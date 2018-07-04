import * as Koa from 'koa';
import {
  GraphQLOptions,
  HttpQueryError,
  runHttpQuery,
  convertNodeHttpToRequest,
} from 'apollo-server-core';

export interface KoaGraphQLOptionsFunction {
  (ctx?: Koa.Context): GraphQLOptions | Promise<GraphQLOptions>;
}

// Design principles:
// - there is just one way allowed: POST request with JSON body. Nothing else.
// - simple, fast and secure
//

export interface KoaHandler {
  (ctx: Koa.Context): Promise<any>;
}

export function graphqlKoa(
  options: GraphQLOptions | KoaGraphQLOptionsFunction,
): KoaHandler {
  if (!options) {
    throw new Error('Apollo Server requires options.');
  }

  if (arguments.length > 1) {
    // TODO: test this
    throw new Error(
      `Apollo Server expects exactly one argument, got ${arguments.length}`,
    );
  }

  const graphqlHandler = async (ctx: Koa.Context): Promise<any> => {
    try {
      const { graphqlResponse, responseInit } = await runHttpQuery(
        [ctx.req, ctx.res],
        {
          method: ctx.method,
          options: options,
          query: ctx.method === 'POST' ? ctx.request.body : ctx.request.query,
          request: convertNodeHttpToRequest(ctx.req),
        },
      );

      Object.keys(responseInit.headers).forEach(key =>
        ctx.set(key, responseInit.headers[key]),
      );

      ctx.body = graphqlResponse;
    } catch (err) {
      const error: HttpQueryError = err;

      if ('HttpQueryError' !== error.name) {
        throw error;
      }

      if (error.headers) {
        Object.keys(error.headers).forEach(header => {
          ctx.set(header, error.headers[header]);
        });
      }

      ctx.status = error.statusCode;
      ctx.body = error.message;
    }
  };

  return graphqlHandler;
}
