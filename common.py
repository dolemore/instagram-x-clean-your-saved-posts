"""Shared helpers: browser session, downloads, and the archive index (posts.csv)."""

import csv
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

CSV_FIELDS = ["date", "user", "link", "files", "caption"]
# Column names written by early versions of the Instagram script.
LEGACY_FIELDS = {"tarih": "date", "kullanici": "user", "dosyalar": "files", "aciklama": "caption"}
INDEX_NAMES = ("posts.csv", "kayitlar.csv")
FILE_SEPARATOR = " | "


def find_chrome():
    """Locate the installed Google Chrome (set CHROME_PATH to override)."""
    candidates = [os.environ.get("CHROME_PATH", "")]
    for base in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        if os.environ.get(base):
            candidates.append(os.path.join(os.environ[base], "Google", "Chrome", "Application", "chrome.exe"))
    candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    candidates += [shutil.which(n) or "" for n in ("google-chrome", "chrome", "chromium")]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    raise SystemExit("Google Chrome not found. Install it, or use --browser chromium.")


def _port_open(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def open_browser(playwright, profile_dir, browser="chrome", port=9222):
    """Open a visible browser window whose login survives between runs.

    chrome   : your installed Chrome, started normally and then controlled remotely.
               Sites like X reject Playwright's own Chromium, but accept this.
    chromium : Playwright's bundled Chromium.
    """
    if browser == "chromium":
        context = playwright.chromium.launch_persistent_context(
            profile_dir, headless=False, viewport={"width": 1280, "height": 900}
        )
    else:
        if not _port_open(port):
            subprocess.Popen([find_chrome(), f"--remote-debugging-port={port}",
                              f"--user-data-dir={Path(profile_dir).resolve()}",
                              "--no-first-run", "--no-default-browser-check"])
            for _ in range(60):
                if _port_open(port):
                    break
                time.sleep(0.5)
            else:
                raise SystemExit("Chrome did not start. Close other Chrome windows that use this profile and retry.")
        context = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}").contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    return context, page


def close_browser(context):
    """Disconnect; a Chrome window you started stays open for you to close."""
    try:
        context.close()
    except Exception:
        pass


def wait_for_login(context, site_url, cookie_name, minutes=10):
    """Block until the user has logged in by hand in the opened window."""
    print("Log in in the browser window (nothing to do if you are already logged in)...")
    for _ in range(minutes * 60):
        if any(c["name"] == cookie_name for c in context.cookies(site_url)):
            print("Login detected.")
            return
        time.sleep(1)
    raise SystemExit("No login detected, exiting.")


def download(context, url, target: Path, attempts=3):
    for attempt in range(attempts):
        try:
            response = context.request.get(url, timeout=120_000)
            if response.ok:
                target.write_bytes(response.body())
                return True
            print(f"   HTTP {response.status}, retrying...")
        except Exception as error:  # network drop, timeout
            print(f"   {error}, retrying...")
        time.sleep(3 * (attempt + 1))
    return False


def index_path(folder: Path) -> Path:
    for name in INDEX_NAMES:
        if (folder / name).exists():
            return folder / name
    return folder / INDEX_NAMES[0]


def read_index(folder: Path):
    """Return the archive index as a list of dicts keyed by CSV_FIELDS."""
    path = index_path(folder)
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = []
        for row in csv.DictReader(f):
            rows.append({LEGACY_FIELDS.get(key, key): value or "" for key, value in row.items()})
        return rows


def open_index_writer(folder: Path):
    """Open the index for appending; returns (file, csv.DictWriter)."""
    path = index_path(folder)
    is_new = not path.exists()
    header = CSV_FIELDS
    if not is_new:
        with open(path, encoding="utf-8-sig", newline="") as f:
            header = next(csv.reader(f), CSV_FIELDS)
    reverse = {new: old for old, new in LEGACY_FIELDS.items() if old in header}
    f = open(path, "a", newline="", encoding="utf-8-sig")
    writer = csv.DictWriter(f, fieldnames=header)
    if is_new:
        writer.writeheader()

    def write(row):
        writer.writerow({reverse.get(key, key): value for key, value in row.items()})
        f.flush()

    return f, write


def fully_archived(row, existing_files):
    """True when every file the index lists for this post is on disk."""
    files = [name for name in row.get("files", "").split(FILE_SEPARATOR) if name]
    return all(name in existing_files for name in files)


def files_on_disk(folder: Path):
    return {f.name for f in folder.iterdir() if f.is_file() and f.stat().st_size > 0}


def read_done(folder: Path, name="removed.txt"):
    """Posts already un-saved by earlier runs, so reruns skip them."""
    done = set()
    for candidate in (name, "kaldirilanlar.txt"):
        path = folder / candidate
        if path.exists():
            done |= set(path.read_text(encoding="utf-8").split())
    return done
