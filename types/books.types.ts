export interface OcrBlock {
  text: string;
  [key: string]: unknown;
}

export interface IdentifyBooksRequestBody {
  image: string; // base64, no data: prefix
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
  blocks: OcrBlock[];
}

/** A book as identified by the vision model, before lookup. */
export interface Book {
  title: string;
  author: string;
}

/** A Google Books or Open Library listing. */
export interface BookDetails {
  title: string;
  author: string | null;
  isbn: string | null;
  coverUrl: string | null;
}

export interface ScoredBook extends BookDetails {
  score: number; // 0–1 similarity to the identified book
}
