# Web Araması — Uygulama Spesifikasyonu

## Bağlam

Uygulamada sohbet için bir araç döngüsü (`search_knowledge`, `read_source`), `[K#]` kaynak etiketleri ve bunları gösteren chip bileşeni zaten var. Bu iş, OpenRouter'ın `openrouter:web_search` sunucu aracını (server tool) ekleyerek modelin gerektiğinde web'de arama yapmasını sağlıyor.

## Çalışma şekli

- Önce güncel dokümantasyonu oku: https://openrouter.ai/docs/guides/features/server-tools/web-search
- `:online` model varyantı ve `plugins: [{ id: "web" }]` yöntemi kullanımdan kaldırıldı. Bunları KULLANMA; yalnızca `openrouter:web_search` server tool'unu kullan.
- Kod yazmadan önce mevcut araç döngüsünü, sağlayıcı katmanını ve kaynak/chip sistemini incele. Kısa bir plan yaz ve onayımı bekle.
- Mevcut özellikleri bozma. Paketleme veya release işlemi yapma.

## Önemli teknik not

Server tool'lar OpenRouter tarafında çalıştırılır. Yani web araması, uygulamanın kendi araç döngüsüne `tool_calls` olarak DÜŞMEZ ve uygulama bunu yerelde çalıştırmaya çalışmamalıdır. Arama sonuçları, cevap mesajındaki `annotations` alanında `url_citation` nesneleri olarak gelir:

```json
{
  "type": "url_citation",
  "url_citation": {
    "url": "...", "title": "...", "content": "...",
    "start_index": 100, "end_index": 200
  }
}
```

Server tool ile mevcut istemci araçları (`search_knowledge`, `read_source`) aynı istekte birlikte gönderilecek. Bu kombinasyonun ve streaming sırasında annotation'ların nasıl geldiğinin doğru çalıştığını gerçek bir istekle ham yanıtı loglayarak doğrula.

## Gereksinimler

### 1. Araç tanımı

OpenRouter isteklerinde `tools` dizisine, mevcut istemci araçlarının yanına eklenir:

```json
{
  "type": "openrouter:web_search",
  "parameters": {
    "engine": "exa",
    "max_results": 5,
    "max_uses": 3,
    "max_total_results": 15
  }
}
```

Motor bilinçli olarak `exa`'ya sabitlendi; böylece her modelde aynı arama, aynı fiyat ve aynı sınırlar geçerli olur. Bu değerleri tek bir yapılandırma dosyasında sabit olarak tut.

### 2. Arayüz

- Mesaj kutusunda bir web araması düğmesi (🌐). Açıkken araç isteğe eklenir ve model gerekirse arar; kapalıyken araç hiç gönderilmez.
- Varsayılan durum (açık/kapalı) ayarlardan seçilebilsin.
- Akışta arama olayları görünüyorsa "Web'de aranıyor…" durum satırını göster. Görünmüyorsa cevap tamamlandığında yapılan arama sayısını küçük bir bilgi olarak göster.

### 3. Kaynak gösterimi

- `url_citation` annotation'larını `[W1]`, `[W2]` … etiketli web kaynaklarına dönüştür.
- Mevcut chip bileşenini kullan, ama ders kaynaklarından (`[K#]`) ayırt edilebilecek bir stille (alan adı ve başlıkla).
- `start_index` / `end_index` varsa etiketi ilgili metin parçasına bağla; yoksa kaynakları cevabın altında listele.
- Tıklanınca `shell.openExternal` ile sistem tarayıcısında aç. Yalnızca `http` ve `https` adreslerine izin ver.

### 4. Proje kaynaklarıyla birlikte kullanım

`@proje` seçiliyken ve web araması açıkken sistem talimatına şunlar eklenir:
- Önce `search_knowledge` ile proje kaynaklarına bak; web'i tamamlayıcı olarak kullan.
- Cevapta ders materyalinden gelen bilgiyle web'den gelen bilgiyi açıkça ayır. İkisi çelişiyorsa bunu belirt.

### 5. Tarih bilgisi

Her istekte sistem talimatına kullanıcının yerel saat dilimine göre bugünün tarihini ekle. Model, güncel bilgi gerektiren sorularda ne zaman araması gerektiğine buna göre karar verir.

### 6. Sağlayıcı uyumu

- Web araması yalnızca OpenRouter modellerinde kullanılabilir.
- Ollama veya OpenRouter dışındaki bir sağlayıcının modeli seçiliyken düğme devre dışı görünsün ve üzerine gelindiğinde "Web araması yalnızca OpenRouter modellerinde kullanılabilir" yazsın.
- Araç desteklemeyen OpenRouter modellerinde de (OpenRouter models API'sinde `supported_parameters` içinde `tools` yoksa) devre dışı olsun.

### 7. Maliyet takibi

- Her yanıttaki `usage.server_tool_use.web_search_requests` değerini mesaj bazında kaydet ve mevcut maliyet takibine ekle.
- Arama birim fiyatını yapılandırmada sabit tut (Exa varsayılan mod için istek başına 0,007 dolar); fiyat değişebileceği için kodun içine gömme.

### 8. Projeye kaydetme

Web kaynağı chip'inde "Projeye kaydet" seçeneği: annotation'daki başlık, URL ve alıntı içeriğiyle seçilen projede yeni bir not oluşturur. Not, normal notlar gibi indekslenir.

### 9. Hata durumları

- Arama başarısız olursa veya limit dolarsa model cevabını yine de üretebilmeli; arayüz çökmemeli.
- OpenRouter'dan gelen arama kaynaklı hatalar kullanıcıya anlaşılır bir Türkçe mesajla gösterilmeli.
- Bu araç OpenRouter'da beta aşamasında. Yanıt biçimindeki beklenmedik değişikliklere karşı annotation ayrıştırmasını savunmacı yaz (eksik alanlar uygulamayı düşürmesin).

## Kabul kriterleri

- "Bu haftaki önemli bilim haberleri neler?" sorusunda model web'de arıyor, cevapta tıklanabilir `[W#]` kaynakları var ve arama sayısı kaydediliyor.
- "Fotosentezin denklemi nedir?" gibi genel bilgi sorusunda model gereksiz yere arama yapmıyor.
- `@proje` ile sorulan bir soruda ders kaynakları `[K#]` ve web kaynakları `[W#]` ayrı ayrı görünüyor.
- Web düğmesi kapalıyken istekte `openrouter:web_search` aracı bulunmuyor.
- Ollama modeli seçiliyken düğme devre dışı ve açıklaması görünüyor.
