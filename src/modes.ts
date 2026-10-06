/** Uygulamanın iki modu: 'chat' akademik taraf (sohbet, notlar, projeler), 'coach' kişisel yaşam tarafı. mode alanı olmayan eski sohbetler 'chat' sayılır. */
export type Mode = 'chat' | 'coach'
/** Koç modunun görünen adı (çalışma adı); arayüzde her yerde buradan okunur. */
export const COACH_NAME = 'Yaşam Koçu'
/** Akademik modun görünen adı (sohbet, notlar, projeler). */
export const CHAT_NAME = 'Akademik Koç'
/** Ayarlardaki modül anahtarlarının geçerli hali: koç modu kapalıysa takvim ve takip de kapalıdır. */
export const modulesOf = (s?: { modules?: { coach?: boolean; calendar?: boolean; trackers?: boolean } } | null) => {
  const coach = s?.modules?.coach !== false
  return { coach, calendar: coach && s?.modules?.calendar !== false, trackers: coach && s?.modules?.trackers !== false }
}
export type Modules = ReturnType<typeof modulesOf>
export const MODES: { id: Mode; label: string }[] = [{ id: 'chat', label: CHAT_NAME }, { id: 'coach', label: COACH_NAME }]
