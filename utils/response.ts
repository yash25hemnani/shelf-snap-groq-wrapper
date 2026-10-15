import { Response } from "express";

// Every endpoint responds with one of two shapes so the client can parse
// them generically: { data: ... } on success, { error: { message } } on
// failure. The HTTP status code stays the source of truth for the outcome.

export function sendSuccess<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}

export function sendError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: { message } });
}
