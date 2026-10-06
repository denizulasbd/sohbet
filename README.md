# Sohbet

Electron + React + Vite + TypeScript ile yazılmış minimal AI sohbet uygulaması.
Sağlayıcılar: OpenRouter ve Ollama. Ayarlardan OpenAI uyumlu başka bir sunucu da eklenebilir.

## Çalıştırma
    npm install
    npm run dev      # geliştirme (hot reload)
    npm start        # derleyip çalıştır
    npm run dist     # kurulum paketi (Win/Mac/Linux)

İlk açılışta kenar çubuğunun altındaki ayar simgesinden bir sağlayıcı seçip API anahtarını girin.
Yerel model için: Ollama kullanıyorsanız adres `http://localhost:11434/v1`, anahtar boş.

## Yapı
- `electron/main.cjs` – pencere, sohbet/ayar dosyaları, anahtar şifreleme (safeStorage), akış (IPC)
- `electron/providers.cjs` – Anthropic ve OpenAI uyumlu akış istemcileri
- `electron/preload.cjs` – renderer'a güvenli köprü (`window.api`)
- `electron/db.cjs` – SQLite veritabanı (`app.db`) ve şema göçleri
- `electron/archive.cjs` – projeler, dosya arşivi, metin çıkarma kuyruğu (IPC)
- `electron/jobs.cjs` – arka plan iş kuyruğu (tek yardımcı süreç, öncelikli)
- `electron/extract-worker.mjs` – yardımcı süreç: metin çıkarma ve parçalama, OCR (Tesseract), sayfa görseli, gömme (transformers.js)
- `electron/chunker.cjs` – parçalama ve arama normalizasyonu (Türkçe harf katlaması)
- `electron/search.cjs` – arama indeksi (FTS5 trigram), not indeksleme, `searchKnowledge`
- `electron/quiz.cjs` – proje quiz'i: kaynak toplama, soru üretimi (JSON), denemeler, puanlama ve genel yorum (IPC)
- `electron/knowledge.cjs` – sohbette `@proje`: modelin arama/okuma araçları, `[K#]` kaynak etiketleri, araç desteklemeyen modeller için yedek yol
- `src/` – React arayüzü (App, Sidebar, Settings, Markdown, ProjectPage, SourceViewer, QuizSetup, QuizRunner, QuizResult…)

Veriler kullanıcı veri klasöründe (`userData`) `chats.json` ve `settings.json` olarak tutulur.
Projeler ve dosya arşivi `app.db` içinde, yüklenen dosyaların kopyaları `files/` klasöründe durur.
OCR dil dosyaları `tessdata/`, anlamsal arama modeli `models/` klasörüne ilk kullanımda indirilir (Ayarlar → Arşiv ve arama).
`better-sqlite3` yerel bir modüldür; `npm install` sonunda Electron'a göre otomatik derlenir (`postinstall`). Electron sürümü değişirse `npm install`'ı yeniden çalıştırın.
Kısayollar: Ctrl+N yeni sohbet, Ctrl+K arama, Ctrl+, ayarlar.

## Düşünme (reasoning)
Düşünen bir model seçilince yazı alanında **DÜŞÜNME** sayacı belirir (Kapalı / Düşük / Orta / Yüksek).
Model cevabı hazırlarken **düşünme penceresi** canlı açılır (süre, token, hız, adım adım akış); cevap başlayınca daralır, başlığa tıklayınca yeniden açılır.
- Seviye sağlayıcıya göre çevrilir: Claude → `adaptive` + `effort`, reddedilirse `budget_tokens`; OpenRouter → `reasoning.effort`; OpenAI/yerel → `reasoning_effort`. Model bir parametreyi 400/422 ile reddederse sıradaki seçenek denenir ve çalışan seçenek model + seviye başına hatırlanır; model ayarı hiç kabul etmezse düşünme penceresinde belirtilir.
- Düşünce metni `thinking_delta`, `reasoning_content` / `reasoning` alanlarından veya `<think>…</think>` etiketlerinden okunur. Bazı sağlayıcılar metni göndermez; o durumda yalnızca süre/token gösterilir.
- Model kimliğinden otomatik algılanır; yanlışsa Ayarlar → Model → “Düşünme desteği” ile model bazında değiştirilir.

## Quiz
Proje sayfasındaki **Quiz oluştur** düğmesi, projenin dosya ve notlarından o an seçili modelle quiz üretir (zorluk, odak noktası, soru türü, soru sayısı; isteğe bağlı kaynak seçimi).
- Üretim iki adımdır: önce uygulama kaynak parçalarını toplar (odak varsa modelin ürettiği 3–5 sorguyla arama, yoksa dosya ve sayfalara dengeli örnekleme), sonra model yalnızca bu `[K#]` etiketli parçalardan JSON olarak soru üretir. Kaynak yetersizse soru uydurulmaz; uyarı gösterilir ve daha az soruyla devam etmek teklif edilir.
- Çıktı için model destekliyorsa `response_format` (JSON şeması) kullanılır; desteklemiyorsa düz JSON istenir, zod ile doğrulanır ve hatalıysa bir kez yeniden denenir (`providers.cjs` → `completeJson`).
- Seçeneklerin sırasını uygulama karıştırır; doğru cevabın konumu quiz genelinde dengelidir.
- Cevaplar yazıldıkça kaydedilir; yarım kalan quiz kaldığı yerden devam eder. Teslimde çoktan seçmeli sorular yerelde, klasik sorular modelle (0–100) puanlanır; ardından model genel bir yorum yazar. Puanlama yarıda kalırsa sonuç ekranından yeniden denenir.
- Veriler `app.db` içindedir (`quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_answers`). `quiz_sources` üretimde kullanılan parçaların kopyasını tutar: kaynak etiketleri yeniden indekslemeden etkilenmez, kaynak silinirse etiket "kaynak silindi" olarak görünür.

## Web araması
Mesaj kutusundaki **Web** düğmesi açıkken isteğe OpenRouter'ın `openrouter:web_search` sunucu aracı eklenir; model gerek görürse arar. Yalnızca OpenRouter'da ve araç destekleyen modellerde çalışır.
- Arama OpenRouter tarafında yürür; uygulamanın araç döngüsüne düşmez. Sonuçlar `annotations` içinde `url_citation` olarak gelir ve sohbet boyunca sabit `[W#]` numarası alır. Model kaynağı metne bağlantı olarak yazar; bağlantı `[W#]` etiketine çevrilir.
- Motor, sınırlar ve arama birim fiyatı `electron/web-search.config.cjs` içindedir. Arama sayısı ve ücreti cevabın altında görünür.
- Varsayılan durum: Ayarlar → API ve model. Web kaynağı "Projeye kaydet" ile seçilen projede nota dönüşür.

## Kurulum yavaşsa
Ağır kısım Electron'un kendi ikili dosyası (~100 MB). Takılırsa şunu deneyin:

    # Windows (PowerShell)
    $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; npm install
    # macOS / Linux
    ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

`npm run dist` (kurulum paketi) ilk çalıştırmada electron-builder'ı ayrıca indirir; sadece geliştiriyorsanız gerekmez.

## Modlar: Akademik Koç ve Yaşam Koçu
Uygulama iki moda ayrılır; ikisi aynı veritabanını ve aynı hafızayı kullanır (plan: `docs/yasam-kocu-plan.md`).
- **Akademik Koç:** sohbet, notlar, projeler, dosya arşivi, quiz. **Yaşam Koçu:** Bugün ekranı, takvim, alışkanlık takibi, yaşam projeleri. Mod adları `src/modes.ts` içindedir.
- `electron/coach.cjs` – koç modunun sabit güvenlik talimatları (ayarlardan değiştirilemez).
- `electron/memory-tools.cjs` – hafıza alanları (akademik / yaşam / genel), "sadece bu modda" süzgeci ve `search_memory` aracı.
- `electron/calendar.cjs` – `events` tablosu, tekrarlayan etkinlikler (`rrule`), `list_events` / `create_event` / `update_event` / `delete_event`.
- `electron/trackers.cjs` – `trackers` ve `tracker_entries`, `list_trackers` / `get_tracker_summary` / `log_entry` / `create_tracker`.
- `electron/today.cjs` – Bugün ekranının günlük özeti (günde bir kez üretilir, `meta` tablosunda saklanır).
- Modelin yaptığı her yazma (not, etkinlik, takip) aynı öneri → onay kartı → geri al hattından geçer; yalnızca `log_entry` onaysız kaydeder ve sohbetten geri alınır.
- Ayarlar → Modüller: Yaşam Koçu modu tümüyle, takvim ve takip ayrı ayrı kapatılabilir; kapalı modülün araçları modele gönderilmez. Veriler yalnızca bu bilgisayarda durur; dışarı çıkan tek şey seçili model sağlayıcısına giden isteklerdir.
