/** Uygulamanın iki modu: 'chat' akademik taraf (sohbet, notlar, projeler), 'coach' kişisel yaşam tarafı. mode alanı olmayan eski sohbetler 'chat' sayılır. */
export type Mode = 'chat' | 'coach'
/** Koç modunun görünen adı (çalışma adı); arayüzde her yerde buradan okunur. */
export const COACH_NAME = 'Yaşam Koçu'
/** Akademik modun görünen adı (sohbet, notlar, projeler). */
export const CHAT_NAME = 'Akademik Koç'
export const MODES: { id: Mode; label: string }[] = [{ id: 'chat', label: CHAT_NAME }, { id: 'coach', label: COACH_NAME }]
