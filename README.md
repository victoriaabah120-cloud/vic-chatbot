# Vic Chatbot

Vic Chatbot is an AI chatbot application.

## Goal

The goal of Vic Chatbot is to build an AI assistant that classmates can use to ask questions and receive AI-powered answers.

## Planned Features

- AI conversations
- Chat history
- Multiple conversations
- File uploads
- Document question answering
- Web interface
- User accounts
- Online deployment

## Generated images

Images created with **Create Image** are stored permanently, not just drawn on
the screen.

- **Storage:** the PNG is uploaded to the private Supabase Storage bucket
  `chat-images` at `<user id>/<conversation id>/<random>.png`. The bucket is
  created automatically the first time an image is generated (the service role
  key does this), so no SQL migration is required.
- **Database:** a normal row in the existing `messages` table records the image.
  Its `content` is a marker plus JSON:
  `[[vic-image]]{"path":"...","prompt":"..."}`. Nothing else in the schema
  changed, and older conversations are untouched.
- **Loading history:** `GET /conversation/{id}/messages` checks the conversation
  belongs to the caller, then turns each marker row into
  `{role, content, image: {url, prompt, available}}` with a freshly signed URL,
  so the picture still appears after logout, refresh, or on another device.
  If the file is gone, `available` is `false` and the UI says the image is no
  longer available.
- **Model history:** marker rows are skipped in the history sent to the language
  model.
- **Health check:** `GET /image/status` (with a bearer token) reports whether the
  bucket is ready. If an image cannot be saved, generation still succeeds and the
  UI shows a short warning.
