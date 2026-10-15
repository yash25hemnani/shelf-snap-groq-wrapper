import { Request, Response } from "express";
import Groq from "groq-sdk";
import {
  MODEL_NAME,
  RESPONSE_SCHEMA,
  MAX_BLOCKS,
} from "../constants/books.constants";
import { logger } from "../utils/logger";
import { Book, IdentifyBooksRequestBody } from "../types/books.types";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  logger.error("Missing GROQ_API_KEY in .env — refusing to start.");
  process.exit(1);
}

const groq = new Groq({ apiKey: GROQ_API_KEY });

const SYSTEM_PROMPT = `You identify books from bookshelf OCR data. Respond
only with a JSON object matching this JSON Schema:
${JSON.stringify(RESPONSE_SCHEMA)}`;

// Spatial reasoning (bounding boxes) is passed as raw JSON rather than
// pre-grouped on our end, since the LLM is better at fuzzy-matching garbled
// OCR text to real titles/authors than a geometric clustering heuristic.
function buildPrompt({
  imageWidth,
  imageHeight,
  blocks,
}: IdentifyBooksRequestBody): string {
  return `You're given OCR text blocks from a photo of a bookshelf. Each
block has raw (often garbled) text and a bounding box in pixel
coordinates, within an image of size ${imageWidth}x${imageHeight}.

Books stand vertically, so one book's title may be split across multiple
blocks, and a short author/imprint line is often printed horizontally
near the bottom of the same spine — use spatial proximity (overlapping or
adjacent x-ranges) to decide which blocks belong to the same physical
book.

OCR is frequently garbled (misread letters, merged words, missing
spaces). Use your knowledge of real book titles and authors to infer the
most likely intended title and author for each group, even if the raw
text doesn't exactly match.

If you can't confidently identify a group, omit it rather than guessing.

DATA:
${JSON.stringify({ imageWidth, imageHeight, blocks })}`;
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
  const { imageWidth, imageHeight, blocks } = req.body ?? {};

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return res.status(400).json({ error: "blocks must be a non-empty array" });
  }
  if (blocks.length > MAX_BLOCKS) {
    return res.status(400).json({ error: "Too many blocks in one request" });
  }

  logger.info(
    { blockCount: blocks.length, imageWidth, imageHeight },
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
          content: buildPrompt({
            imageWidth,
            imageHeight,
            blocks,
          } as Required<IdentifyBooksRequestBody>),
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

    const books: Book[] = parsed.books.filter(isBook);
    if (books.length !== parsed.books.length) {
      logger.warn(
        { dropped: parsed.books.length - books.length },
        "Dropped malformed book entries from Groq response",
      );
    }

    logger.info({ bookCount: books.length }, "identifyBooks succeeded");
    res.json({ books });
  } catch (err) {
    logger.error({ err }, "Groq call failed");
    res.status(502).json({ error: "Failed to reach Groq API" });
  }
}

export function getHealth(req: Request, res: Response) {
  res.json({ status: "ok" });
}
