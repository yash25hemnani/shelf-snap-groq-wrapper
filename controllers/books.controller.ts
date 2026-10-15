import { Request, Response } from "express";
import Groq from "groq-sdk";
import {
  MODEL_NAME,
  RESPONSE_SCHEMA,
  MAX_BLOCKS,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BASE64_LENGTH,
  STRONG_MATCH_THRESHOLD,
} from "../constants/books.constants";
import { logger } from "../utils/logger";
import { searchBooks } from "../services/google-books.service";
import { scoreAndRank } from "../services/match-scoring.service";
import {
  Book,
  IdentifyBooksRequestBody,
  ScoredBook,
} from "../types/books.types";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  logger.error("Missing GROQ_API_KEY in .env — refusing to start.");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });

const SYSTEM_PROMPT = `You identify books from photos of bookshelves.
Respond only with a JSON object matching this JSON Schema:
${JSON.stringify(RESPONSE_SCHEMA)}`;

// The photo is the primary source; on-device OCR blocks ride along as hints
// since they're cheap and sometimes catch small text the model misreads.
function buildPrompt({
  imageWidth,
  imageHeight,
  blocks,
}: Omit<IdentifyBooksRequestBody, "image" | "imageMimeType">): string {
  const hints = blocks.length
    ? `OCR HINTS (bounding boxes in a ${imageWidth}x${imageHeight} coordinate
space; text is often garbled — trust the photo over these):
${JSON.stringify(blocks)}`
    : "No OCR hints were available for this photo.";

  return `The attached photo shows books on a shelf. Identify each book
whose spine or cover you can see.

Spines are usually vertical, so read rotated text. Titles may be split
across lines, and the author or publisher is often printed separately
near the top or bottom of the same spine.

Use your knowledge of real books to correct partially readable text, but
only list a book if you can actually read enough of its spine to be sure.
Never add books that aren't in the photo. Skip spines that are blurry,
cut off, or unreadable rather than guessing. If the author isn't visible
and you're not sure who wrote it, use an empty string.

${hints}`;
}

function isBook(value: unknown): value is Book {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Book).title === "string" &&
    typeof (value as Book).author === "string"
  );
}

export async function identifyBooks(req: Request, res: Response) {
  const { image, imageMimeType, imageWidth, imageHeight } = req.body ?? {};
  const blocks = req.body?.blocks ?? [];

  if (typeof image !== "string" || image.length === 0) {
    return res.status(400).json({ error: "image must be a base64 string" });
  }
  if (image.length > MAX_IMAGE_BASE64_LENGTH) {
    return res.status(413).json({ error: "Image too large" });
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(imageMimeType)) {
    return res.status(400).json({ error: "Unsupported imageMimeType" });
  }
  if (!Array.isArray(blocks)) {
    return res.status(400).json({ error: "blocks must be an array" });
  }
  if (blocks.length > MAX_BLOCKS) {
    return res.status(400).json({ error: "Too many blocks in one request" });
  }

  logger.info(
    {
      blockCount: blocks.length,
      imageKb: Math.round((image.length * 3) / 4 / 1024),
      imageWidth,
      imageHeight,
    },
    "identify-books request received",
  );

  try {
    const groqStart = Date.now();
    const completion = await groq.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildPrompt({ imageWidth, imageHeight, blocks }),
            },
            {
              type: "image_url",
              image_url: { url: `data:${imageMimeType};base64,${image}` },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });
    logger.info(
      { durationMs: Date.now() - groqStart },
      "Groq call completed",
    );

    // JSON object mode guarantees syntactically valid JSON but not that it
    // matches RESPONSE_SCHEMA, so we still guard the parse and the shape.
    const responseText = completion.choices[0]?.message?.content ?? "";
    let parsed: { books?: unknown };
    try {
      parsed = JSON.parse(responseText);
    } catch (err) {
      logger.error(
        { responseText },
        "Failed to parse Groq response as JSON",
      );
      return res.status(502).json({ error: "Groq returned malformed JSON" });
    }

    if (!Array.isArray(parsed?.books)) {
      logger.error({ parsed }, "Groq response had no books array");
      return res
        .status(502)
        .json({ error: "Groq response had no books array" });
    }

    const identified: Book[] = parsed.books
      .filter(isBook)
      .filter((b) => b.title.trim().length > 0);
    if (identified.length !== parsed.books.length) {
      logger.warn(
        { dropped: parsed.books.length - identified.length },
        "Dropped malformed book entries from Groq response",
      );
    }

    // Lookups run in parallel; a failed one only drops that book.
    const lookupStart = Date.now();
    const matches = await Promise.all(identified.map(lookUpBook));
    const books = dedupeByTitle(
      matches.filter((m): m is ScoredBook => m !== null),
    );
    logger.info(
      { durationMs: Date.now() - lookupStart },
      "Google Books lookups completed",
    );

    logger.info(
      { identifiedCount: identified.length, bookCount: books.length },
      "identifyBooks succeeded",
    );
    res.json({ books });
  } catch (err) {
    logger.error({ err }, "Groq call failed");
    res.status(502).json({ error: "Failed to reach Groq API" });
  }
}

/**
 * Finds the best Google Books listing for an identified book. Returns null
 * (and logs why) if the lookup fails, finds nothing, or the best match is
 * too weak to trust.
 */
async function lookUpBook({ title, author }: Book): Promise<ScoredBook | null> {
  const query = author ? `${title} ${author}` : title;

  let candidates;
  try {
    candidates = await searchBooks(query);
  } catch (err) {
    logger.warn({ query, err }, "Google Books lookup failed");
    return null;
  }

  const [topMatch] = scoreAndRank(title, author, candidates);
  if (!topMatch) {
    logger.info({ query }, "No Google Books match");
    return null;
  }
  if (topMatch.score < STRONG_MATCH_THRESHOLD) {
    logger.info(
      {
        query,
        matchTitle: topMatch.title,
        matchAuthor: topMatch.author,
        score: Number(topMatch.score.toFixed(2)),
      },
      "Rejected weak match",
    );
    return null;
  }
  return topMatch;
}

/** Two spines can resolve to the same listing; keep the higher score. */
function dedupeByTitle(books: ScoredBook[]): ScoredBook[] {
  const byTitle = new Map<string, ScoredBook>();
  for (const book of books) {
    const key = book.title.toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || book.score > existing.score) byTitle.set(key, book);
  }
  return [...byTitle.values()];
}

export function getHealth(req: Request, res: Response) {
  res.json({ status: "ok" });
}
