"""
Archive your X (Twitter) bookmarks to disk, then remove the archived ones.

    python x_bookmarks.py download
    python x_bookmarks.py remove --apply

`download` scrolls your bookmarks page and saves every photo and video plus an
index (posts.csv) with the post text and link; text-only bookmarks are indexed
too. `remove` only touches bookmarks that are fully archived, and without
--apply it only reports what it would do.
"""

import argparse
import random
import re
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

from common import (FILE_SEPARATOR, download, files_on_disk, fully_archived,
                    close_browser, open_browser, open_index_writer, read_done, read_index,
                    wait_for_login)

SITE = "https://x.com/"
IDLE_ROUNDS_BEFORE_STOP = 6


def find_tweets(node):
    """Yield every tweet object in a bookmarks timeline response."""
    if isinstance(node, dict):
        result = (node.get("tweet_results") or {}).get("result")
        if isinstance(result, dict):
            # Restricted posts are wrapped one level deeper.
            yield result.get("tweet", result)
        for value in node.values():
            yield from find_tweets(value)
    elif isinstance(node, list):
        for value in node:
            yield from find_tweets(value)


def parse_tweet(tweet):
    """Reduce a tweet object to what the archive needs, or None if unusable."""
    legacy = tweet.get("legacy") or {}
    tweet_id = tweet.get("rest_id") or legacy.get("id_str")
    if not tweet_id:
        return None
    author = ((tweet.get("core") or {}).get("user_results") or {}).get("result") or {}
    user = ((author.get("core") or {}).get("screen_name")
            or (author.get("legacy") or {}).get("screen_name") or "unknown")
    long_text = (((tweet.get("note_tweet") or {}).get("note_tweet_results") or {})
                 .get("result") or {}).get("text")
    try:
        date = datetime.strptime(legacy.get("created_at", ""), "%a %b %d %H:%M:%S %z %Y").strftime("%Y-%m-%d")
    except ValueError:
        date = "0000-00-00"

    media = []
    for item in (legacy.get("extended_entities") or {}).get("media", []):
        if item.get("type") == "photo":
            media.append((item["media_url_https"] + "?name=orig", "jpg"))
        else:  # video or animated_gif: take the highest-bitrate mp4
            variants = [v for v in (item.get("video_info") or {}).get("variants", [])
                        if v.get("content_type") == "video/mp4"]
            if variants:
                media.append((max(variants, key=lambda v: v.get("bitrate", 0))["url"], "mp4"))

    return {"id": tweet_id, "user": user, "date": date, "media": media,
            "text": (long_text or legacy.get("full_text") or "").replace("\n", " ")}


def cmd_download(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    known_links = {row["link"] for row in read_index(out)}
    collected = {}

    seen_operations = set()

    def on_response(response):
        if "/graphql/" not in response.url:
            return
        operation = response.url.split("?")[0].rsplit("/", 1)[-1]
        seen_operations.add(operation)
        if "bookmark" in operation.lower():
            try:
                for tweet in find_tweets(response.json()):
                    parsed = parse_tweet(tweet)
                    if parsed:
                        collected.setdefault(parsed["id"], parsed)
            except Exception:
                pass  # non-JSON or aborted response

    with sync_playwright() as p:
        context, page = open_browser(p, args.profile, args.browser)
        page.goto(SITE, wait_until="domcontentloaded")
        wait_for_login(context, SITE, "auth_token")

        page.on("response", on_response)
        page.goto(args.url, wait_until="domcontentloaded")
        idle = 0
        while idle < IDLE_ROUNDS_BEFORE_STOP:
            before = len(collected)
            page.mouse.wheel(0, 4000)
            time.sleep(random.uniform(1.5, 3))
            idle = idle + 1 if len(collected) == before else 0
            if len(collected) != before:
                print(f"Found {len(collected)} bookmarks...")
        page.remove_listener("response", on_response)
        if not collected:
            print("No bookmarks found on this page. Requests seen:", sorted(seen_operations))

        index_file, write_row = open_index_writer(out)
        new_files = 0
        for tweet in collected.values():
            names = []
            for number, (url, extension) in enumerate(tweet["media"], start=1):
                name = f"{tweet['date']}_{tweet['user']}_{tweet['id']}_{number:02d}.{extension}"
                names.append(name)
                if (out / name).exists():
                    continue
                if download(context, url, out / name):
                    new_files += 1
                    print(f"   + {name}")
                else:
                    print(f"   ! failed: {name}")
                time.sleep(random.uniform(0.3, 1))
            link = f"{SITE}{tweet['user']}/status/{tweet['id']}"
            if link not in known_links:
                known_links.add(link)
                write_row({"date": tweet["date"], "user": tweet["user"], "link": link,
                           "files": FILE_SEPARATOR.join(names), "caption": tweet["text"]})
        index_file.close()
        print(f"\nDone. {len(collected)} bookmarks indexed, {new_files} new files -> {out.resolve()}")
        close_browser(context)


def cmd_remove(args):
    out = Path(args.out)
    on_disk = files_on_disk(out)
    done = read_done(out)
    ids, incomplete = [], 0
    for row in read_index(out):
        match = re.search(r"/status/(\d+)", row.get("link", ""))
        if not match or match.group(1) in done or match.group(1) in ids:
            continue
        if fully_archived(row, on_disk):  # text-only bookmarks live in the index itself
            ids.append(match.group(1))
        else:
            incomplete += 1

    print(f"Already removed: {len(done)} | Ready: {len(ids)} | "
          f"Not fully downloaded (left alone): {incomplete}")
    if not args.apply:
        print("Dry run, nothing changed. Add --apply to remove bookmarks.")
        return

    with sync_playwright() as p:
        context, page = open_browser(p, args.profile, args.browser)
        page.goto(SITE, wait_until="domcontentloaded")
        wait_for_login(context, SITE, "auth_token")

        removed, failures = 0, 0
        with open(out / "removed.txt", "a", encoding="utf-8") as log:
            for tweet_id in ids[: args.limit]:
                page.goto(f"{SITE}i/status/{tweet_id}", wait_until="domcontentloaded")
                bookmarked = page.locator('[data-testid="removeBookmark"]').first
                plain = page.locator('[data-testid="bookmark"]').first
                try:
                    bookmarked.or_(plain).first.wait_for(timeout=20000)
                except Exception:
                    pass

                outcome = None
                if bookmarked.count():
                    bookmarked.click()
                    try:
                        plain.wait_for(timeout=8000)
                        outcome = "removed"
                    except Exception:
                        pass
                elif plain.count():
                    outcome = "was not bookmarked"

                if outcome:
                    failures = 0
                    removed += 1
                    log.write(tweet_id + "\n")
                    log.flush()
                    print(f"  - {removed} {outcome}: {tweet_id}")
                else:
                    failures += 1
                    print(f"  ? could not remove: {tweet_id} (deleted or unavailable post?)")
                    page.screenshot(path=str(out / f"error_{tweet_id}.png"))
                    if failures >= 3:
                        print("Three failures in a row, stopping.")
                        break
                time.sleep(random.uniform(2, 4))

        print(f"\nDone. Processed: {removed} | Remaining: {len(ids) - removed}")
        close_browser(context)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["download", "remove"])
    parser.add_argument("--out", default="downloads/x", help="archive folder")
    parser.add_argument("--browser", choices=["chrome", "chromium"], default="chrome",
                        help="chrome = your installed Chrome (recommended), chromium = bundled")
    parser.add_argument("--profile", default="browser_profile", help="browser session folder")
    parser.add_argument("--url", default=SITE + "i/bookmarks", help="page that lists your bookmarks")
    parser.add_argument("--limit", type=int, default=150, help="max bookmarks to remove per run")
    parser.add_argument("--apply", action="store_true", help="actually remove (default is a dry run)")
    args = parser.parse_args()
    {"download": cmd_download, "remove": cmd_remove}[args.command](args)


if __name__ == "__main__":
    main()
