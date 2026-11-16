"""
Archive your Instagram saved posts to disk, then un-save the archived ones.

    python instagram_saved.py download
    python instagram_saved.py unsave --apply

`download` saves every image and video (all slides of carousels) plus an index
(posts.csv) with captions and links. `unsave` only touches posts whose files are
all on disk, and without --apply it only reports what it would do.
"""

import argparse
import json
import random
import re
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

from common import (FILE_SEPARATOR, download, files_on_disk, fully_archived,
                    close_browser, open_browser, open_index_writer, read_done, read_index,
                    wait_for_login)

SITE = "https://www.instagram.com/"
SAVED_FEED = SITE + "api/v1/feed/saved/posts/"

# Runs inside the page so the request carries the real browser session.
FETCH_JSON = """async (url) => {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
  const r = await fetch(url, {
    credentials: "include",
    headers: {
      "X-IG-App-ID": "936619743392459",
      "X-CSRFToken": csrf,
      "X-Requested-With": "XMLHttpRequest"
    }
  });
  return { status: r.status, text: await r.text() };
}"""

# The save toggle is an icon whose accessible name tells its state.
# Matches English and Turkish; extend the patterns for other UI languages.
SAVE_STATE = r"""() => {
  const IS_SAVED = n => /kaldır|remove|kaydedildi|saved/.test(n) && !/kaydedilenler$/.test(n);
  const name = s => (s.getAttribute('aria-label') || '').trim().toLowerCase();
  const icons = [...document.querySelectorAll('svg[aria-label]')];
  if (icons.some(s => IS_SAVED(name(s)))) return "saved";
  if (icons.some(s => /^(save|kaydet)$/.test(name(s)))) return "unsaved";
  return null;
}"""

CLICK_UNSAVE = r"""() => {
  const IS_SAVED = n => /kaldır|remove|kaydedildi|saved/.test(n) && !/kaydedilenler$/.test(n);
  const name = s => (s.getAttribute('aria-label') || '').trim().toLowerCase();
  const icon = [...document.querySelectorAll('svg[aria-label]')]
    .find(s => IS_SAVED(name(s)));
  if (!icon) return false;
  (icon.closest('[role="button"], button') || icon.parentElement).click();
  return true;
}"""

ICON_NAMES = ("() => [...new Set([...document.querySelectorAll('svg[aria-label]')]"
              ".map(e => e.getAttribute('aria-label')))]")


def best_media_url(media):
    if media.get("video_versions"):
        return media["video_versions"][0]["url"], "mp4"
    candidates = media.get("image_versions2", {}).get("candidates", [])
    if candidates:
        largest = max(candidates, key=lambda c: c.get("width", 0) * c.get("height", 0))
        return largest["url"], "jpg"
    return None, None


def cmd_download(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    known_links = {row["link"] for row in read_index(out)}

    with sync_playwright() as p:
        context, page = open_browser(p, args.profile, args.browser)
        page.goto(SITE, wait_until="domcontentloaded")
        wait_for_login(context, SITE, "sessionid")
        page.goto(SITE, wait_until="domcontentloaded")
        time.sleep(5)

        index_file, write_row = open_index_writer(out)
        max_id, page_number, new_files = None, 0, 0
        while True:
            page_number += 1
            result = page.evaluate(FETCH_JSON, SAVED_FEED + (f"?max_id={max_id}" if max_id else ""))
            try:
                data = json.loads(result["text"]) if result["status"] == 200 else None
            except json.JSONDecodeError:
                data = None
            if data is None:
                print(f"Could not read the saved list (HTTP {result['status']}). "
                      "Check the browser window for a verification prompt, then rerun.")
                break
            items = data.get("items", [])
            print(f"Page {page_number}: {len(items)} posts")

            for item in items:
                media = item.get("media", item)
                code = media.get("code", media.get("pk"))
                user = (media.get("user") or {}).get("username", "unknown")
                date = datetime.fromtimestamp(media.get("taken_at", 0)).strftime("%Y-%m-%d")
                caption = ((media.get("caption") or {}).get("text") or "").replace("\n", " ")
                names = []
                for number, part in enumerate(media.get("carousel_media") or [media], start=1):
                    url, extension = best_media_url(part)
                    if not url:
                        continue
                    name = f"{date}_{user}_{code}_{number:02d}.{extension}"
                    names.append(name)
                    if (out / name).exists():
                        continue
                    if download(context, url, out / name):
                        new_files += 1
                        print(f"   + {name}")
                    else:
                        print(f"   ! failed: {name}")
                    time.sleep(random.uniform(0.5, 1.5))

                link = f"{SITE}p/{code}/"
                if link not in known_links:
                    known_links.add(link)
                    write_row({"date": date, "user": user, "link": link,
                               "files": FILE_SEPARATOR.join(names), "caption": caption})

            if not data.get("more_available"):
                break
            max_id = data.get("next_max_id")
            time.sleep(random.uniform(3, 6))  # stay well under Instagram's rate limits

        index_file.close()
        print(f"\nDone. {new_files} new files -> {out.resolve()}")
        close_browser(context)


def wait_for_state(page, seconds=20):
    for _ in range(seconds * 2):
        state = page.evaluate(SAVE_STATE)
        if state:
            return state
        time.sleep(0.5)
    return None


def cmd_unsave(args):
    out = Path(args.out)
    on_disk = files_on_disk(out)
    done = read_done(out)
    codes, incomplete = [], 0
    for row in read_index(out):
        match = re.search(r"/p/([^/]+)/", row.get("link", ""))
        if not match or match.group(1) in done or match.group(1) in codes:
            continue
        if row.get("files") and fully_archived(row, on_disk):
            codes.append(match.group(1))
        else:
            incomplete += 1

    print(f"Already un-saved: {len(done)} | Ready: {len(codes)} | "
          f"Not fully downloaded (left alone): {incomplete}")
    if not args.apply:
        print("Dry run, nothing changed. Add --apply to un-save.")
        return

    with sync_playwright() as p:
        context, page = open_browser(p, args.profile, args.browser)
        page.goto(SITE, wait_until="domcontentloaded")
        wait_for_login(context, SITE, "sessionid")

        removed, failures = 0, 0
        with open(out / "removed.txt", "a", encoding="utf-8") as log:
            for code in codes[: args.limit]:
                page.goto(f"{SITE}p/{code}/", wait_until="domcontentloaded")
                state = wait_for_state(page)
                outcome = None
                if state == "saved":
                    page.evaluate(CLICK_UNSAVE)
                    time.sleep(1.5)
                    if wait_for_state(page, 8) == "unsaved":
                        outcome = "un-saved"
                elif state == "unsaved":
                    outcome = "was not saved"

                if outcome:
                    failures = 0
                    removed += 1
                    log.write(code + "\n")
                    log.flush()
                    print(f"  - {removed} {outcome}: {code}")
                else:
                    failures += 1
                    print(f"  ? could not un-save: {code}")
                    print(f"    icon names on page: {page.evaluate(ICON_NAMES)}")
                    page.screenshot(path=str(out / f"error_{code}.png"))
                    if failures >= 3:
                        print("Three failures in a row, stopping.")
                        break
                time.sleep(random.uniform(2, 4))

        print(f"\nDone. Processed: {removed} | Remaining: {len(codes) - removed}")
        close_browser(context)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["download", "unsave"])
    parser.add_argument("--out", default="downloads/instagram", help="archive folder")
    parser.add_argument("--browser", choices=["chrome", "chromium"], default="chrome",
                        help="chrome = your installed Chrome (recommended), chromium = bundled")
    parser.add_argument("--profile", default="browser_profile", help="browser session folder")
    parser.add_argument("--limit", type=int, default=150, help="max posts to un-save per run")
    parser.add_argument("--apply", action="store_true", help="actually un-save (default is a dry run)")
    args = parser.parse_args()
    {"download": cmd_download, "unsave": cmd_unsave}[args.command](args)


if __name__ == "__main__":
    main()
