// SF Symbols karakterinde ikonlar: 24'lük ızgara, tek ağırlık, yuvarlak uç ve birleşim.
const S = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' } as const
type P = { size?: number; className?: string }
const I = (d: React.ReactNode, strokeWidth = 1.7) => ({ size = 20, className }: P) => <svg width={size} height={size} className={className} aria-hidden {...S} strokeWidth={strokeWidth}>{d}</svg>
export const Panel = I(<><rect x="3" y="5" width="18" height="14" rx="3.5" /><path d="M9 5v14" /></>)
export const Compose = I(<><path d="M11 5H7.5A2.5 2.5 0 0 0 5 7.5v9A2.5 2.5 0 0 0 7.5 19h9a2.5 2.5 0 0 0 2.5-2.5V13" /><path d="M17.6 4.4a1.6 1.6 0 0 1 2.2 2.2L12.5 14l-3 .8.8-3z" /></>)
export const Plus = I(<path d="M12 5.5v13M5.5 12h13" />, 2)
export const Search = I(<><circle cx="10.5" cy="10.5" r="5.5" /><path d="M15 15l4.5 4.5" /></>)
export const Gear = I(<><circle cx="12" cy="12" r="2.8" /><circle cx="12" cy="12" r="6.2" /><circle cx="12" cy="12" r="8.4" strokeWidth="2.6" strokeDasharray="2.9 3.7" strokeLinecap="butt" /></>)
export const UpDown = I(<path d="M8.5 9.5L12 6l3.5 3.5M8.5 14.5L12 18l3.5-3.5" />)
export const Copy = I(<><rect x="9" y="8.5" width="10.5" height="12" rx="2.5" /><path d="M6.5 16H6a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2V6" /></>)
export const Redo = I(<><path d="M19 12a7 7 0 1 1-2.3-5.2" /><path d="M19.5 4v4.3h-4.3" /></>)
export const Up = I(<path d="M12 18V6.5M7 11l5-5 5 5" />, 2.3)
export const Stop = I(<rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />)
export const Close = I(<path d="M7 7l10 10M17 7L7 17" />, 2)
export const Trash = I(<path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M7 7l.8 11a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L17 7" />)
export const Star = I(<path d="M12 4.2l2.3 4.8 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" />)
export const FileText = I(<><rect x="5" y="3.5" width="14" height="17" rx="3" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></>)
export const Chat = I(<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15a2.5 2.5 0 0 1-2-2.5z" />)
export const Back = I(<path d="M14 6.5L8.5 12l5.5 5.5" />, 2.2)
export const Next = I(<path d="M10 7l5 5-5 5" />, 2)
export const Pin = I(<path d="M9.5 4h5l-.6 5.2 2.6 2.8v1.5h-9V12l2.6-2.8zM12 13.5V20" />)
export const Check = I(<path d="M5.5 12.5l4.2 4.2L18.5 7.5" />, 2.2)
export const ListIcon = I(<><path d="M9.5 7h10M9.5 12h10M9.5 17h10" /><path d="M5 7h.01M5 12h.01M5 17h.01" strokeWidth="2.6" /></>)
export const Checklist = I(<><path d="M12 7h7.5M12 12h7.5M12 17h7.5" /><path d="M4.5 7l1.5 1.5 2.5-3M4.5 12l1.5 1.5 2.5-3M4.5 17l1.5 1.5 2.5-3" /></>)
export const Key = I(<><circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H20M17 12v3M14 12v2" /></>)
export const Archive = I(<><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5V9.5H4z" /><path d="M5.5 9.5v7A2.5 2.5 0 0 0 8 19h8a2.5 2.5 0 0 0 2.5-2.5v-7M10 13.5h4" /></>)
export const Globe = I(<><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.4 2.2 3.6 4.9 3.6 8s-1.2 5.8-3.6 8c-2.4-2.2-3.6-4.9-3.6-8S9.6 6.2 12 4z" /></>)
export const Quiz = I(<><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.7a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.3 1-1.3 1.9" /><path d="M12 16.7h.01" strokeWidth="2.4" /></>)
export const Calendar = I(<><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>)
export const Folder = I(<path d="M4 8a2.5 2.5 0 0 1 2.5-2.5h3.2l2 2h5.8A2.5 2.5 0 0 1 20 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />)

const BARS =['M5 18v-3', 'M9.5 18v-6', 'M14 18V9', 'M18.5 18V6']
/** Düşünme seviyesi göstergesi: n dolu çubuk (0–4). n verilmezse tek renkli işaret olarak çizilir ("düşünme destekli"). */
export const Level = ({ n, size = 16 }: { n?: number; size?: number }) => (
  <svg width={size} height={size} aria-hidden {...S} strokeWidth={2.6}>
    {BARS.map((d, i) => <path key={i} d={d} className={n == null ? undefined : i < n ? 'lv-on' : 'lv-off'} />)}
  </svg>
)
