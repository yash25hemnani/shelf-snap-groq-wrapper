// llama-3.3-70b-versatile was retired by Groq (model_not_found).
export const MODEL_NAME = 'openai/gpt-oss-120b';

export const MAX_BLOCKS = 200;

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
