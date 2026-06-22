import { NextResponse } from "next/server";
import type { ApiResponse, ApiError } from "@/types/api";

export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T): NextResponse<ApiResponse<T>> {
  return ok(data, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(error: string, details?: Record<string, string[]>): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error, details }, { status: 400 });
}

export function unauthorized(error = "Unauthorized"): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 401 });
}

export function forbidden(error = "Forbidden"): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 403 });
}

export function notFound(error = "Not found"): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 404 });
}

export function conflict(error: string): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 409 });
}

export function serverError(error: string): NextResponse<ApiError> {
  return NextResponse.json({ success: false, error }, { status: 500 });
}

export function fromError(e: unknown): NextResponse<ApiError> {
  if (e instanceof Error) {
    if (e.message === "Unauthorized") return unauthorized();
    if (e.message === "Forbidden") return forbidden();
    if (e.message === "Not found") return notFound();
    console.error("[api]", e);
    return serverError(e.message);
  }
  console.error("[api]", e);
  return serverError("Internal server error");
}
