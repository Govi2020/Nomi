import asyncio
import tempfile
import unittest
import json
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import config, db, insights, ollama_client, organize
from backend import server
from backend.server import app


class DiaryApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_data_dir = config.DATA_DIR
        self.original_db_path = config.DB_PATH
        self.original_audio_dir = config.AUDIO_DIR
        config.DATA_DIR = Path(self.temp_dir.name)
        config.DB_PATH = config.DATA_DIR / "journal.db"
        config.AUDIO_DIR = config.DATA_DIR / "audio"
        config.AUDIO_DIR.mkdir()
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        config.DATA_DIR = self.original_data_dir
        config.DB_PATH = self.original_db_path
        config.AUDIO_DIR = self.original_audio_dir
        self.temp_dir.cleanup()

    def test_entries_list_is_empty_without_saved_entries(self):
        response = self.client.get("/api/entries")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_create_and_update_persists_entry(self):
        async def organize_entry(entry_id):
            return db.get_entry(entry_id)

        async def follow_up(entry_id):
            return ""

        with patch.object(organize, "organize_entry", organize_entry), patch.object(
            insights, "follow_up", follow_up
        ):
            created = self.client.post(
                "/api/entries",
                json={"text": "A real diary moment", "title": "Today", "mood": "Calm", "energy": "Low"},
            )

        self.assertEqual(created.status_code, 200, created.text)
        created_entry = created.json()["entry"]
        entry_id = created_entry["id"]
        self.assertEqual(created_entry["text"], "A real diary moment")
        self.assertEqual(created_entry["mood"], "Calm")
        self.assertEqual(created_entry["energy"], "Low")

        updated = self.client.put(
            f"/api/entries/{entry_id}",
            json={"text": "Updated diary moment", "title": "Today, updated", "mood": "Hopeful", "energy": "High"},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["text"], "Updated diary moment")
        self.assertEqual(updated.json()["mood"], "Hopeful")
        self.assertEqual(updated.json()["energy"], "High")
        self.assertEqual(self.client.get("/api/entries").json()[0]["title"], "Today, updated")

    def test_delete_all_entries_removes_diary_but_keeps_ask_chats(self):
        audio_path = config.AUDIO_DIR / "recording.wav"
        audio_path.write_bytes(b"safe test audio")
        entry_id = db.create_entry("First diary note", "First", audio_path=str(audio_path))
        db.set_entry_tags(entry_id, ["test-tag"])
        db.set_entry_entities(entry_id, [{"name": "Test person", "type": "person"}])
        db.create_entry("Second diary note", "Second")
        chat = self.client.post("/api/ask/chats", json={}).json()

        response = self.client.delete("/api/entries")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"deleted_count": 2})
        self.assertEqual(self.client.get("/api/entries").json(), [])
        self.assertEqual(self.client.get(f"/api/ask/chats/{chat['id']}").status_code, 200)
        self.assertFalse(audio_path.exists())
        with closing(db.connect()) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM tags").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0], 0)
        empty = self.client.delete("/api/entries")
        self.assertEqual(empty.json(), {"deleted_count": 0})

    def test_title_only_entry_is_processed_when_text_is_added(self):
        processed_ids = []

        async def organize_entry(entry_id):
            processed_ids.append(entry_id)
            return db.get_entry(entry_id)

        with patch.object(organize, "organize_entry", organize_entry), patch.object(
            insights, "follow_up"
        ) as follow_up:
            created = self.client.post(
                "/api/entries",
                json={"text": "", "title": "A title before the story"},
            )
            self.assertEqual(created.status_code, 200, created.text)
            entry_id = created.json()["entry"]["id"]
            self.assertEqual(processed_ids, [])
            follow_up.assert_not_called()

            updated = self.client.put(
                f"/api/entries/{entry_id}",
                json={"text": "The story follows.", "title": "A title before the story"},
            )

        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["text"], "The story follows.")
        self.assertEqual(processed_ids, [entry_id])

    def test_ask_chats_keep_separate_persistent_histories(self):
        first = self.client.post("/api/ask/chats", json={})
        second = self.client.post("/api/ask/chats", json={})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        first_id = first.json()["id"]
        second_id = second.json()["id"]

        requests = []

        async def answer_question(question, mode, history):
            requests.append((question, mode, history))
            return {"answer": "A saved reply.", "sources": [{"id": "42", "date": "2026-10-02"}]}

        with patch.object(server.rag, "answer_question", answer_question):
            first_response = self.client.post(
                "/api/chat",
                json={
                    "conversation_id": first_id,
                    "question": "Remember this first thought",
                    "mode": "Recall",
                },
            )
            self.assertEqual(first_response.status_code, 200, first_response.text)
            second_response = self.client.post(
                "/api/chat",
                json={
                    "conversation_id": first_id,
                    "question": "Continue that thought",
                    "mode": "Reflect",
                },
            )

        self.assertEqual(second_response.status_code, 200, second_response.text)
        self.assertEqual(
            [(message.role, message.content) for message in requests[1][2]],
            [
                ("user", "Remember this first thought"),
                ("assistant", "A saved reply."),
            ],
        )

        first_history = self.client.get(f"/api/ask/chats/{first_id}").json()
        second_history = self.client.get(f"/api/ask/chats/{second_id}").json()
        self.assertEqual(len(first_history["turns"]), 2)
        self.assertEqual(first_history["turns"][0]["answer"], "A saved reply.")
        self.assertEqual(first_history["turns"][1]["mode"], "Reflect")
        self.assertEqual(first_history["turns"][0]["sources"][0]["id"], "42")
        self.assertEqual(second_history["turns"], [])
        self.assertEqual(first_history["chat"]["title"], "Remember this first thought")

    def test_ask_ai_reflects_on_leading_emotional_questions_with_cited_entries(self):
        entry_id = db.create_entry(
            "Several last-minute changes at work left me tense and unable to switch off.",
            "A difficult work week",
        )
        captured_messages = []

        async def retrieve(_question):
            return [entry_id], {entry_id: 0.9}

        async def get_tools():
            return []

        async def chat_messages(messages, **_kwargs):
            captured_messages.extend(messages)
            return {
                "content": (
                    "I wonder if the repeated last-minute changes left you feeling pulled "
                    f"in too many directions [E{entry_id}]. Maybe try naming one part you "
                    "can influence today, if that feels useful."
                ),
                "tool_calls": [],
            }

        with patch.object(server.rag, "_retrieve", retrieve), patch.object(
            server.rag.mcp_client, "get_tools", get_tools
        ), patch.object(server.ollama_client, "chat_messages", chat_messages):
            response = asyncio.run(
                server.rag.answer_question("Why do I feel frustrated?", "Recall")
            )

        self.assertIn("I wonder if", response["answer"])
        self.assertEqual([source["id"] for source in response["sources"]], [entry_id])
        system_prompt = captured_messages[0]["content"]
        self.assertIn("personal, reflective question", system_prompt)
        self.assertIn("what the cited moments might suggest", system_prompt)
        self.assertIn("possibility, not a diagnosis or certainty", system_prompt)
        self.assertIn("one small, optional suggestion", system_prompt)
        self.assertNotIn(
            "personal, reflective question",
            server.rag._mode_instructions("Recall", "What did I write yesterday?"),
        )

    def test_ask_chat_can_import_existing_browser_history(self):
        created = self.client.post(
            "/api/ask/chats",
            json={
                "turns": [
                    {
                        "question": "First question",
                        "answer": "First answer",
                        "mode": "Recall",
                        "sources": [{"id": "7", "date": "2026-10-01"}],
                    },
                    {
                        "question": "Second question",
                        "answer": "Second answer",
                        "mode": "Plan",
                    },
                ]
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()["title"], "First question")
        self.assertEqual(created.json()["last_message"], "Second question")

        conversation = self.client.get(
            f"/api/ask/chats/{created.json()['id']}"
        ).json()
        self.assertEqual([turn["question"] for turn in conversation["turns"]], ["First question", "Second question"])
        self.assertEqual(conversation["turns"][0]["sources"][0]["id"], "7")

    def test_insights_are_distilled_from_entries_and_sources_are_validated(self):
        entry_ids = [
            db.create_entry(f"Journal entry evidence {index}", f"Entry {index}")
            for index in range(3)
        ]
        generated = json.dumps(
            {
                "insights": [
                    {
                        "title": "A supported pattern",
                        "summary": "This pattern appears in the supplied entries.",
                        "period": "Across these days",
                        "source_ids": [entry_ids[0], entry_ids[1], entry_ids[2]],
                    },
                    {
                        "title": "Unsupported citation",
                        "summary": "This one cites an entry that does not exist.",
                        "period": "Never",
                        "source_ids": [entry_ids[0], 999999],
                    },
                ]
            }
        )
        requests = []

        async def chat(system, user, json_mode=False, temperature=0.4):
            requests.append((system, user, json_mode))
            return generated

        with patch.object(server.ollama_client, "chat", chat):
            response = self.client.get("/api/insights")

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["entry_count"], 3)
        self.assertEqual([item["title"] for item in result["insights"]], ["A supported pattern"])
        self.assertEqual(
            [source["id"] for source in result["insights"][0]["sources"]],
            [str(entry_id) for entry_id in entry_ids],
        )
        self.assertTrue(requests[0][2])
        self.assertIn("Journal entry evidence 0", requests[0][1])

    def test_timeline_month_and_year_reviews_use_period_entries_and_validate_highlights(self):
        entry_ids = [
            db.create_entry(f"Review entry for {entry_date}", f"Entry {entry_date}")
            for entry_date in ("2026-10-02", "2026-09-28", "2026-01-08")
        ]
        with closing(db.connect()) as conn:
            conn.execute("BEGIN")
            for entry_id, entry_date in zip(entry_ids, ("2026-10-02", "2026-09-28", "2026-01-08")):
                conn.execute(
                    "UPDATE entries SET created_at=? WHERE id=?",
                    (f"{entry_date}T12:00:00.000Z", entry_id),
                )
            conn.commit()

        requests = []

        async def chat(system, user, json_mode=False, temperature=0.4):
            requests.append(user)
            return json.dumps({
                "summary": "A month with a meaningful moment.",
                "themes": ["Connection", "Connection", "", 42],
                "highlight_ids": [entry_ids[0], 999999],
            })

        with patch.object(server.ollama_client, "chat", chat):
            month = self.client.get("/api/timeline/review?period=month&on=2026-10-02")
            year = self.client.get("/api/timeline/review?period=year&on=2026-10-02")

        self.assertEqual(month.status_code, 200, month.text)
        self.assertEqual(year.status_code, 200, year.text)
        self.assertEqual(month.json()["entry_count"], 1)
        self.assertEqual(month.json()["period_label"], "October 2026")
        self.assertEqual(month.json()["themes"], ["Connection"])
        self.assertEqual([item["id"] for item in month.json()["highlights"]], [str(entry_ids[0])])
        self.assertEqual(year.json()["entry_count"], 3)
        self.assertEqual(len(requests), 2)
        self.assertNotIn("Review entry for 2026-09-28", requests[0])
        self.assertIn("Review entry for 2026-09-28", requests[1])

    def test_timeline_review_without_entries_skips_model(self):
        with patch.object(server.ollama_client, "chat") as chat:
            response = self.client.get("/api/timeline/review?period=month&on=2026-10-02")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["entry_count"], 0)
        self.assertEqual(response.json()["highlights"], [])
        chat.assert_not_called()

    def test_talk_stream_keeps_model_warm_and_limits_spoken_response_length(self):
        payloads = []

        class StreamResponse:
            status_code = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return None

            async def aiter_lines(self):
                yield json.dumps({"message": {"content": "Hello."}, "done": False})
                yield json.dumps({"message": {}, "done": True})

        class StreamClient:
            def stream(self, method, path, json):
                payloads.append((method, path, json))
                return StreamResponse()

        async def collect():
            return [
                token
                async for token in ollama_client.stream_chat_messages(
                    [{"role": "user", "content": "Hi"}]
                )
            ]

        with patch.object(ollama_client, "_get_client", return_value=StreamClient()):
            tokens = asyncio.run(collect())

        self.assertEqual(tokens, ["Hello."])
        payload = payloads[0][2]
        self.assertEqual(payload["keep_alive"], "10m")
        self.assertEqual(payload["options"]["num_predict"], 160)

    def test_new_ask_chat_endpoint_creates_selectable_chat(self):
        created = self.client.post("/api/ask/chats", json={})

        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()["title"], "New conversation")
        chat_list = self.client.get("/api/ask/chats")
        self.assertEqual(chat_list.status_code, 200)
        self.assertIn(created.json()["id"], [item["id"] for item in chat_list.json()])


if __name__ == "__main__":
    unittest.main()
