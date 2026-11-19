# Kayıtlı Gönderileri Temizle — Chrome eklentisi

Instagram **kaydedilenlerinizi** ve X **yer işaretlerinizi** bilgisayarınıza yedekleyin, sonra yalnızca tamamen inen gönderilerin kaydını kaldırın. Kendi tarayıcı sekmenizde çalışır; hiçbir yere veri gönderilmez ([gizlilik](../PRIVACY.md)). English: [README.md](README.md).

Chrome 116 veya üstü gerekir. Arayüz tarayıcı diline uyar (Türkçe veya İngilizce).

## Kurulum (paketlenmemiş)

1. `chrome://extensions` adresini açın ve **Geliştirici modu**nu açın.
2. **Paketlenmemiş öğe yükle**'ye tıklayıp bu `extension/` klasörünü seçin.
3. Oturum açık bir instagram.com veya x.com sekmesi açın ve eklenti simgesine tıklayın.

## Kullanım

| Düğme | Ne yapar |
| --- | --- |
| **İndir** | Tüm görselleri ve videoları (carousel'in bütün slaytları, en yüksek kalite) indirir ve `posts.csv` yazar. İstediğiniz zaman yeniden çalıştırın: diskte olan dosyalar atlanır, yeni kayıtlar eklenir. |
| **Temizle** | Dosyaları tamamen diskte olan gönderilerin kaydını ya da yer işaretini kaldırır. Geri alınamaz. Önce indirme klasörünü yedekleyin, sonra onay kutusunu işaretleyin. |
| **NotebookLM için dışa aktar** | İki site için Markdown kaynakları yazar (yazar, tarih, bağlantı, açıklama); dosya başına en çok 300.000 kelime. |
| **Durdur** | Geçerli adımı bitirip durur. İndeks yine yazılır. |
| **Kayıtları sıfırla** | Eklentinin hatırladıklarını siler. İnen dosyalara dokunulmaz; sonraki İndir onları `ad (1).jpg` olarak yeniden kaydeder. |

**İlk N gönderi** bir çalıştırmayı en yeni N gönderiyle sınırlar (İndir ve Temizle için). Boş bırakırsanız tüm gönderiler işlenir; Temizle bu durumda her çalıştırmada en çok 150 gönderi işler. **Yer işaretleri sayfa adresi** (yalnızca X) `https://x.com/i/bookmarks`; bazı hesaplarda `https://x.com/i/history`.

Önce N = 3 ile deneyin: İndir, dosyaları kontrol edin, sonra N = 3 ile Temizle'yi çalıştırıp üç gönderinin kaydının kalktığını doğrulayın.

İş sürerken başlattığınız sekmeyi açık ve önde tutun. Instagram'da İndir, listeyi sayfadan ayrılmadan okur; X'te sekmeyi yer işaretleri adresinde yeniden yükleyip kaydırır; Temizle sekmeyi gönderiden gönderiye gezdirir. Popup'ı kapatmak işi durdurmaz; ilerlemeyi görmek için yeniden açın.

## Dosyalar nereye iner

```
Downloads/instagram-x-saved/instagram/   2026-01-02_kullanici_KOD_01.jpg ... posts.csv
Downloads/instagram-x-saved/x/           2026-01-02_kullanici_ID_01.mp4  ... posts.csv
Downloads/instagram-x-saved/notebooklm/  instagram_saved_posts.md, x_saved_posts.md
```

`posts.csv` sütunları `date,user,link,files,caption` (Excel okusun diye BOM'lu UTF-8). `files` Chrome'un gerçekten kaydettiği adları listeler. CSV her çalıştırmada yeniden yazılır; bir hesap tablosunda açıksa Chrome yanına `posts (1).csv` kaydeder.

## Güvenliği nasıl sağlar

- **Yalnızca tamamen inen gönderiler temizlenir.** Bir gönderinin her dosyası Chrome'un indirme geçmişinde tamamlanmış olmalı ve hâlâ diskte durmalı; bu iki kez denetlenir. Taşıdığınız ya da sildiğiniz dosyanın gönderisi kayıtlı kalır; günlük kaç gönderiye dokunulmadığını söyler, İndir dosyayı yeniden indirir.
- **Yalnızca metinden oluşan bir X yer işareti**, son güncellemesinden sonra `posts.csv` yazıldıysa temizlenir.
- **Kayıt kaldırma sayfada doğrulanır** (simge geri döner); ancak ondan sonra gönderi temizlenmiş sayılır.
- **Yavaş ve nazik.** instagram.com ve x.com'a istekler arasında 2–5 saniye (liste ve gönderi sayfaları); medya CDN'lerinden dosyalar arasında 0,5–1,5 saniye (bunlar sitelerin API'si değildir).
- **Erken durur:** art arda üç hatada, oturum duvarında ya da HTTP 429'da.
- **Kaldığı yerden devam eder.** Aynı düğmeye yeniden basın; biten gönderiler ve dosyalar atlanır. Chrome iş sürerken eklentinin arka plan işçisini durdurursa popup "Yarıda kesildi" der; yeniden çalıştırmak devam ettirir.
- **Yalnızca sitelerin kendi CDN'lerinden** (`twimg.com`, `cdninstagram.com`, `fbcdn.net`) https medyası indirilir; sayfa ne gönderirse göndersin.

## Bilmeniz gerekenler

- **Hizmet şartları.** Instagram ve X'i otomatikleştirmek şartlarına aykırıdır. Kendi hesabınızda, kendi riskinizle kullanın; büyük koleksiyonları birkaç güne yayın.
- **Chrome ayarları.** Chrome indirme ayarlarında *İndirmeden önce her dosyanın kaydedileceği yeri sor* seçeneğini kapatın; yoksa Chrome her dosya için sorabilir. Chrome her dosya için indirme balonunu da gösterir.
- **Depolama.** Eklenti `chrome.storage.local` içinde gönderi başına yaklaşık 1 KB tutar; Chrome bunu 10 MB ile sınırlar. Dolarsa iş bir mesajla durur; *İlk N* ile turlar hâlinde çalışın.
- **Arayüz dili.** Instagram'da kayıt kaldırma İngilizce ve Türkçe arayüzü tanır. Başka dil için kaydet düğmesinin etiketini `lib/instagram.js` içindeki `pageSaveState` ve `pageClickUnsave` işlevlerine ekleyin.
- **Siteler değişir.** Temizleme adımı başarısız olursa popup günlüğü gönderiyi söyler. Instagram ve X sayfalarını istedikleri zaman değiştirebilir.

## İzinler

| İzin | Ne için |
| --- | --- |
| `downloads` | Medya, indeks ve Markdown dosyalarını kaydetmek; bir dosyanın tamam ve yerinde olduğunu denetlemek. |
| `storage` | Gönderi başına ilerlemeyi, popup ayarlarını ve iş ilerlemesini hatırlamak. |
| `scripting` | Kayıt listesini oturumunuzla okumak, X yer işaretlerini kaydırmak ve başlattığınız sekmede sayfanın kendi kaydet düğmesine tıklamak. |
| `offscreen` | CSV ve Markdown dosyalarını blob adresi olarak üretmek; service worker bunu yapamaz. |
| `*://*.instagram.com/*`, `*://x.com/*` | Bu sayfalarda çalışmak. |
| `*://*.twimg.com/*`, `*://*.cdninstagram.com/*` | Dosyaların geldiği medya CDN'leri. |

## Geliştirme

```
node --test tests/              # ayrıştırma, güvenlik kuralları ve iş motoru (sahte sayfalarla)
python store/make_icons.py      # extension/icons dosyalarını yeniden üretir
python store/pack.py            # dist/clean-your-saved-posts-<sürüm>.zip üretir
```
