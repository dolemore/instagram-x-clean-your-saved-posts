# Clean your saved posts

Save your Instagram saved posts and X (Twitter) bookmarks to your PC, then clear them from your account.

- **Download**: every image and video, including all slides of carousel posts, at the best available quality.
- **Clean**: un-save only the posts that are fully on your disk. The Python scripts remove nothing unless you pass `--apply`; the extension asks for a confirmation first.
- **Remember**: export captions and links as Markdown to use as a NotebookLM source.

## Chrome extension

The [`extension/`](extension/README.md) folder is a Chrome extension (Manifest V3) that does the same without Python or Playwright. It works in the tab where you are already logged in, saves into your Downloads folder and cleans only the posts whose files are fully on disk. Its interface is English and Turkish.

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension/` folder.
2. Open instagram.com or x.com, logged in, and click the extension icon.
3. Try it with *First N posts* set to 3: **Download**, check the files, then tick the backup box and **Clean**.

Details, safety rules and limits are in [extension/README.md](extension/README.md) ([Türkçe](extension/README.tr.md)). The privacy policy is [PRIVACY.md](PRIVACY.md). Chrome Web Store text and the packaging command are in [store/listing.md](store/listing.md). The Python scripts below remain available.

## Python scripts

The scripts drive a real browser window with [Playwright](https://playwright.dev/python/). You log in by hand in that window; the scripts never see or store your password.

## Browser

By default the scripts open your installed **Google Chrome** (a separate profile in `browser_profile/`, so your daily Chrome is untouched). Log in once in that window; the login is kept. Sites like X reject Playwright's bundled Chromium, which is why Chrome is the default. Use `--browser chromium` to switch.

## Setup

Requires Python 3.9+.

```
pip install -r requirements.txt
python -m playwright install chromium
```

## Instagram

```
python instagram_saved.py download
python instagram_saved.py unsave            # dry run: shows the counts
python instagram_saved.py unsave --apply    # un-saves up to 150 posts
```

Files land in `downloads/instagram/` as `date_user_postcode_01.jpg`, with `posts.csv` listing every post's link, caption, and files.

## X (Twitter)

```
python x_bookmarks.py download
python x_bookmarks.py remove
python x_bookmarks.py remove --apply
```

Files land in `downloads/x/`. Text-only bookmarks have no files; their text is kept in `posts.csv`.

## NotebookLM

```
python export_notebook.py downloads/instagram downloads/x
```

This writes Markdown files to `notebook_export/`. Add them to a notebook as sources, either by uploading them directly or by putting them in Google Drive first. Only text goes in (author, date, link, caption); the media stays on your disk.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--out` | `downloads/instagram`, `downloads/x` | Archive folder |
| `--profile` | `browser_profile` | Where the browser login is kept |
| `--limit` | `150` | Most posts to un-save in one run |
| `--apply` | off | Actually un-save; without it nothing changes |

## How it stays safe

- A post is un-saved only if every file listed for it in `posts.csv` exists on disk and is not empty.
- Un-saved posts are logged in `removed.txt`, so reruns continue where the last one stopped.
- Requests are spaced out by a few seconds, and un-saving stops after three failures in a row.
- Everything can be rerun: existing files are skipped.

## Things to know

- **Terms of service.** Automating Instagram or X is against their terms. Use this on your own account, at your own risk. Running it too fast or too often can get an account temporarily restricted, so keep the built-in delays and split large collections over several days.
- **Never share `browser_profile/`.** It holds your login cookies. It is in `.gitignore`.
- **Un-saving cannot be undone in bulk.** Back up your download folder before using `--apply`.
- **Sites change.** These scripts depend on Instagram's and X's current web pages and will need updates when those change. If un-saving fails, the script prints the icon names it found and saves a screenshot (`error_*.png`) to help fix it.
- **Interface language.** The Instagram un-save step recognizes the English and Turkish interface. For other languages, add the label of the save button to `IS_SAVED` in `instagram_saved.py`.
- The X script was written against X's web app as of November 2026 and has had less real-world use than the Instagram one.

## License

MIT
