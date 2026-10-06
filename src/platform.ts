/** macOS'ta başlık çubuğu gizlidir: trafik ışıkları içeriğin üstünde durur (.tl yer ayırır) ve kısayollar ⌘ ile gösterilir. */
export const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
export const kbd = (k: string) => (isMac ? '⌘' + k : 'Ctrl ' + k)
