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

export interface Book {
  title: string;
  author: string;
}
