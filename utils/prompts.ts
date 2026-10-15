import { IdentifyBooksRequestBody } from "../types/books.types";

// The photo is the primary source; on-device OCR blocks ride along as hints
// since they're cheap and sometimes catch small text the model misreads.
export function buildPrompt({
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
