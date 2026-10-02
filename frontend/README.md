# Memory

A dark, calm frontend prototype for a personal memory and journaling companion. Built with React, TypeScript, Vite, Tailwind CSS, and Lucide React.

## Run locally

```sh
npm install
npm run dev
```

Set `VITE_API_BASE_URL` in a local `.env` file when connecting a backend. The example is in `.env.example`. `npm run build` creates a production build.

The diary loads entries from `GET /api/entries`, creates them with `POST /api/entries`, and saves edits with `PUT /api/entries/{id}`. Ask AI stores separate conversations and their question/answer history in the backend's SQLite database (`GET/POST /api/ask/chats`, `GET /api/ask/chats/{id}`, and `POST /api/chat`). Set `VITE_API_BASE_URL` to the backend URL when it is hosted separately. The diary's “Dig deeper” and “Get perspective” actions call `POST /api/ai/feedback` at that base URL. The request JSON is `{ "action": "dig_deeper" | "get_perspective", "title": "...", "content": "..." }`; the backend should return `{ "feedback": "..." }`.

## Product structure

- `src/App.tsx` composes app state, navigation, and the persistent shell.
- `src/features/` groups each page by feature; diary dictation helpers live beside the diary page.
- `src/components/` contains shared UI components.
- `src/types.ts` holds API-aligned domain types.
- `src/services/` isolates mock data and async operations from the UI. Diary entries use the FastAPI REST API; other prototype data remains local mock data.
- `src/styles.css` contains the shared design system and responsive layouts.

The current prototype uses realistic fictional demo data for memories, timelines, and other unconnected views. Diary text entries and Ask AI conversations are read from and saved to the backend. Talk-to-Me speech is transcribed locally in the browser, and its recent conversation stays in the current tab. Recording on the separate “Talk about today” flow captures audio locally with `MediaRecorder`; that session recording can be played from its diary entry and is not uploaded. The app does not provide real authentication, encryption, or broader privacy guarantees.

## Main demo flow

Home → Talk about today → Recording → Processing → Four findings → Diary / Memories → Ask AI with sources → Timeline → Insights.

Secondary destinations (Goals, Experiences, People, Projects, Tasks, and Settings) are modular, lightweight supporting pages.
