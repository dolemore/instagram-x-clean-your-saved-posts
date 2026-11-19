# Clean Your Saved Posts — Chrome extension

Back up your **Instagram saved posts** and **X bookmarks** to your computer, then remove the saves of the posts that were fully downloaded. It runs in your own browser tab; nothing is sent anywhere ([privacy](../PRIVACY.md)). Türkçe: [README.tr.md](README.tr.md).

Needs Chrome 116 or newer. The interface follows the browser language (English or Turkish).

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `extension/` folder.
3. Open instagram.com or x.com, logged in, and click the extension icon.

## Use

| Button | What it does |
| --- | --- |
| **Download** | Saves every image and video (all slides of carousels, best quality) and writes `posts.csv`. Run it again whenever you like: files already on disk are skipped and new saves are added. |
| **Clean** | Removes the save or bookmark of posts whose files are fully on disk. It cannot be undone. Back up the download folder first, then tick the confirmation box. |
| **Export for NotebookLM** | Writes Markdown sources (author, date, link, caption) for both sites, at most 300,000 words per file. |
| **Stop** | Finishes the current step and stops. The index is still written. |
| **Reset records** | Forgets what the extension remembers. Downloaded files are not touched; the next Download saves them again as `name (1).jpg`. |

**First N posts** limits one run to the newest N posts, for Download and Clean. Leave it empty for all posts; Clean then handles at most 150 posts per run. **Bookmarks page address** (X only) is `https://x.com/i/bookmarks`; some accounts use `https://x.com/i/history`.

Try it first with N = 3: Download, check the files, then Clean with N = 3 and check that three posts are no longer saved.

Keep the tab you started from open and in front while a job runs. On Instagram, Download reads the list without leaving the page; on X it reloads the tab at the bookmarks address and scrolls it; Clean moves the tab from post to post. Closing the popup does not stop a job; reopen it to see progress.

## Where the files go

```
Downloads/instagram-x-saved/instagram/   2026-01-02_user_CODE_01.jpg ... posts.csv
Downloads/instagram-x-saved/x/           2026-01-02_user_ID_01.mp4  ... posts.csv
Downloads/instagram-x-saved/notebooklm/  instagram_saved_posts.md, x_saved_posts.md
```

`posts.csv` has the columns `date,user,link,files,caption` (UTF-8 with BOM, so Excel reads it). `files` lists the names Chrome actually saved. The CSV is rewritten on every run; if it is open in a spreadsheet, Chrome saves `posts (1).csv` next to it instead.

## How it stays safe

- **Only complete posts are cleaned.** Every file of a post must be complete in Chrome's download history and still on disk, checked twice. A file you moved or deleted keeps its post saved; the log says how many were left alone, and Download fetches the file again.
- **A text-only X bookmark** is cleaned only after `posts.csv` was written following its last update.
- **The un-save is confirmed on the page** (the icon flips back) before a post counts as cleaned.
- **Slow and gentle.** 2–5 seconds between requests to instagram.com and x.com (list pages, post pages); 0.5–1.5 seconds between files from the media CDNs, which are not those sites' APIs.
- **Stops early** after three failures in a row, on a login wall, or on HTTP 429.
- **Resumable.** Run the same button again; finished posts and files are skipped. If Chrome stops the extension's background worker mid-job, the popup shows "Interrupted" and running again continues.
- **Only https media from the sites' own CDNs** (`twimg.com`, `cdninstagram.com`, `fbcdn.net`) is downloaded, whatever a page sends.

## Things to know

- **Terms of service.** Automating Instagram or X is against their terms. Use it on your own account, at your own risk, and spread large collections over several days.
- **Chrome settings.** Turn off *Ask where to save each file before downloading* in Chrome's download settings, or Chrome may ask for every file. Chrome also shows its download bubble for each file.
- **Storage.** The extension keeps about 1 KB per post in `chrome.storage.local`, which Chrome limits to 10 MB. If it fills up, the job stops with a message; use *First N* and work in rounds.
- **Interface language.** Instagram's un-save recognises the English and Turkish interface. For another language add the label of the save button to `pageSaveState` and `pageClickUnsave` in `lib/instagram.js`.
- **Sites change.** If a clean step fails, the popup log names the post. Instagram and X can change their pages at any time.

## Permissions

| Permission | Used for |
| --- | --- |
| `downloads` | Saving media, the index and the Markdown files; checking that a file is complete and still there. |
| `storage` | Remembering per-post progress, the popup's settings and job progress. |
| `scripting` | Reading the saved list with your session, scrolling X's bookmarks and clicking the page's own save button in the tab you started from. |
| `offscreen` | Building the CSV and Markdown files as blob URLs; a service worker cannot. |
| `*://*.instagram.com/*`, `*://x.com/*` | Running on those pages. |
| `*://*.twimg.com/*`, `*://*.cdninstagram.com/*` | The media CDNs the files come from. |

## Development

```
node --test tests/              # parsing, safety rules, and the job engine against simulated pages
python store/make_icons.py      # regenerate extension/icons
python store/pack.py            # build dist/clean-your-saved-posts-<version>.zip
```

The page-facing code is in `lib/` (`instagram.js`, `xparse.js` hold the functions injected into pages), the job engine in `lib/engine.js`, and the X page hook in `content/`. The Python scripts in the repository root are the reference for the selectors and API calls.
