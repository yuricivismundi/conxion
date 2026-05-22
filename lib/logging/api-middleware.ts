// API request/response middleware for logging

import { NextResponse } from "next/server";
import { createLogger, getCorrelationIdFromRequest } from "./request-logger";

export function withRequestLogging<T extends Record<string, any>>(
  handler: (req: Request, context: T) => Promise<NextResponse>
) {
  return async (req: Request, context: T) => {
    const correlationId = getCorrelationIdFromRequest(req);
    const startTime = Date.now();
    const url = new URL(req.url);
    const endpoint = url.pathname;
    const method = req.method;

    const logger = createLogger({
      correlationId,
      endpoint,
      method,
    });

    try {
      logger.info("Request started", { endpoint, method });

      const response = await handler(req, context);
      const durationMs = Date.now() - startTime;

      logger.info("Request completed", {
        statusCode: response.status,
        durationMs,
      });

      // Add correlation ID to response headers
      response.headers.set("x-correlation-id", correlationId);
      response.headers.set("x-request-id", correlationId);

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error("Request failed", error, {
        durationMs,
        endpoint,
        method,
      });

      // Return error response with correlation ID
      const errorResponse = NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Internal server error",
          correlationId,
        },
        { status: 500 }
      );
      errorResponse.headers.set("x-correlation-id", correlationId);
      return errorResponse;
    }
  };
}

// Hook for logging within handler context
export function createApiLogger(req: Request, endpoint: string) {
  const correlationId = getCorrelationIdFromRequest(req);
  return createLogger({
    correlationId,
    endpoint,
    method: req.method,
  });
}
