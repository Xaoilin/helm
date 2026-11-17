"""Build Sabah One's public AI briefing from primary feeds and Hacker News."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from functools import partial
import gzip
import hashlib
from html.parser import HTMLParser
from http.client import HTTPException
import io
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

MAX_AGE = timedelta(days=14)
FEATURE_AGE = timedelta(days=3)
MAX_STORIES = 30
MAX_BYTES = 8_000_000
MAX_DISCUSSIONS = 2
MAX_DISCUSSION_PREVIEW = 240
ENGAGEMENT_FIELDS = ("points", "comments", "observedAt")

# Only these endpoints (and recent dated DeepSeek announcements) are fetched.
FEEDS = (
    ("OpenAI", "https://openai.com/news/rss.xml?lang=en", "news"),
    ("Codex", "https://learn.chatgpt.com/docs/changelog/rss.xml", "codex"),
    ("Claude Platform", "https://platform.claude.com/docs/en/release-notes/feed.xml", "claude"),
    ("Claude Code", "https://github.com/anthropics/claude-code/releases.atom", "coding"),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml", "news"),
    ("Google Gemini", "https://blog.google/products-and-platforms/products/gemini/rss/", "news"),
    ("Hugging Face", "https://huggingface.co/blog/feed.xml", "community"),
)
DEEPSEEK_SITEMAP = "https://api-docs.deepseek.com/sitemap.xml"
HN_SEARCH = "https://hn.algolia.com/api/v1/search"
CURATED_PATH = Path(__file__).with_name("curated.json")

CODING = re.compile(
    r"\b(?:codex|claude code|coding agent|coding tool|copilot|cursor|gemini cli|opencode|"
    r"open[- ]?hands|windsurf|developer tool|agentic coding)\b", re.I
)
MODELS = re.compile(
    r"\b(?:gpt[- ]?\d|claude|gemini|deepseek|qwen|mistral|llama|grok|kimi|glm[- ]?\d|"
    r"gemma|open[- ]weight|open model|language model|reasoning model|foundation model|"
    r"model release|new models?|model family|model weights|model pricing)\b", re.I
)
RESEARCH = re.compile(
    r"\b(?:benchmark|evaluations?|research|inference|fine[- ]tun\w*|machine learning|"
    r"neural network|arxiv|language models?|llms?|model training)\b", re.I
)
IMPACT = re.compile(
    r"\b(?:introducing|announcing|launch(?:es|ed)?|releas(?:e[sd]?|ing)|now available|"
    r"general(?:ly)? availab(?:le|ility)|open[- ]weight|new models?|new model family|"
    r"pricing|price cut|usage limits?)\b", re.I
)
SOCIAL_HOSTS = {"reddit.com", "x.com", "twitter.com"}
MODEL_VERSION = re.compile(
    r"\b(gpt|gemini|claude|deepseek|qwen|mistral|gemma|glm)\s*[- ]?\s*"
    r"(?:(astra|sol|opus|sonnet|haiku|fable|carbon|hydrogen|helium)[- ]+)?"
    r"(v?\d+(?:\.\d+)*)(?![\w.])", re.I
)


class PageText(HTMLParser):
    """Keep text and link targets only, without copying source markup."""

    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.links = []
        self.description = ""
        self.title = ""
        self.feed(markup)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in {"p", "br", "li", "h1", "h2", "h3", "div"}:
            self.parts.append(" ")
        if tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"])
        if tag == "meta" and attributes.get("name") == "description":
            self.description = attributes.get("content", "")
        if tag == "meta" and attributes.get("property") == "og:title":
            self.title = attributes.get("content", "")

    def handle_endtag(self, tag):
        if tag in {"p", "li", "h1", "h2", "h3", "div"}:
            self.parts.append(" ")

    def handle_data(self, data):
        self.parts.append(data)

    @property
    def text(self):
        return " ".join("".join(self.parts).split())


@dataclass
class Candidate:
    title: str
    summary: str
    date: datetime
    category: str
    label: str
    url: str
    official: bool = True
    impact: bool = False
    points: int = 0
    discussions: list = field(default_factory=list)

    def story(self, featured):
        return {
            "id": hashlib.sha256(canonical_url(self.url).encode()).hexdigest()[:20],
            "title": self.title[:240],
            "summary": self.summary[:650],
            "publishedAt": iso_date(self.date),
            "category": self.category,
            "source": {"label": self.label, "url": self.url},
            "discussions": self.discussions[:MAX_DISCUSSIONS],
            "featured": featured,
        }


def fetch(url):
    request = Request(url, headers={"User-Agent": "HELM AI Updates/1.0", "Accept-Encoding": "identity"})
    with urlopen(request, timeout=12) as response:
        data = response.read(MAX_BYTES + 1)
    if data.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as decoded:
            data = decoded.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("source response exceeds size limit")
    return data


def read_date(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parsed = parsedate_to_datetime(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def optional_date(value):
    try:
        return read_date(value)
    except (AttributeError, TypeError, ValueError):
        return None


def iso_date(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def clean_url(value):
    if not isinstance(value, str) or len(value) > 700 or re.search(r"[\s\\]", value):
        return ""
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port:
            return ""
    except ValueError:
        return ""
    return parsed.geturl()


def canonical_url(value):
    parsed = urlsplit(value)
    hostname = parsed.hostname.removeprefix("www.")
    query = parsed.query if hostname in {"news.ycombinator.com", "youtube.com", "youtu.be"} else ""
    return urlunsplit(("https", hostname, parsed.path.rstrip("/"), query, parsed.fragment))


def discussion_url(url):
    url = clean_url(url)
    if not url:
        return None
    parsed = urlsplit(url)
    hostname = parsed.hostname.removeprefix("www.")
    if hostname == "reddit.com" and (subreddit := re.match(r"/r/([\w]+)/comments/([a-z0-9]+)", parsed.path, re.I)):
        return {
            "label": f"Reddit · r/{subreddit[1]}",
            "url": f"https://www.reddit.com/r/{subreddit[1]}/comments/{subreddit[2]}/",
        }
    if hostname in {"x.com", "twitter.com"} and (post := re.fullmatch(r"/([\w]+)/status/(\d+)/?", parsed.path)):
        return {"label": f"X · @{post[1]}", "url": f"https://x.com/{post[1]}/status/{post[2]}"}
    return None


def summary_text(text, label):
    if not text:
        return f"Details in the {label} release notes."
    words = text.split()
    return text if len(words) <= 22 else f"{' '.join(words[:22]).rstrip(',;:')}…"


def category_for(title, text=""):
    model_launch = IMPACT.search(title) or MODEL_VERSION.search(title) and "in Work and Codex" in title
    if MODELS.search(title) and model_launch:
        return "models"
    if CODING.search(title):
        return "coding"
    if MODELS.search(title):
        return "models"
    if RESEARCH.search(title):
        return "research"
    # Some publisher release feeds use generic date-based titles.
    if CODING.search(text):
        return "coding"
    if MODELS.search(text):
        return "models"
    if RESEARCH.search(text):
        return "research"
    return None


def feed_entries(data):
    root = ET.fromstring(data)
    if root.tag == "rss":
        entries = root.findall("./channel/item")
        for entry in entries[:70]:
            yield (
                entry.findtext("title", ""), entry.findtext("link", ""),
                entry.findtext("pubDate", ""),
                entry.findtext("description", ""),
                entry.findtext("{http://purl.org/rss/1.0/modules/content/}encoded", ""),
            )
    elif root.tag.endswith("}feed"):
        entries = root.findall("{*}entry")
        for entry in entries[:70]:
            link = entry.find("{*}link")
            yield (
                entry.findtext("{*}title", ""), link.get("href", "") if link is not None else "",
                entry.findtext("{*}updated", ""),
                entry.findtext("{*}summary", ""), entry.findtext("{*}content", ""),
            )
    else:
        raise ValueError("expected RSS or Atom")
    if not entries:
        raise ValueError("RSS or Atom feed has no entries")


def feed_candidates(feed, cutoff, get=fetch):
    label, endpoint, mode = feed
    candidates = []
    for title, url, raw_date, description, content in feed_entries(get(endpoint)):
        url = clean_url(url)
        if not url or not title.strip() or not raw_date:
            continue
        date = optional_date(raw_date)
        if date is None or date < cutoff:
            continue
        title = PageText(title).text
        if not title:
            continue
        page = PageText(description or content)
        if mode == "codex" and "codex" not in title.lower():
            continue
        if mode == "codex" and content:
            # The Codex RSS descriptions are usually just the release number.
            content = re.sub(r"(?m)^#+ [^\n]+\n", "", content)
            page = PageText(content)
        if mode == "claude" and title.startswith("Claude Platform release notes"):
            subject = urlsplit(url).fragment.replace("-", " ")
            subject = re.sub(r"(?<=\d) (?=\d)", ".", subject)
            for word in ("claude", "opus", "sonnet", "haiku", "fable", "mythos"):
                subject = re.sub(rf"\b{word}\b", word.title(), subject)
            if subject:
                title = f"Claude Platform: {subject[0].upper()}{subject[1:]}"
        if mode == "coding":
            if re.search(r"(?:pre-release|-alpha|-beta|-rc)", title, re.I):
                continue
            if title[0].lower() == "v" and title[1:2].isdigit():
                title = f"{label} {title}"
        text = page.text
        text = re.sub(r"^(?:New Features|What.s changed|Performance improvements and bug fixes)\s+", "", text, flags=re.I)
        text = text.lstrip("- ")
        category = category_for(title, text if mode in {"coding", "claude", "codex"} else "")
        if mode == "claude" and re.search(r"billing|managed agents", title, re.I):
            category = "coding"
        if category is None:
            continue
        is_release_number = re.search(r"\b(?:cli release:|claude code v)\s*v?\d", title, re.I)
        is_impact = bool(
            IMPACT.search(title) and not is_release_number
            or mode == "claude" and re.fullmatch(r"Claude Platform: Claude [A-Z][a-z]+ \d+(?:\.\d+)*", title)
        )
        if label == "OpenAI" and category == "coding" and not is_impact and not title.startswith("Codex"):
            continue
        candidates.append(Candidate(
            title=title[:160], summary=summary_text(text, label), date=date, category=category,
            label=label, url=url, official=mode != "community", impact=is_impact,
            discussions=[link for url in page.links if (link := discussion_url(url))],
        ))
    return candidates


def deepseek_candidates(cutoff, get=fetch):
    root = ET.fromstring(get(DEEPSEEK_SITEMAP))
    dated_links = []
    for item in root.findall("{*}url"):
        url = item.findtext("{*}loc", "")
        match = re.fullmatch(r"https://api-docs\.deepseek\.com/news/news(\d{6})/?", url)
        if match:
            date = datetime.strptime(match[1], "%y%m%d").replace(tzinfo=timezone.utc)
            if date >= cutoff:
                dated_links.append((date, url))
    if not root.findall("{*}url"):
        raise ValueError("DeepSeek sitemap has no entries")
    candidates = []
    for date, url in sorted(dated_links, reverse=True)[:5]:
        page = PageText(get(url).decode("utf-8"))
        title = page.title.removesuffix(" | DeepSeek API Docs").strip()
        if not title:
            continue
        candidates.append(Candidate(
            title=title[:160], summary=summary_text(page.description, "DeepSeek"), date=date,
            category=category_for(title, page.description) or "models", label="DeepSeek", url=url,
            impact=bool(IMPACT.search(title) or re.search(r"\b(?:now via API|new API)\b", title, re.I)),
            discussions=[link for url in page.links if (link := discussion_url(url))],
        ))
    return candidates


def hn_discussion(hit, url, title, observed_at):
    discussion = {"label": "Hacker News", "url": url}
    for field, source in (("points", "points"), ("comments", "num_comments")):
        count = hit.get(source)
        if type(count) is int and count >= 0:
            discussion[field] = count
    if any(field in discussion for field in ("points", "comments")):
        discussion["observedAt"] = iso_date(observed_at)

    body = PageText(hit.get("story_text") or "").text
    if len(body) >= 35 and len(title_words(body) - title_words(title)) >= 3:
        discussion["preview"] = summary_text(body, "Hacker News")[:MAX_DISCUSSION_PREVIEW]
    return discussion


def hn_candidates(cutoff, observed_at, get=fetch):
    # Algolia publishes a documented index of public Hacker News submissions.
    params = urlencode({
        "tags": "story",
        "numericFilters": f"created_at_i>{int(cutoff.timestamp())},points>=35,num_comments>=5",
        "hitsPerPage": 100,
    })
    hits = json.loads(get(f"{HN_SEARCH}?{params}"))["hits"]
    candidates = []
    for hit in hits:
        title = PageText(hit.get("title") or "").text
        date = optional_date(hit.get("created_at"))
        if date is None or not title:
            continue
        category = category_for(title)
        if category is None or title.lower().startswith(("elevated errors", "service outage")):
            continue
        object_id = hit["objectID"]
        if not object_id.isdigit():
            continue
        thread = f"https://news.ycombinator.com/item?id={object_id}"
        url = clean_url(hit.get("url")) or thread
        discussion = hn_discussion(hit, thread, title, observed_at)
        comments = discussion.get("comments")
        summary = "Read the discussion on Hacker News."
        if comments is not None:
            summary = f"{comments:,} comments on Hacker News."
        candidates.append(Candidate(
            title=title[:160], summary=summary,
            date=date, category=category, label="Hacker News", url=url,
            official=False, points=discussion.get("points", 0), discussions=[discussion],
        ))
    return candidates


def discussion_key(url):
    social = discussion_url(url)
    return canonical_url(social["url"]).lower() if social else canonical_url(url)


def append_discussion(candidate, link):
    for index, existing in enumerate(candidate.discussions):
        if discussion_key(existing["url"]) != discussion_key(link["url"]):
            continue
        merged = {**link, **existing}
        # A points/comments pair is one observation. Preserve the latest pair
        # for the same post without importing numbers from its other links.
        current_time = existing.get("observedAt", "")
        incoming_time = link.get("observedAt", "")
        observed = link if incoming_time > current_time else existing
        for field in ENGAGEMENT_FIELDS:
            merged.pop(field, None)
            if field in observed:
                merged[field] = observed[field]
        candidate.discussions[index] = merged
        return
    candidate.discussions.append(link.copy())


def engagement_key(link):
    return (discussion_key(link["url"]), link.get("points"), link.get("comments"))


def preserve_unchanged_observations(candidates, previous):
    observations = {
        engagement_key(link): link["observedAt"]
        for story in previous["stories"]
        for link in story["discussions"]
        if "observedAt" in link
    }
    for candidate in candidates:
        for link in candidate.discussions:
            previous_time = observations.get(engagement_key(link))
            if previous_time and "observedAt" in link:
                # The snapshot already has a 12-hour heartbeat. Moving this
                # timestamp alone would publish a new commit every half hour.
                link["observedAt"] = previous_time


def event_key(candidate):
    title = candidate.title.lower()
    if "codex" in title and (version := re.search(r"\b(?:cli release:\s*|(?:rust-)?v)(\d+\.\d+\.\d+)\b", title)):
        return ("codex", version[1])
    if candidate.category == "models" and (IMPACT.search(title) or "in work and codex" in title):
        versions = {(family, variant, number) for family, variant, number in MODEL_VERSION.findall(title)}
        # The release and the Codex changelog spell the two versions differently.
        gpt_versions = tuple(sorted({number for family, _, number in versions if family == "gpt"}))
        if gpt_versions and re.search(r"\bastra\b", title) and re.search(r"\bsol\b", title):
            return ("gpt-dual-launch", gpt_versions)
    if match := re.search(r"\bgemini (\d+(?:\.\d+)*) (hydrogen|carbon|helium|flash|pro)\b", title):
        return ("gemini", *match.groups())
    return None


def title_words(title):
    common = {"introducing", "announcing", "released", "release", "available", "now", "the", "and", "in", "at", "a", "to"}
    return set(re.findall(r"[a-z]+|\d+(?:\.\d+)*", title.lower())) - common


def same_event(left, right):
    if canonical_url(left.url) == canonical_url(right.url):
        return True
    if abs(left.date - right.date) > timedelta(days=2):
        return False
    left_key = event_key(left)
    if left_key and left_key == event_key(right) and (left.impact or right.impact or left_key[0] == "codex"):
        return True
    left_words, right_words = title_words(left.title), title_words(right.title)
    shared = left_words & right_words
    return len(shared) >= 3 and len(shared) / len(left_words | right_words) >= 0.8


def rank(candidate, now):
    age = (now - candidate.date).total_seconds() / 86400
    # Fresh confirmed launches lead, while older stories gradually make room.
    boost = max(0, 7.5 - age / 4) if candidate.impact and candidate.official else 0
    boost += 2 if candidate.official else min(candidate.points, 300) / 150
    return (boost - max(age, 0) / 2, candidate.date, candidate.url)


def ordered_stories(candidates, curated, now):
    articles = []
    social = []
    for candidate in sorted(candidates, key=lambda item: rank(item, now), reverse=True):
        if not now - MAX_AGE <= candidate.date <= now:
            continue
        if urlsplit(candidate.url).hostname.removeprefix("www.") in SOCIAL_HOSTS:
            social.append(candidate)
            continue
        match = next((article for article in articles if same_event(article, candidate)), None)
        if match is None:
            articles.append(candidate)
            continue
        if candidate.official and (not match.official or canonical_url(candidate.url) in curated):
            preferred, duplicate = candidate, match
            articles[articles.index(match)] = preferred
        else:
            preferred, duplicate = match, candidate
        for discussion in duplicate.discussions:
            if (
                duplicate.label == "Hacker News"
                and discussion is duplicate.discussions[0]
                and discussion["label"] == "Hacker News"
                and "preview" not in discussion
                and len(title_words(duplicate.title) - title_words(preferred.title)) >= 2
            ):
                discussion = {**discussion, "preview": duplicate.title[:MAX_DISCUSSION_PREVIEW]}
            append_discussion(preferred, discussion)
    for candidate in social:
        link = discussion_url(candidate.url)
        if link is None:
            continue
        match = next((article for article in articles if same_event(article, candidate)), None)
        if match is not None:
            append_discussion(match, link)
    result = []
    seen = set()
    for article in sorted(articles, key=lambda item: rank(item, now), reverse=True):
        key = canonical_url(article.url)
        if key in seen:
            continue
        seen.add(key)
        if key in curated:
            pinned = curated[key]
            article.title = pinned.get("title", article.title)
            article.summary = pinned.get("summary", article.summary)
            discovered, article.discussions = article.discussions, []
            for link in [*pinned["discussions"], *discovered]:
                append_discussion(article, link)
        # Preserve an official feed's explicit announcement over a matching thread.
        featured = article.official and article.impact and now - article.date <= FEATURE_AGE
        result.append(article.story(featured))
    return result[:MAX_STORIES]


def previous_candidates(snapshot):
    for story in snapshot["stories"]:
        source = story["source"]
        label = source["label"]
        discussions = story["discussions"].copy()
        hn_points = next((link.get("points", 0) for link in discussions if link["label"] == "Hacker News"), 0)
        yield Candidate(
            title=story["title"], summary=story["summary"], date=read_date(story["publishedAt"]),
            category=story["category"], label=label, url=source["url"],
            official=label not in {"Hacker News", "Hugging Face"},
            impact=story["featured"] or bool(IMPACT.search(story["title"])),
            discussions=discussions, points=hn_points if label == "Hacker News" else 0,
        )


def build_snapshot(now, previous, curated, get=fetch, warn=print):
    cutoff = now - MAX_AGE
    collectors = [
        (feed[0], partial(feed_candidates, feed, cutoff, get)) for feed in FEEDS
    ] + [
        ("DeepSeek", partial(deepseek_candidates, cutoff, get)),
        ("Hacker News", partial(hn_candidates, now - timedelta(days=7), now, get)),
    ]
    candidates = []
    successes = 0
    with ThreadPoolExecutor(max_workers=len(collectors)) as pool:
        futures = [(label, pool.submit(collect)) for label, collect in collectors]
        for label, future in futures:
            try:
                candidates.extend(future.result())
                successes += label != "Hacker News"
            except (HTTPException, OSError, KeyError, TypeError, ValueError, ET.ParseError) as error:
                warn(f"{label} unavailable: {error}")
    if not successes:
        raise RuntimeError("All publisher feeds failed. Keeping the previous briefing.")
    # Refetched entries keep fresh metadata; retain bounded recent stories that
    # rolled out of a publisher's feed or were unavailable on this run.
    preserve_unchanged_observations(candidates, previous)
    fresh = {canonical_url(candidate.url): candidate for candidate in candidates}
    for candidate in previous_candidates(previous):
        current = fresh.get(canonical_url(candidate.url))
        if current is None:
            candidates.append(candidate)
        else:
            for discussion in candidate.discussions:
                append_discussion(current, discussion)
    stories = ordered_stories(candidates, curated, now)
    if not stories:
        raise RuntimeError("No eligible stories. Keeping the previous briefing.")
    return {"updatedAt": iso_date(now), "stories": stories}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    previous = json.loads(args.previous.read_text()) if args.previous else {"stories": []}
    curated = json.loads(CURATED_PATH.read_text())
    snapshot = build_snapshot(
        datetime.now(timezone.utc), previous, curated, warn=lambda message: print(message, file=sys.stderr),
    )
    if args.previous and snapshot["stories"] == previous["stories"]:
        age = read_date(snapshot["updatedAt"]) - read_date(previous["updatedAt"])
        if age < timedelta(hours=12):
            snapshot = previous
    args.output.write_text(f"{json.dumps(snapshot, indent=2, ensure_ascii=False)}\n", encoding="utf-8")
    print(f"Collected {len(snapshot['stories'])} stories.")


if __name__ == "__main__":
    main()
