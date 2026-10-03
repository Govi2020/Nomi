# Memory

A dark, calm frontend prototype for a personal memory and journaling companion. Built with React, TypeScript, Vite, Tailwind CSS, and Lucide React.

## Run locally

```sh
npm install
npm run dev
```

Set `VITE_API_BASE_URL` in a local `.env` file when connecting a backend. The example is in `.env.example`. `npm run build` creates a production build.

The diary's “Dig deeper” and “Get perspective” actions call `POST /api/ai/feedback` at that base URL. The request JSON is `{ "action": "dig_deeper" | "get_perspective", "title": "...", "content": "..." }`; the backend should return `{ "feedback": "..." }`.

## Product structure

- `src/App.tsx` composes app state, navigation, and the persistent shell.
- `src/features/` groups each page by feature; diary dictation helpers live beside the diary page.
- `src/components/` contains shared UI components.
- `src/types.ts` holds API-aligned domain types.
- `src/services/` isolates mock data and async operations from the UI. `apiClient.ts` is the centralized REST boundary for a future FastAPI implementation.
- `src/styles.css` contains the shared design system and responsive layouts.

The current prototype uses realistic fictional demo data. Recording requests microphone access after the user presses “Talk about today” and captures audio locally in the browser with `MediaRecorder`; the session recording can be played from its diary entry and is not uploaded. Transcript, memory extraction, and AI responses remain simulated. The app does not provide real authentication, encryption, or broader privacy guarantees, and demo entries remain in in-memory service state for this session.

## Main demo flow

Home → Talk about today → Recording → Processing → Four findings → Diary / Memories → Ask AI with sources → Timeline → Insights.

Secondary destinations (Goals, Experiences, People, Projects, Tasks, and Settings) are modular, lightweight supporting pages.
