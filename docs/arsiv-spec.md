# Dosya Arşivi ve Proje Bilgi Tabanı — Uygulama Spesifikasyonu

## Bağlam

Bu repo, öğrencilere yönelik bir AI sohbet uygulaması: Electron + React + Vite + TypeScript. Birden fazla API sağlayıcısını destekliyor (OpenRouter dahil). Mevcut özellikler: sohbet arayüzü, not alma arayüzü, kişisel hafıza sistemi.

Bu spesifikasyon üç şey ekliyor:
1. Projeler altında düzenlenen bir dosya arşivi (PDF, TXT, MD; ileride PPTX/DOCX).
2. Notlar ve dosyalar için ortak bir arama indeksi.
3. Sohbette `@proje` ile proje seçildiğinde modelin bu indekste araçlarla kendi kendine arama yapması ve kaynak göstererek cevap vermesi.

## Çalışma şekli

- Kod yazmadan önce mevcut kodu incele: notların nasıl ve nerede saklandığı, sohbet ve sağlayıcı katmanının yapısı, IPC düzeni, varsa mevcut veritabanı. Bulduklarını ve bu spesifikasyonu mevcut yapıya nasıl uyarlayacağını kısa bir plan olarak yaz ve onayımı bekle.
- Spesifikasyon ile mevcut kod çeliştiğinde mevcut yapıyı koru ve bana sor. Gereksiz büyük yeniden yazımlar yapma.
- Fazları sırayla uygula. Her fazın sonunda dur ve şunları özetle: ne yaptın, ben nasıl test edeceğim, bilinen eksikler neler. Ben onaylamadan sonraki faza geçme.
- Mevcut sohbet, not ve hafıza özelliklerini bozma.
- Arayüz metinleri Türkçe ve mevcut koyu temayla uyumlu olsun.
- TypeScript strict; IPC kanalları tipli olsun.

## Mimari kararlar

- Veritabanı: `better-sqlite3`, main süreçte, `userData/app.db`. Mevcut bir veritabanı varsa onu kullan. Tek yazıcı main süreç olsun.
- Yüklenen dosyalar `userData/files/<uuid>.<uzantı>` altına kopyalanır; orijinal dosya yoluna bağımlı kalınmaz.
- Metin çıkarma, parçalama ve (ileride) embedding işleri Electron `utilityProcess` içinde çalışır; sonuçları main sürece gönderir, main veritabanına yazar. Arayüz hiçbir zaman donmamalı.
- Her dosyanın işlem durumu (`queued` / `processing` / `ready` / `error`) arayüzde görünür.
- Renderer veritabanına doğrudan erişmez; her şey preload üzerinden tipli IPC ile yapılır.

## Veri modeli

Mevcut not şemasına göre uyarla; aşağıdaki yapı hedeftir.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ders',      -- 'ders' | 'kisisel'
  created_at INTEGER NOT NULL
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at INTEGER NOT NULL
);

-- notes tablosuna project_id (NULL = "Genel") eklenir

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  project_id TEXT,
  source_type TEXT NOT NULL,              -- 'file' | 'note'
  source_id TEXT NOT NULL,
  page INTEGER,                            -- not ve düz metinde NULL
  heading TEXT,
  text TEXT NOT NULL,                      -- gösterim için orijinal metin
  norm_text TEXT NOT NULL                  -- arama için normalize metin
);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  norm_text, content='chunks', content_rowid='id', tokenize='trigram'
);
-- chunks ile chunks_fts'yi senkron tutan trigger'lar eklenmeli

CREATE TABLE links (
  note_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  page INTEGER
);
```

## Faz 1 — Projeler ve dosya arşivi

- Projeler: oluştur, yeniden adlandır, sil. Silmede onay iste ve projenin dosyalarının da silineceğini belirt.
- Kenar çubuğunda "Dersler" ve "Kişisel projeler" grupları (`kind` alanına göre).
- Mevcut notlar bir projeye atanabilsin; projesiz notlar "Genel" altında kalsın.
- Dosya yükleme: sürükle-bırak ve dosya seçici. Bu fazda PDF, TXT ve MD.
- Metin çıkarma: PDF için `pdfjs-dist` ile sayfa sayfa; her sayfanın metni ayrı tutulur. TXT/MD doğrudan okunur.
- Bir PDF sayfasından çok az metin çıkıyorsa (örneğin 20 karakterden az) o sayfayı OCR gerekiyor olarak işaretle. OCR Faz 5'te.

Kabul kriteri: Bir projeye 50+ sayfalık bir PDF yükleyebiliyorum, arayüz donmuyor, durum "hazır" oluyor, dosyayı proje içinde listeleyip silebiliyorum.

## Faz 2 — Parçalama ve arama

- Parçalama: yaklaşık 2000–3000 karakter, yaklaşık 300 karakter örtüşme. Paragraf ve başlık sınırlarına saygı göster. Bir parça PDF sayfa sınırını aşmasın; kaynak gösterme için her parça tek bir sayfaya ait olmalı.
- Notlar da aynı tabloya parçalanır (`source_type = 'note'`). Not kaydedildiğinde (yaklaşık 2 sn debounce) eski parçaları silinip yeniden oluşturulur. Not veya dosya silinince parçaları da silinir.
- Türkçe normalizasyon: indekslerken ve ararken metni `toLocaleLowerCase('tr-TR')` ile küçült (İ/I ve ı/i sorunları için). Normalize metin `norm_text`'e, orijinal metin `text`'e yazılır.
- Trigram tokenizer 3 karakterden kısa sorguları eşleştirmez; kısa terimlerde `LIKE` aramasına düş.
- FTS5 sorgu sözdizimi: kullanıcıdan veya modelden gelen sorguları güvenli hale getir (terimleri tırnakla, özel karakterleri kaçır). Sözdizimi hatası uygulamayı asla düşürmemeli.
- `searchKnowledge(projectId, query, limit = 8)`: bm25 ile sıralı. Dönen her sonuç: `chunkId`, `sourceType`, `sourceId`, `sourceName`, `page`, `text`.
- Proje sayfasına basit bir arama kutusu ekle (hem test hem kullanıcı için).

Kabul kriteri: "geriye melezleme" araması, içinde "geriye melezlemenin" geçen PDF sayfasını ve ilgili notu birlikte buluyor; başka projelerin içeriği sonuçlara karışmıyor.

## Faz 3 — @proje ve araçla arama

- Sohbet girdisinde `@` yazılınca proje listesi açılsın (yazdıkça filtrelensin, klavyeyle seçilebilsin). Seçilen proje bir etikete (chip) dönüşsün. `projectId` mesajla birlikte ayrı bir alan olarak gitsin; metnin içine gömülmesin. Şimdilik mesaj başına tek proje yeterli.
- Modele iki araç verilir:
  - `search_knowledge(query: string)`: seçili projede notlar ve dosyalar içinde arar.
  - `read_source(source_id: string, pages?: string)`: bir dosyanın belirli sayfalarını (örneğin "12-14") veya bir notun tamamını okur.
- `projectId` araç parametresi DEĞİLDİR. Uygulama @ etiketinden kendisi ekler; model seçili projenin dışına çıkamaz.
- Araç döngüsü: cevapta tool call olduğu sürece aracı çalıştır, sonucu mesajlara ekle, modeli tekrar çağır. En fazla 5 tur. Arama sırasında arayüzde "Aranıyor: …" gibi bir durum satırı göster.
- Araç sonuçlarında her parçaya kısa bir kaynak etiketi ver: `[K1]`, `[K2]` … Etiketlerin hangi dosya/nota ve sayfaya karşılık geldiğini uygulama sohbet bazında saklar. Tek bir araç sonucu en fazla 8 parça içerir.
- Proje seçiliyken sistem talimatına şunlar eklenir:
  - Cevaplamadan önce arama yap; tek sonuçla yetinme, farklı terimler, eş anlamlılar ve İngilizce karşılıklar dene.
  - Kaynaklardan kullandığın her bilgiyi ilgili `[K#]` etiketiyle işaretle.
  - Kaynaklarda bulunmayan bir bilgiyi kaynakta varmış gibi sunma. Kaynaklarda bulamazsan bunu açıkça söyle; genel bilgiyle tamamlıyorsan bunu belirt.
- Yedek yol: Model araç desteklemiyorsa (OpenRouter models API'sinde `supported_parameters` içinde `tools` yoksa) kullanıcının mesajıyla doğrudan `searchKnowledge` çalıştır ve ilk 8 parçayı etiketli şekilde sistem mesajına ekle.
- Araç çağrısını mevcut sağlayıcı katmanına uygun biçimde ekle (OpenAI uyumlu format; doğrudan Anthropic API kullanılan bir yol varsa onun formatı).

Kabul kriteri: "@bitki ıslahı bana geriye melezlemeyi anlat" mesajında model en az bir arama yapıyor, cevapta `[K#]` etiketleri bulunuyor ve etiketler doğru dosya ve sayfaya karşılık geliyor. Araç desteklemeyen bir modelde de cevap kaynaklı geliyor.

## Faz 4 — Kaynak gösterme ve bağlantılar

- Cevaptaki `[K#]` etiketleri tıklanabilir chip olarak gösterilir. Kaynak dosyaysa uygulama içi PDF görüntüleyici (`pdfjs-dist`) ilgili sayfada açılır; nottaysa not açılır.
- Not editöründe `[[dosya adı#sayfa]]` sözdizimi: yazarken otomatik tamamlama, tıklanınca dosya o sayfada açılır, bağlantı `links` tablosuna yazılır.
- Not görünümünde "İlgili kaynaklar" paneli: notun metniyle aynı projede arama yapıp en iyi 5 dosya parçasını gösterir.

Kabul kriteri: Cevaptaki bir kaynak etiketine tıklayınca PDF doğru sayfada açılıyor; nottaki `[[...]]` bağlantısı çalışıyor.

## Faz 5 — Genişletmeler

- PPTX (`officeparser` veya slayt XML'lerinin doğrudan okunması; her slayt bir sayfa sayılır) ve DOCX (`mammoth`) desteği.
- OCR: işaretlenmiş sayfalar için `tesseract.js` (tur + eng). Ayarlardan seçilirse sayfa görselini görsel destekli bir modele gönderme seçeneği.
- Anlamsal arama: `sqlite-vec` ve `transformers.js` ile yerel çok dilli embedding modeli (örneğin multilingual-e5-small). FTS ve vektör sonuçları Reciprocal Rank Fusion ile birleştirilir. Kullanılan embedding modelinin adı veritabanında saklanır; model değişirse tüm parçalar yeniden indekslenir.

## Bilinen tuzaklar

- `better-sqlite3` ve `sqlite-vec` native modüllerdir: Electron'un Node ABI'sine göre yeniden derlenmeleri gerekir (`@electron/rebuild` veya electron-builder `install-app-deps`). Paketlemede `asarUnpack` gerekebilir.
- `pdfjs-dist` worker'ı Vite ve Electron ortamında ayrıca yapılandırılmalı. Node tarafında (utilityProcess) legacy build gerekebilir.
- Türkçe büyük/küçük harf dönüşümünde `toLowerCase()` değil `toLocaleLowerCase('tr-TR')` kullanılmalı.
- Araç sonuçlarının toplam boyutu sınırlı tutulmalı; aksi halde uzun sohbetlerde bağlam hızla dolar.
