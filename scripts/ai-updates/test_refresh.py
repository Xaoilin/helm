import json
from pathlib import Path
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import refresh


NOW = datetime(2026, 11, 17, 19, tzinfo=timezone.utc)
PUBLISHER = "https://example.com/news.xml"
RSS = b"""<rss version="2.0"><channel><item>
  <title>Introducing GPT-6.2 Astra and Sol</title>
  <link>https://openai.com/index/gpt-6-2</link>
  <description><![CDATA[New models for <b>everyday work</b>.
    <a href="https://twitter.com/OpenAI/status/123">Announcement</a>]]></description>
  <pubDate>Tue, 17 Nov 2026 17:45:00 GMT</pubDate>
</item></channel></rss>"""


class RefreshTest(unittest.TestCase):
    def test_confirmed_launch_outranks_and_folds_duplicate_discussions(self):
        announcement = refresh.feed_candidates(("OpenAI", PUBLISHER, "news"), NOW - refresh.MAX_AGE, lambda _: RSS)[0]
        duplicate = refresh.Candidate(
            "GPT-6.2 Astra and GPT-6.2 Sol in Work and Codex", "Availability notes",
            NOW - timedelta(hours=19), "models", "Codex", "https://developers.openai.com/codex/changelog/#gpt62",
        )
        reddit = refresh.Candidate(
            "GPT-6.2 Astra and Sol released", "Community discussion",
            NOW - timedelta(minutes=2), "models", "Hacker News",
            "https://www.reddit.com/r/codex/comments/abc/launch/", official=False, points=250,
        )
        popular_research = refresh.Candidate(
            "Research on training small LLMs", "120 comments on Hacker News.",
            NOW - timedelta(minutes=1), "research", "Hacker News", "https://example.com/research",
            official=False, points=290,
        )
        stories = refresh.ordered_stories([announcement, duplicate, reddit, popular_research], {}, NOW)
        self.assertEqual([announcement.title, popular_research.title], [story["title"] for story in stories])
        self.assertEqual("New models for everyday work. Announcement", stories[0]["summary"])
        self.assertTrue(stories[0]["featured"])
        self.assertEqual(
            ["https://x.com/OpenAI/status/123", "https://www.reddit.com/r/codex/comments/abc/"],
            [link["url"] for link in stories[0]["discussions"]],
        )

    def test_partial_failure_preserves_recent_stories_and_rejects_expired_ones(self):
        recent = refresh.Candidate(
            "Claude Code v2.1.326", "A coding update", NOW - timedelta(days=1),
            "coding", "Claude Code", "https://github.com/anthropics/claude-code/releases/tag/2.1.326",
        )
        expired = refresh.Candidate(
            "Claude Code v2.1.280", "An old update", NOW - timedelta(days=20),
            "coding", "Claude Code", "https://github.com/anthropics/claude-code/releases/tag/2.1.280",
        )

        def get(url):
            if url == PUBLISHER:
                return RSS
            raise OSError("unavailable")

        with patch.object(refresh, "FEEDS", (("OpenAI", PUBLISHER, "news"),)):
            snapshot = refresh.build_snapshot(
                NOW, {"stories": [recent.story(False), expired.story(False)]}, {}, get, lambda _: None,
            )
        self.assertEqual(["OpenAI", "Claude Code"], [item["source"]["label"] for item in snapshot["stories"]])

    def test_total_publisher_failure_is_a_failed_refresh(self):
        def get(_):
            raise OSError("unavailable")

        with self.assertRaisesRegex(RuntimeError, "Keeping the previous briefing"):
            refresh.build_snapshot(NOW, {"stories": []}, {}, get, lambda _: None)

    def test_invalid_entry_date_does_not_hide_valid_release(self):
        first = RSS.decode().split("<item>", maxsplit=1)[1].split("</item>", maxsplit=1)[0]
        malformed = first.replace("Tue, 17 Nov 2026 17:45:00 GMT", "not a date")
        payload = RSS.decode().replace("<item>", f"<item>{malformed}</item><item>", 1)
        candidates = refresh.feed_candidates(("OpenAI", PUBLISHER, "news"), NOW, lambda _: payload.encode())
        self.assertEqual([], candidates)
        candidates = refresh.feed_candidates(
            ("OpenAI", PUBLISHER, "news"), NOW - timedelta(days=1), lambda _: payload.encode(),
        )
        self.assertEqual(1, len(candidates))
        self.assertEqual("Introducing GPT-6.2 Astra and Sol", candidates[0].title)

    def test_bundled_snapshot_satisfies_public_contract(self):
        seed_path = Path(__file__).resolve().parents[2] / "public" / "ai-updates.json"
        snapshot = json.loads(seed_path.read_text())
        self.assertRegex(snapshot["updatedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        stories = snapshot["stories"]
        self.assertTrue(0 < len(stories) <= 30)
        self.assertEqual(len(stories), len({story["id"] for story in stories}))
        for story in stories:
            with self.subTest(title=story["title"]):
                self.assertTrue(0 < len(story["title"]) <= 240)
                self.assertTrue(0 < len(story["summary"]) <= 650)
                self.assertIsInstance(story["featured"], bool)
                self.assertIn(story["category"], {"coding", "models", "research"})
                self.assertRegex(story["publishedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
                self.assertLessEqual(len(story["discussions"]), 2)
                for link in [story["source"], *story["discussions"]]:
                    self.assertTrue(0 < len(link["label"]) <= 80)
                    self.assertTrue(refresh.clean_url(link["url"]))

    def test_hosts_and_href_formats_are_validated(self):
        self.assertIsNone(refresh.discussion_url("https://x.com.evil.example/OpenAI/status/123"))
        self.assertIsNone(refresh.discussion_url("javascript:alert(1)"))
        self.assertIsNone(refresh.discussion_url("https://x.com/OpenAI"))
        self.assertEqual(
            "https://x.com/OpenAI/status/123",
            refresh.discussion_url("https://twitter.com/OpenAI/status/123?ref=publisher")["url"],
        )


if __name__ == "__main__":
    unittest.main()
