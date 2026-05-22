import { NextResponse } from "next/server";

// Standard API response types and helpers

export type ApiResponse<T = unknown> = {
  ok: boolean;
  error?: string;
  data?: T;
};

export type ApiErrorResponse = {
  ok: false;
  error: string;
};

export type ApiSuccessResponse<T = unknown> = {
  ok: true;
  data?: T;
};

export function jsonSuccess<T>(data?: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(error: string, status = 400): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ ok: false, error }, { status });
}

export function jsonResponse<T>(ok: boolean, data: T | undefined, error: string | undefined, status = 200): NextResponse {
  if (ok) {
    return NextResponse.json({ ok: true, data }, { status });
  }
  return NextResponse.json({ ok: false, error }, { status });
}

export function getStatusFromError(message: string): number {
  const lower = String(message).toLowerCase();
  if (lower.includes("not_authenticated") || lower.includes("invalid auth")) return 401;
  if (lower.includes("not_authorized") || lower.includes("permission")) return 403;
  if (lower.includes("not found") || lower.includes("does not exist")) return 404;
  if (lower.includes("duplicate") || lower.includes("unique")) return 409;
  if (lower.includes("invalid") || lower.includes("bad request")) return 400;
  return 500;
}

export function formatErrorMessage(error: unknown, defaultMsg = "An error occurred"): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.message === "string") return err.message;
    if (typeof err.error === "string") return err.error;
  }
  return defaultMsg;
}
