// Vision model: reads spines directly from the photo, with OCR blocks as hints.
export const MODEL_NAME = 'qwen/qwen3.8-27b';

export const MAX_BLOCKS = 200;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Base64 length cap (~3 MB of image data); keeps us under Vercel's 4.5 MB
// request body limit.
export const MAX_IMAGE_BASE64_LENGTH = 4 * 1024 * 1024;

// We use Groq's JSON object mode, so this schema is embedded in the prompt
// and the response is validated against it at runtime.
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
        },
        required: ['title', 'author'],
      },
    },
  },
  required: ['books'],
};
