// Structured request logging with correlation IDs

import { randomUUID } from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  correlationId: string;
  requestId: string;
  timestamp: string;
  userId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
}

class Logger {
  private context: LogContext;

  constructor(context: Partial<LogContext> = {}) {
    const correlationId = context.correlationId || randomUUID();
    const requestId = context.requestId || randomUUID();
    this.context = {
      correlationId,
      requestId,
      timestamp: new Date().toISOString(),
      ...context,
    };
  }

  private formatLog(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    return JSON.stringify({
      level,
      message,
      ...this.context,
      ...(data && { data }),
    });
  }

  debug(message: string, data?: Record<string, unknown>) {
    if (process.env.NODE_ENV === "development") {
      console.debug(this.formatLog("debug", message, data));
    }
  }

  info(message: string, data?: Record<string, unknown>) {
    console.info(this.formatLog("info", message, data));
  }

  warn(message: string, data?: Record<string, unknown>) {
    console.warn(this.formatLog("warn", message, data));
  }

  error(message: string, error?: Error | unknown, data?: Record<string, unknown>) {
    const errorData = {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...data,
    };
    console.error(this.formatLog("error", message, errorData));
  }

  getContext(): LogContext {
    return { ...this.context };
  }
}

export function createLogger(context: Partial<LogContext> = {}): Logger {
  return new Logger(context);
}

export function getCorrelationIdFromRequest(req: Request): string {
  const header = req.headers.get("x-correlation-id") || req.headers.get("x-request-id");
  return header || randomUUID();
}
