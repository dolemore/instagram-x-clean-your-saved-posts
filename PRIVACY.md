# Privacy Policy — Clean Your Saved Posts

Last updated: 2026-11-19. Türkçe sürüm aşağıdadır.

**Clean Your Saved Posts does not collect, transmit, sell or share any data.** It has no server, no account, no analytics, no advertising and loads no remote code. Everything it does happens on your computer, in your browser.

## What the extension reads

When you press a button in its popup, the extension works on the instagram.com or x.com tab you started it from, using the session you are already logged in with:

- **Instagram:** it requests your saved-posts list from Instagram's own web API, the same request the Instagram website makes. To authorize that request it reads the page's `csrftoken` cookie value and sends it back to instagram.com as a request header. The value is not stored.
- **X:** it reads the bookmark responses that X's own page loads while the extension scrolls your bookmarks.
- **Both:** it downloads the media files of those posts from the sites' media servers, and, when you press Clean, clicks the page's own save or bookmark button to remove the save.

It never reads or stores your password, and it does not read anything outside the posts in your saved list and bookmarks.

## What it stores, and where

- **In the browser (`chrome.storage.local`):** for each post, its Instagram code or X id, author name, date, link, caption, the names of the files saved and whether it was cleaned; the popup's settings (the "First N" number and the X bookmarks address); and the progress of the current or last job. This stays in your browser profile. "Reset records" in the popup deletes it, and so does removing the extension.
- **In your Downloads folder:** the media files, `posts.csv` and the optional Markdown files, under `instagram-x-saved/`. They are ordinary files on your computer. The extension does not upload them and does not delete them.

## Network access

The only network requests are the ones your own browser makes to instagram.com, x.com and their media servers (`cdninstagram.com`, `fbcdn.net`, `twimg.com`) to do what you asked. The extension sends nothing to its developer or to any third party.

## Permissions

| Permission | Reason |
| --- | --- |
| `downloads` | Save media, the index and the Markdown files, and check that a file is complete and still present. |
| `storage` | Remember per-post progress, settings and job progress. |
| `scripting` | Read the saved list, scroll the bookmarks page and click the page's own save button in the tab you started from. |
| `offscreen` | Create the blob URLs that the CSV and Markdown downloads need. |
| Host access to instagram.com, x.com, twimg.com, cdninstagram.com | Run on those sites and fetch their media. |

## Your responsibility

The posts you download belong to their authors. Use the extension on your own account for your own backup, respect copyright, and be aware that Instagram's and X's terms of service restrict automated access. The extension is not affiliated with or endorsed by Instagram, Meta or X.

## Changes and contact

If this policy changes, the new version and its date will be published at this address. Questions: mrtkry@yahoo.com.

---

# Gizlilik Politikası — Kayıtlı Gönderileri Temizle

Son güncelleme: 2026-11-19.

**Kayıtlı Gönderileri Temizle hiçbir veri toplamaz, iletmez, satmaz ya da paylaşmaz.** Sunucusu, hesabı, analitiği, reklamı yoktur ve uzaktan kod yüklemez. Yaptığı her şey bilgisayarınızda, tarayıcınızda gerçekleşir.

## Eklentinin okudukları

Popup'taki bir düğmeye bastığınızda eklenti, başlattığınız instagram.com veya x.com sekmesinde, zaten açık olan oturumunuzla çalışır:

- **Instagram:** kaydedilenler listenizi Instagram'ın kendi web API'sinden ister; Instagram sitesinin yaptığı istekle aynıdır. İsteği yetkilendirmek için sayfanın `csrftoken` çerezinin değerini okur ve istek başlığı olarak instagram.com'a geri gönderir. Değer saklanmaz.
- **X:** eklenti yer işaretlerinizi kaydırırken X sayfasının kendi yüklediği yer işareti yanıtlarını okur.
- **İkisi de:** bu gönderilerin medya dosyalarını sitelerin medya sunucularından indirir; Temizle'ye bastığınızda sayfanın kendi kaydet ya da yer işareti düğmesine tıklayarak kaydı kaldırır.

Parolanızı hiçbir zaman okumaz veya saklamaz; kaydedilenler listeniz ve yer işaretleriniz dışındaki hiçbir şeyi okumaz.

## Neyi, nerede saklar

- **Tarayıcıda (`chrome.storage.local`):** her gönderi için Instagram kodu veya X kimliği, yazar adı, tarih, bağlantı, açıklama, kaydedilen dosyaların adları ve temizlenip temizlenmediği; popup ayarları ("İlk N" sayısı ve X yer işaretleri adresi); geçerli ya da son işin ilerlemesi. Bunlar tarayıcı profilinizde kalır. Popup'taki "Kayıtları sıfırla" bunları siler; eklentiyi kaldırmak da siler.
- **İndirilenler klasöründe:** medya dosyaları, `posts.csv` ve isteğe bağlı Markdown dosyaları, `instagram-x-saved/` altında. Bilgisayarınızdaki sıradan dosyalardır. Eklenti onları yüklemez ve silmez.

## Ağ erişimi

Tek ağ istekleri, istediğiniz işi yapmak için kendi tarayıcınızın instagram.com, x.com ve medya sunucularına (`cdninstagram.com`, `fbcdn.net`, `twimg.com`) yaptıklarıdır. Eklenti geliştiricisine veya herhangi bir üçüncü tarafa hiçbir şey göndermez.

## İzinler

| İzin | Gerekçe |
| --- | --- |
| `downloads` | Medyayı, indeksi ve Markdown dosyalarını kaydetmek; bir dosyanın tamam ve yerinde olduğunu denetlemek. |
| `storage` | Gönderi başına ilerlemeyi, ayarları ve iş ilerlemesini hatırlamak. |
| `scripting` | Kayıt listesini okumak, yer işaretleri sayfasını kaydırmak ve başlattığınız sekmede sayfanın kendi kaydet düğmesine tıklamak. |
| `offscreen` | CSV ve Markdown indirmeleri için gereken blob adreslerini üretmek. |
| instagram.com, x.com, twimg.com, cdninstagram.com sitelerine erişim | Bu sitelerde çalışmak ve medyalarını indirmek. |

## Sorumluluk

İndirdiğiniz gönderiler yazarlarına aittir. Eklentiyi kendi hesabınızda, kendi yedeğiniz için kullanın, telif haklarına saygı gösterin ve Instagram'ın ve X'in hizmet şartlarının otomatik erişimi kısıtladığını unutmayın. Eklenti Instagram, Meta veya X ile bağlantılı değildir, onlarca onaylanmamıştır.

## Değişiklikler ve iletişim

Politika değişirse yeni sürümü ve tarihi bu adreste yayımlanır. Sorular: mrtkry@yahoo.com.
