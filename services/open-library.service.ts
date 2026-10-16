import { logger } from "../utils/logger";
import { BookDetails } from "../types/books.types";

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  cover_i?: number;
}

const SEARCH_URL = "https://openlibrary.org/search.json";
const COVER_URL = "https://covers.openlibrary.org/b/id";
const RETRY_DELAY_MS = 1000;

// Open Library asks callers to identify themselves with an app name and
// contact; identified requests get 3 req/sec instead of 1.
const OPENLIBRARY_CONTACT = process.env.OPENLIBRARY_CONTACT;
const USER_AGENT = OPENLIBRARY_CONTACT
  ? `ShelfSnap (${OPENLIBRARY_CONTACT})`
  : "ShelfSnap";

if (!OPENLIBRARY_CONTACT) {
  logger.warn(
    "OPENLIBRARY_CONTACT not set — Open Library requests are limited to 1/sec.",
  );
}

// An ISBN always maps to the same book, and Open Library asks callers to
// cache. Only hits are cached so a book added later can still be found.
const cache = new Map<string, BookDetails[]>();

function parseDoc(doc: OpenLibraryDoc, isbn: string): BookDetails {
  return {
    title: doc.title ?? "Unknown Title",
    author: doc.author_name?.join(", ") ?? null,
    // The doc lists every edition's ISBNs; the one searched for is the match.
    isbn,
    coverUrl: doc.cover_i ? `${COVER_URL}/${doc.cover_i}-M.jpg` : null,
  };
}

/**
 * Returns the normalized ISBN if [query] is an ISBN-10 or ISBN-13 (hyphens,
 * spaces and an "isbn:" prefix allowed), otherwise null.
 */
export function parseIsbn(query: string): string | null {
  const isbn = query
    .trim()
    .replace(/^isbn:/i, "")
    .replace(/[-\s]/g, "")
    .toUpperCase();
  return /^(\d{9}[\dX]|\d{13})$/.test(isbn) ? isbn : null;
}

/**
 * Looks up a book by exact ISBN. Used instead of Google Books, whose "isbn:"
 * filter returns no results for our key. Returns an empty list if not found.
 */
export async function searchByIsbn(isbn: string): Promise<BookDetails[]> {
  const cached = cache.get(isbn);
  if (cached) return cached;

  const url = `${SEARCH_URL}?isbn=${encodeURIComponent(isbn)}&fields=title,author_name,cover_i&limit=1`;
  const headers = { "User-Agent": USER_AGENT };

  let response = await fetch(url, { headers });
  // 429 and 5xx are usually transient; one delayed retry stays within the
  // rate limit.
  if (response.status === 429 || response.status >= 500) {
    logger.warn({ isbn, status: response.status }, "Open Library retry");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetch(url, { headers });
  }

  if (!response.ok) {
    throw new Error(`Open Library API error: ${response.status}`);
  }

  const data = (await response.json()) as { docs?: OpenLibraryDoc[] };
  const books = (data.docs ?? []).map((doc) => parseDoc(doc, isbn));
  if (books.length > 0) cache.set(isbn, books);
  return books;
}
