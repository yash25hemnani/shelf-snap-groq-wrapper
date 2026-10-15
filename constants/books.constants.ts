export const MODEL_NAME = 'llama-3.3-70b-versatile';

export const MAX_BLOCKS = 200;

// llama-3.3-70b-versatile only supports Groq's JSON object mode (no
// json_schema enforcement), so this schema is embedded in the prompt and
// the response is validated against it at runtime.
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
