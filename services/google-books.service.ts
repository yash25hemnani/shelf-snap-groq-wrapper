import { logger } from "../utils/logger";
import { BookDetails } from "../types/books.types";

interface GoogleBooksItem {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string };
  };
}

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";
const RETRY_DELAY_MS = 1000;

const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;

if (!GOOGLE_BOOKS_API_KEY) {
  logger.error("Missing GOOGLE_BOOKS_API_KEY in .env — refusing to start.");
  process.exit(1);
}

function parseItem(item: GoogleBooksItem): BookDetails {
  const info = item.volumeInfo ?? {};
  const identifiers = info.industryIdentifiers ?? [];
  const isbn =
    identifiers.find((id) => id.type === "ISBN_13")?.identifier ??
    identifiers.find((id) => id.type === "ISBN_10")?.identifier ??
    null;

  return {
    title: info.title ?? "Unknown Title",
    author: info.authors?.join(", ") ?? null,
    isbn,
    // Google serves http:// thumbnails; Android blocks cleartext by default.
    coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? null,
  };
}

/** One Google Books request; transient failures (429 / 5xx) retry once. */
async function querySingle(query: string): Promise<BookDetails[]> {
  const url = `${BASE_URL}?q=${encodeURIComponent(query)}&key=${GOOGLE_BOOKS_API_KEY}`;

  let response = await fetch(url);
  // 429 (rate limited) and 5xx are usually transient; parallel lookups make
  // 429s likely, and retrying keeps a real book from being dropped.
  if (response.status === 429 || response.status >= 500) {
    logger.warn({ query, status: response.status }, "Google Books retry");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetch(url);
  }

  if (!response.ok) {
    // Body is omitted: Google returns a full HTML error page here.
    throw new Error(`Google Books API error: ${response.status}`);
  }

  const data = (await response.json()) as { items?: GoogleBooksItem[] };
  return (data.items ?? []).map(parseItem);
}

/** Single Google Books search for user-typed queries (no retry ladder). */
export async function searchBooksByQuery(
  query: string,
): Promise<BookDetails[]> {
  return querySingle(query);
}

/**
 * Searches Google Books for [query] ("title" or "title author"), using a
 * "retry ladder": if the full query returns nothing, trailing words are
 * dropped one at a time, since the title at the front is the most reliable
 * part. Returns an empty list if no variant returns results.
 */
export async function searchWithRetryLadder(
  query: string,
): Promise<BookDetails[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);

  for (let len = words.length; len >= 1; len--) {
    const results = await querySingle(words.slice(0, len).join(" "));
    if (results.length > 0) return results;
  }

  return [];
}
