/**
 * Minimal HTTP router for API Gateway (HTTP API v2 payloads).
 * Every route receives a resolved Caller unless marked public.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { ApiError, type Caller } from './types.js';
import { resolveCaller } from './auth.js';

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  caller: Caller | null;
  raw: APIGatewayProxyEventV2;
}

export type Handler = (req: Req) => Promise<unknown>;
export interface Route {
  method: string;
  /** Path with :params, e.g. /api/companies/:companyId/employees/:id */
  path: string;
  handler: Handler;
  public?: boolean;
  /**
   * Allow Cognito-authenticated callers that have no users-table row yet
   * (role resolves to 'unprovisioned' — gates still deny everything else).
   * Used by the sign-up bootstrap routes only.
   */
  bootstrap?: boolean;
}

function matchRoute(routePath: string, actualPath: string): Record<string, string> | null {
  const rp = routePath.split('/').filter(Boolean);
  const ap = actualPath.split('/').filter(Boolean);
  if (rp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < rp.length; i++) {
    if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(ap[i]);
    else if (rp[i] !== ap[i]) return null;
  }
  return params;
}

const json = (status: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode: status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type,x-api-key',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  },
  body: JSON.stringify(body),
});

export function makeRouter(routes: Route[]) {
  return async (event: APIGatewayProxyEventV2, _ctx: Context): Promise<APIGatewayProxyResultV2> => {
    const method = event.requestContext.http.method.toUpperCase();
    const path = event.rawPath;

    if (method === 'OPTIONS') return json(204, '');

    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchRoute(route.path, path);
      if (!params) continue;

      try {
        const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : {};
        const query = Object.fromEntries(
          Object.entries(event.queryStringParameters ?? {}).map(([k, v]) => [k, String(v ?? '')]),
        );
        const ip = event.requestContext.http.sourceIp ?? '';
        const userAgent = String(event.headers?.['user-agent'] ?? '');

        let caller: Caller | null = null;
        if (!route.public) {
          caller = await resolveCaller(event.headers?.authorization ?? event.headers?.Authorization, ip, userAgent, {
            soft: route.bootstrap,
          });
        }

        const result = await route.handler({ method, path, params, query, body, caller, raw: event });
        return json(200, result ?? { success: true });
      } catch (err) {
        if (err instanceof ApiError) {
          return json(err.httpStatus, { error: { code: err.code, message: err.message } });
        }
        console.error(`[${method} ${path}]`, err);
        return json(500, { error: { code: 'internal', message: (err as Error).message ?? 'Internal error' } });
      }
    }

    return json(404, { error: { code: 'not-found', message: `No route ${method} ${path}` } });
  };
}

/** Require a non-null caller (routes marked public may not have one). */
export function must(req: Req): Caller {
  if (!req.caller) throw new ApiError('unauthenticated', 'Authentication required');
  return req.caller;
}
