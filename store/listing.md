# Chrome Web Store listing

Text to paste into the Developer Dashboard, and the steps to build and submit the package.

## Basics

| Field | Value |
| --- | --- |
| Name | English: *Clean Your Saved Posts*. Turkish: *Kayıtlı Gönderileri Temizle*. Both come from `_locales/*/messages.json`; the platform names are kept out of the title on purpose (trademark policy). |
| Category | Productivity |
| Languages | English (default), Turkish |
| Visibility | Unlisted is a good first step: installable only from the link, still reviewed. |
| Privacy policy URL | https://gist.github.com/dolemore/1891fb537f0bd54e0a3e047927b20d51, a public copy of [PRIVACY.md](../PRIVACY.md). The GitHub repository is private, so its own file page is not reachable by the reviewers. Edit the gist whenever `PRIVACY.md` changes, and keep its file name `PRIVACY.md` so GitHub renders it as Markdown. |

## Single purpose

Back up the user's own saved Instagram posts and X bookmarks to their computer, and remove the save only for the posts that were fully downloaded.

## Short description (132 characters at most)

- English: Back up your own Instagram saved posts and X bookmarks to your computer, then clear the ones you downloaded.
- Türkçe: Instagram kaydedilenlerinizi ve X yer işaretlerinizi bilgisayara yedekleyin, sonra indirilenleri hesabınızdan temizleyin.

## Detailed description

### English

Back up your own saved posts, then clean them up.

Clean Your Saved Posts downloads the posts you saved on Instagram and bookmarked on X to your computer, and removes the save only for posts that are completely on your disk.

• Download: every image and video, all slides of carousels, at the best quality available, plus an index (posts.csv) with date, author, link, files and caption.
• Clean: removes the save or bookmark only for posts whose files are fully downloaded and still on your disk. Cleaning cannot be undone, so the extension asks you to confirm that you backed up your files first.
• Export for NotebookLM: writes Markdown files (author, date, link, caption) that you can add to a NotebookLM notebook as sources.
• Careful by design: it works in the tab where you are already logged in, pauses between requests, stops after three failures in a row, shows progress and has a Stop button. Run it again at any time; finished posts are skipped.
• Private: no account, no servers, no analytics. Everything stays on your computer.

Start with "First N posts" set to 3 to see how it behaves. Use it on your own account and your own data. Not affiliated with Instagram, Meta or X.

### Türkçe

Kendi kayıtlı gönderilerinizi yedekleyin, sonra temizleyin.

Kayıtlı Gönderileri Temizle, Instagram'da kaydettiğiniz ve X'te yer işareti koyduğunuz gönderileri bilgisayarınıza indirir ve yalnızca tamamen diskinizde olan gönderilerin kaydını kaldırır.

• İndir: tüm görseller ve videolar, carousel'in bütün slaytları, mevcut en yüksek kalitede; ayrıca tarih, yazar, bağlantı, dosyalar ve açıklamayı içeren bir indeks (posts.csv).
• Temizle: yalnızca dosyaları tamamen inmiş ve hâlâ diskinizde duran gönderilerin kaydını ya da yer işaretini kaldırır. Temizleme geri alınamaz; bu yüzden eklenti, önce dosyalarınızı yedeklediğinizi onaylamanızı ister.
• NotebookLM için dışa aktar: NotebookLM defterine kaynak olarak ekleyebileceğiniz Markdown dosyaları yazar (yazar, tarih, bağlantı, açıklama).
• Dikkatli tasarım: zaten oturum açtığınız sekmede çalışır, istekler arasında bekler, art arda üç hatada durur, ilerlemeyi gösterir ve Durdur düğmesi vardır. İstediğiniz zaman yeniden çalıştırın; biten gönderiler atlanır.
• Gizli: hesap yok, sunucu yok, analitik yok. Her şey bilgisayarınızda kalır.

Nasıl davrandığını görmek için "İlk N gönderi" alanını 3 yaparak başlayın. Kendi hesabınızda ve kendi verileriniz için kullanın. Instagram, Meta veya X ile bağlantılı değildir.

## Permission justifications (Privacy practices tab)

| Permission | Justification |
| --- | --- |
| `downloads` | Saves the user's media files, the `posts.csv` index and the Markdown export into the Downloads folder, and checks that each file is complete and still on disk before a post can be cleaned. |
| `storage` | Remembers, per post, which files were saved, plus the popup's settings and job progress, so a run can be resumed. |
| `scripting` | Runs small functions in the instagram.com or x.com tab the user started from: reads the saved-posts list with the page's own session, scrolls the X bookmarks page, and clicks the page's own save or bookmark button to remove a save. |
| `offscreen` | Creates the blob URLs the CSV and Markdown downloads need; a Manifest V3 service worker cannot create them. Reason: `BLOBS`. |
| Host `*://*.instagram.com/*`, `*://x.com/*` | The sites the extension works on. On x.com two content scripts observe the bookmark responses the page already loads (they do not alter them). |
| Host `*://*.twimg.com/*`, `*://*.cdninstagram.com/*` | The media servers the files are downloaded from. |

Developer note (do not paste): `chrome.downloads` can fetch a URL without host permission, so the two media-server entries are probably not required. If review objects to them, remove them from `manifest.json`, run one Download on each site and resubmit.

Content scripts: `content/x-hook.js` runs in the page's world (`"world": "MAIN"`) at `document_start` so it can see X's bookmark requests before X's code runs; `content/x-relay.js` forwards what it sees to the extension.

## Remote code

No. All code is in the package. No `eval`, no remotely hosted scripts.

## Data usage

The extension works on the user's saved posts and bookmarks but transmits nothing off the device, so no data-collection category applies. Confirm the three certifications: the data is not sold, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

## Notes for the reviewers (test instructions)

The extension needs an instagram.com or x.com account that has at least one saved post or bookmark. No credentials are provided; use your own account. Open instagram.com, click the extension icon, set "First N posts" to 1 and press Download: one post's files appear in `Downloads/instagram-x-saved/instagram/` together with `posts.csv`. Clean asks for a confirmation first.

## Screenshots (1280×800, PNG or JPEG, up to five)

1. The popup on an Instagram tab: the "First N posts" field, **Download**, the Clean warning with its checkbox, and the record counts.
2. A Download in progress: progress bar, counters and the log.
3. `Downloads/instagram-x-saved/instagram/` in the file manager, with the images and `posts.csv`.
4. The popup on an X tab with the bookmarks address field.
5. `posts.csv` open in a spreadsheet, or the NotebookLM sources made from the Markdown export.

Small promo tile: 440×280 (optional). Use the 128 px icon from `extension/icons/`.

## Build the package

```
python store/pack.py
```

This writes `dist/clean-your-saved-posts-<version>.zip` with `manifest.json` at the top level and leaves the README files out. Without Python (macOS, Linux, Git Bash):

```
cd extension && zip -r ../dist/clean-your-saved-posts.zip . -x "README*" && cd ..
```

PowerShell 7 can do it with `Compress-Archive`; Windows PowerShell 5.1 writes backslash paths that the store rejects, so use `pack.py` there. Raise `"version"` in `extension/manifest.json` for every upload.

## Submit

1. Check that the public gist still matches `PRIVACY.md`.
2. Register as a Chrome Web Store developer (one-time fee of 5 USD) and open the Developer Dashboard.
3. Create a new item and upload the zip.
4. Paste the texts above, upload the screenshots, fill the Privacy practices tab, set the visibility, and submit for review.

## Review risks

- **Terms of service.** Instagram's and X's terms forbid automated access. The store may reject the item or remove it later. The case for approval: the user backs up their own data from their own logged-in session, at a slow pace, with no credentials, no scraping of other people's data and nothing leaving the device.
- **Fallback.** If the store rejects it, share the `extension/` folder for "Load unpacked": through the GitHub repository (it must be public for that) or as the zip from `store/pack.py`.
- **Trademarks.** The listing says "not affiliated"; keep platform logos and names out of the icon and screenshots' titles.
- **Host permissions.** The twimg and cdninstagram entries are the likeliest to draw a question; see the developer note above.
