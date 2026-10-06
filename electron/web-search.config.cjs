// Web araması (OpenRouter `openrouter:web_search` sunucu aracı) için tek yapılandırma noktası.
// Motor bilinçli olarak exa'ya sabit: her modelde aynı arama, aynı fiyat ve aynı sınırlar geçerli olur.
const TOOL = {
  type: 'openrouter:web_search',
  parameters: { engine: 'exa', max_results: 5, max_uses: 3, max_total_results: 15 }
}
// Exa varsayılan modunda istek başına ücret (dolar). Fiyat değişirse yalnızca burası güncellenir.
const PRICE_PER_SEARCH = 0.007

// max_uses istek başınadır; araç döngüsü tek cevapta birden çok istek yapabildiği için kalan hak turdan tura düşülür.
// used: bu cevapta o ana kadar yapılan arama sayısı. Hak bittiyse araç hiç gönderilmez.
function toolsFor(used = 0) {
  const left = TOOL.parameters.max_uses - used
  return left > 0 ? [{ ...TOOL, parameters: { ...TOOL.parameters, max_uses: left } }] : undefined
}

module.exports = { TOOL, PRICE_PER_SEARCH, toolsFor }
