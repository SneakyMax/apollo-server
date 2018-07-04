import * as Koa from 'koa';
import * as corsMiddleware from 'kcors';
import * as bodyParser from 'koa-bodyparser';
import * as compose from 'koa-compose';
import {
  renderPlaygroundPage,
  RenderPageOptions as PlaygroundRenderPageOptions,
} from '@apollographql/graphql-playground-html';
import * as accepts from 'accepts';
import * as typeis from 'type-is';

import { graphqlKoa } from './koaApollo';

import { processRequest as processFileUploads } from 'apollo-upload-server';

import { ApolloServerBase, formatApolloErrors } from 'apollo-server-core';
export { GraphQLOptions, GraphQLExtension } from 'apollo-server-core';
import { GraphQLOptions, FileUploadOptions } from 'apollo-server-core';

// koa-bodyparser does not expose an Options interface so we infer the type here.
export type BodyParserOptions = typeof bodyParser extends (opts: infer U) => any
  ? U
  : never;

export interface ServerRegistration {
  app: Koa;
  path?: string;
  cors?: corsMiddleware.Options;
  bodyParserConfig?: BodyParserOptions;
  onHealthCheck?: (req: Koa.Request) => Promise<any>;
  disableHealthCheck?: boolean;
  gui?: boolean;
}

const fileUploadMiddleware = (
  uploadsConfig: FileUploadOptions,
  server: ApolloServerBase,
) => async (ctx: Koa.Context, next: () => Promise<any>) => {
  if (!typeis(ctx.req, ['multipart/form-data'])) {
    return next();
  }

  try {
    const body = await processFileUploads(ctx.req, uploadsConfig);
    ctx.request.body = body;
    return next();
  } catch (error) {
    if (error.status && error.expose) {
      ctx.status = error.status;
    } else {
      const [apolloError] = formatApolloErrors([error], {
        formatter: server.requestOptions.formatError,
        debug: server.requestOptions.debug,
      });
      throw apolloError;
    }
  }
};

const middlewareAtPath = (
  path: string,
  middleware: compose.Middleware<Koa.Context>,
) => (ctx: Koa.Context, next: () => Promise<any>) => {
  if (ctx.path === path) {
    return middleware(ctx, next);
  } else {
    return next();
  }
};

export class ApolloServer extends ApolloServerBase {
  async createGraphQLServerOptions(ctx: Koa.Context): Promise<GraphQLOptions> {
    return super.graphQLServerOptions({ req: ctx.req, res: ctx.res });
  }

  protected supportsSubscriptions(): boolean {
    return true;
  }

  protected supportsUploads(): boolean {
    return true;
  }

  public applyMiddleware({
    app,
    path,
    cors,
    bodyParserConfig,
    disableHealthCheck,
    gui,
    onHealthCheck,
  }: ServerRegistration) {
    if (!path) path = '/graphql';

    if (!disableHealthCheck) {
      // uses same path as engine proxy, but is generally useful.
      app.use(
        middlewareAtPath('/.well-known/apollo/server-health', async ctx => {
          // Response follows https://tools.ietf.org/html/draft-inadarei-api-health-check-01
          ctx.type = 'application/health+json';

          if (onHealthCheck) {
            try {
              await onHealthCheck(ctx.request);
              ctx.body = { status: 'pass' };
            } catch (err) {
              ctx.status = 503;
              ctx.body = { status: 'fail' };
            }
          } else {
            ctx.body = { status: 'pass' };
          }
        }),
      );
    }

    let uploadsMiddleware;
    if (this.uploadsConfig) {
      uploadsMiddleware = fileUploadMiddleware(this.uploadsConfig, this);
    }

    this.graphqlPath = path;

    if (cors === true) {
      app.use(middlewareAtPath(path, corsMiddleware()));
    } else if (cors !== false) {
      app.use(middlewareAtPath(path, corsMiddleware(cors)));
    }

    if (bodyParserConfig === true) {
      app.use(middlewareAtPath(path, bodyParser()));
    } else if (bodyParserConfig !== false) {
      app.use(middlewareAtPath(path, bodyParser(bodyParserConfig)));
    }

    if (uploadsMiddleware) {
      app.use(middlewareAtPath(path, uploadsMiddleware));
    }

    // Note: if you enable a gui in production and expect to be able to see your
    // schema, you'll need to manually specify `introspection: true` in the
    // ApolloServer constructor; by default, the introspection query is only
    // enabled in dev.
    const guiEnabled =
      !!gui || (gui === undefined && process.env.NODE_ENV !== 'production');

    app.use(
      middlewareAtPath(path, async ctx => {
        if (guiEnabled && ctx.method === 'GET') {
          // perform more expensive content-type check only if necessary
          const accept = accepts(ctx.req);
          const types = accept.types() as string[];
          const prefersHTML =
            types.find(
              (x: string) => x === 'text/html' || x === 'application/json',
            ) === 'text/html';

          if (prefersHTML) {
            const playgroundRenderPageOptions: PlaygroundRenderPageOptions = {
              endpoint: path,
              subscriptionEndpoint: this.subscriptionsPath,
              version: this.playgroundVersion,
            };
            ctx.set('Content-Type', 'text/html');
            const playground = renderPlaygroundPage(
              playgroundRenderPageOptions,
            );
            ctx.body = playground;
            return;
          }
        }
        return graphqlKoa(this.createGraphQLServerOptions.bind(this))(ctx);
      }),
    );
  }
}

export const registerServer = () => {
  throw new Error(
    'Please use server.applyMiddleware instead of registerServer. This warning will be removed in the next release',
  );
};
