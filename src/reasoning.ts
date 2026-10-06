import type { ReasoningConfig, ReasoningLevel } from './types'

export const LEVELS: { id: ReasoningLevel; label: string }[] = [
  { id: 'off', label: 'Kapalı' },
  { id: 'low', label: 'Düşük' },
  { id: 'medium', label: 'Orta' },
  { id: 'high', label: 'Yüksek' }
]
export const DEFAULT_REASONING: ReasoningConfig = { level: 'medium' }

// Eski sürümden kalan kayıtlar 'max' / 'custom' içerebilir.
const OLD: Record<string, string> = { max: 'Maks', custom: 'Özel' }
export const levelLabel = (l: string) => LEVELS.find((x) => x.id === l)?.label ?? OLD[l] ?? l

/** Kayıtlı ayarı geçerli bir seviyeye çevirir (eski 'max' / 'custom' değerleri dahil). */
export function normalizeReasoning(r?: { level?: string; budget?: number }): ReasoningConfig {
  if (!r?.level) return DEFAULT_REASONING
  if (LEVELS.some((x) => x.id === r.level)) return { level: r.level as ReasoningLevel }
  if (r.level === 'custom') return { level: (r.budget ?? 0) <= 4096 ? 'low' : (r.budget ?? 0) <= 12288 ? 'medium' : 'high' }
  return { level: 'high' }
}

// Model kimliğinden "düşünür mü?" tahmini; yalnızca menü işareti ve düşünme panelinin baştan açılması için kullanılır.
const AUTO: RegExp[] = [
  /claude[-.\s]?(3[-.]7|(opus|sonnet|haiku)[-.\s]?[4-9]|fable|mythos)/,
  /(^|[/:\s])o[134](-|$|:|\s)/, // o1, o3-mini, o4-mini
  /gpt-5|gpt-oss/,
  /deepseek.*(r1|reasoner)|(^|[/:\-_])r1([-_:]|$)/,
  /qwq|qwen-?3/,
  /gemini-(2\.5|3)/,
  /grok-(3-mini|4)/,
  /magistral|glm-(4\.[5-9]|[5-9])|kimi-k2-thinking|minimax-m/,
  /reason|think/
]
export const detectReasoning = (model: string) => !!model && AUTO.some((re) => re.test(model.toLowerCase()))
