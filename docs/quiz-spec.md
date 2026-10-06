# Proje Quiz'i — Uygulama Spesifikasyonu

## Bağlam

Uygulamada projeler, proje bazlı dosya arşivi ve notlar, ortak arama indeksi (`chunks`, `searchKnowledge`), `[K#]` kaynak etiketleri, kaynak chip bileşeni ve sayfaya gidebilen PDF görüntüleyici zaten var. Bu iş, bir projenin materyallerinden yapay zekâ ile quiz oluşturmayı, quiz'i çözmeyi ve sonuçları yapay zekâya yorumlatmayı ekliyor.

## Kapsam

- Bu işte YALNIZCA quiz var. Flashcard, aralıklı tekrar ve zayıf konu takibi bu işin parçası değil; ekleme.
- Yine de her sorunun kaynak parçasını ve her cevabın doğruluğunu sakla; ileride bu veriler üzerine kurulacak özellikler için gerekli.

## Çalışma şekli

- Kod yazmadan önce mevcut proje sayfasını, indeks/arama katmanını, sağlayıcı katmanını ve kaynak/chip sistemini incele. Kısa bir plan yaz ve onayımı bekle.
- Mevcut özellikleri bozma. Paketleme veya release işlemi yapma.
- Arayüz metinleri Türkçe ve mevcut temayla uyumlu olsun.

## Akış

### 1. Quiz ayarları

Proje sayfasında "Quiz oluştur" düğmesi. Tıklanınca açılan pencerede:

- **Zorluk:** Kolay / Orta / Zor
- **Odak noktası:** Serbest metin (örn. "geriye melezleme"). Boş bırakılırsa tüm proje kapsanır. İsteğe bağlı olarak belirli dosya veya notlar da seçilebilsin.
- **Soru türü:** Çoktan seçmeli / Klasik / Karışık
- **Soru sayısı:** 5 / 10 / 15 / 20 (varsayılan 10)

### 2. Quiz üretimi (iki adımlı)

Üretim iki ayrı adımda yapılır; araç döngüsü ile JSON çıktısını aynı çağrıda birleştirme.

**Adım A — Kaynak toplama (uygulama tarafında):**
- Odak noktası verildiyse: Modelden odak metni için 3–5 farklı arama sorgusu üretmesini iste (eş anlamlılar ve İngilizce karşılıklar dahil). Her sorguyla `searchKnowledge` çalıştır, sonuçları tekilleştir, en fazla ~25 parça topla.
- Odak noktası yoksa veya belirli dosyalar seçildiyse: Arama yapma. Seçilen kaynakların (ya da tüm projenin) parçalarından dosyalara ve sayfalara dengeli dağılacak şekilde en fazla ~30 parça örnekle. Amaç kapsamın tamamından soru çıkması.
- Bulunan parça sayısı istenen soru sayısı için yetersizse, uydurma soru üretme. Kullanıcıya "Bu konuda projede yeterli kaynak bulunamadı" uyarısını göster ve daha az soruyla devam etmeyi teklif et.

**Adım B — Soru üretimi:**
- Toplanan parçaları `[K1]`, `[K2]` … etiketleriyle ve ayarlarla birlikte modele gönder.
- Çıktı yapılandırılmış JSON olsun. Model `response_format` ile JSON şemasını destekliyorsa onu kullan; desteklemiyorsa JSON iste, zod ile doğrula, hatalıysa bir kez tekrar dene, yine olmazsa anlaşılır bir hata göster.
- Şema:

```json
{
  "title": "string",
  "questions": [
    {
      "type": "mcq | open",
      "prompt": "string",
      "options": ["string", "string", "string", "string"],
      "correct_index": 0,
      "model_answer": "string",
      "key_points": ["string"],
      "explanation": "string",
      "sources": ["K3"]
    }
  ]
}
```

  - `mcq` sorularında tam 4 seçenek ve tek doğru cevap olmalı; `model_answer` ve `key_points` boş olabilir.
  - `open` (klasik) sorularda `options` ve `correct_index` boş; `model_answer` ideal cevap, `key_points` puanlamada aranacak ana noktalar.
  - Her soruda en az bir kaynak etiketi zorunlu.
- Üretim talimatında şunlar yer alsın:
  - Sorular YALNIZCA verilen kaynak parçalardan üretilmeli; kaynakta olmayan bilgi soru veya cevap olamaz.
  - Zorluk tanımları: **Kolay** = tanım ve temel bilgiyi hatırlama; **Orta** = kavramları açıklama ve ilişkilendirme; **Zor** = uygulama, senaryo, karşılaştırma ve analiz.
  - Çoktan seçmeli sorularda yanlış seçenekler makul ve aynı konudan olmalı; "hepsi" / "hiçbiri" gibi seçenekler kullanılmamalı.
  - Aynı bilgi birden fazla soruda sorulmamalı.
- Seçeneklerin sırasını uygulama karıştırsın (modeller doğru cevabı belirli harflere yığma eğiliminde); `correct_index` karıştırmadan sonra güncellenir.
- Üretim sırasında ilerleme göster: "Kaynaklar taranıyor…", "Sorular hazırlanıyor…".
- Üretim için o an seçili model kullanılır.

### 3. Quiz çözme

- Her ekranda bir soru; ileri/geri gezinme ve soru numaralarından atlama.
- Çoktan seçmelide seçenek seçimi, klasikte metin alanı.
- Cevaplar yazıldıkça kaydedilsin; uygulama kapanırsa quiz kaldığı yerden devam edebilsin.
- Teslim etmeden önce doğru cevaplar veya kaynaklar gösterilmez. Boş soru varsa teslimde uyarı ver.

### 4. Puanlama ve yorum

- **Çoktan seçmeli:** Uygulama yerelde puanlar.
- **Klasik:** Model; soruyu, öğrencinin cevabını, `model_answer`, `key_points` ve ilgili kaynak parçaları alır. Her soru için 0–100 arası puan ve kısa geri bildirim üretir (neyi doğru yazdı, neyi eksik bıraktı). Çıktı JSON.
- **Genel yorum:** Tüm sorular, verilen cevaplar, doğru/yanlış durumu ve kaynak etiketleri modele gönderilir. Model JSON olarak şunları üretir:
  - `summary`: genel değerlendirme (birkaç cümle)
  - `strengths`: iyi olduğu konular
  - `weaknesses`: zorlandığı konular; her biri için kısa neden ve ilgili kaynak etiketleri
  - `recommendations`: somut sonraki adımlar (örn. hangi kaynağın hangi sayfalarına tekrar bakmalı)
- Yorum dili cesaretlendirici ama dürüst olsun; zayıf konuları yumuşatarak gizlemesin.

### 5. Sonuç ekranı

- Toplam puan.
- Soru soru inceleme: soru, öğrencinin cevabı, doğru cevap (veya klasikte ideal cevap ve geri bildirim), açıklama ve tıklanabilir kaynak chip'leri (PDF ilgili sayfada açılır).
- Yapay zekâ yorumu; zayıf konulardaki kaynak etiketleri de tıklanabilir.
- "Tekrar çöz" düğmesi (aynı quiz için yeni deneme).

### 6. Quiz geçmişi

Proje sayfasında o projenin quiz'leri listelensin: başlık, tarih, ayarlar ve son puan. Bir quiz'e tıklanınca son denemenin sonucu açılır.

## Veri modeli

Mevcut şemaya göre uyarla; hedef yapı:

```sql
CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  settings TEXT NOT NULL,              -- JSON: zorluk, odak, tür, sayı, seçili kaynaklar
  created_at INTEGER NOT NULL
);

CREATE TABLE quiz_questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL,                  -- 'mcq' | 'open'
  prompt TEXT NOT NULL,
  options TEXT,                        -- JSON
  correct_index INTEGER,
  model_answer TEXT,
  key_points TEXT,                     -- JSON
  explanation TEXT,
  source_chunk_ids TEXT NOT NULL       -- JSON: etiketlerin karşılık geldiği chunk id'leri
);

CREATE TABLE quiz_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  score REAL,
  interpretation TEXT                  -- JSON: genel yorum
);

CREATE TABLE quiz_answers (
  attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  answer TEXT,
  is_correct INTEGER,
  score REAL,
  feedback TEXT,
  PRIMARY KEY (attempt_id, question_id)
);
```

Kaynak etiketleri (`[K#]`) yalnızca model ile iletişimde kullanılır; veritabanında gerçek chunk id'leri saklanır. Kaynak dosya veya not sonradan silinirse quiz bozulmamalı; chip "kaynak silindi" olarak görünsün.

## Mobil

Telefon arayüzü mevcut mimaride proje verilerine erişebiliyorsa quiz çözme ve sonuç ekranları mobilde de çalışsın. Bu mimari olarak kolay değilse planda belirt ve bu işte yapma.

## Kabul kriterleri

- Bir projede "Quiz oluştur" → Orta, odak "geriye melezleme", Karışık, 10 soru seçildiğinde; quiz oluşuyor, her soruda kaynak etiketi var ve etiketler doğru dosya ve sayfaya gidiyor.
- Odak boş bırakıldığında sorular projedeki farklı dosyalara dağılıyor, tek bir dosyaya yığılmıyor.
- Projede hiç geçmeyen bir odak noktası girildiğinde uydurma soru üretilmiyor, uyarı gösteriliyor.
- Çoktan seçmeli sorularda doğru cevapların konumu dengeli dağılıyor.
- Uygulama quiz ortasında kapatılıp açıldığında cevaplar kaybolmuyor.
- Teslimden sonra klasik sorular puanlanıyor, genel yorum zayıf konuları kaynaklarıyla birlikte gösteriyor.
- Aynı quiz tekrar çözülebiliyor ve geçmişte son puan görünüyor.
