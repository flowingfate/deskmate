import type { LucideIcon } from 'lucide-react';
import {
  Sparkles,
  PenLine,
  Search,
  Code2,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Wand2,
  BookOpen,
  Bug,
  Languages,
  Calculator,
  Rocket,
  Compass,
  AlignLeft,
  BarChart3,
  Eye,
  CalendarDays,
  Brain,
  FileText,
  Pencil,
  Wrench,
  Gauge,
  Database,
  Terminal,
  Palette,
  ImageIcon,
  Mail,
  StickyNote,
  HelpCircle,
  GitCompare,
  Recycle,
  FlaskConical,
  Ship,
  ShieldCheck,
  DollarSign,
} from 'lucide-react';

/**
 * 预设提示词的图标注册表。
 *
 * 数据里存的是 `iconKey`（**语义概念词**，如 `write`/`search`/`code`），渲染时经此表
 * 解析成 Lucide 组件。key 表达"这条提示词是做什么的"（意图），而非图标外观 ——
 * 落盘后即便换成别的图标，语义仍然稳定。CRUD 表单只需在固定 key 集里选一个。
 */
export const PRESET_ICONS = {
  magic: Sparkles,
  chat: MessageCircle,
  improve: Wand2,
  write: PenLine,
  search: Search,
  code: Code2,
  debug: Bug,
  idea: Lightbulb,
  checklist: ListChecks,
  learn: BookOpen,
  translate: Languages,
  calculate: Calculator,
  launch: Rocket,
  explore: Compass,
  summarize: AlignLeft,
  analyze: BarChart3,
  review: Eye,
  plan: CalendarDays,
  brainstorm: Brain,
  document: FileText,
  edit: Pencil,
  fix: Wrench,
  optimize: Gauge,
  data: Database,
  terminal: Terminal,
  design: Palette,
  image: ImageIcon,
  email: Mail,
  note: StickyNote,
  question: HelpCircle,
  compare: GitCompare,
  refactor: Recycle,
  test: FlaskConical,
  deploy: Ship,
  security: ShieldCheck,
  finance: DollarSign,
} as const satisfies Record<string, LucideIcon>;

export type PresetIconKey = keyof typeof PRESET_ICONS;

/** 供图标选择器遍历的稳定顺序。 */
export const PRESET_ICON_KEYS = Object.keys(PRESET_ICONS) as PresetIconKey[];

/** 未知 key 的兜底图标，避免渲染期崩溃。 */
export const DEFAULT_PRESET_ICON_KEY: PresetIconKey = 'magic';

export function resolvePresetIcon(key: string): LucideIcon {
  return PRESET_ICONS[key as PresetIconKey] ?? PRESET_ICONS[DEFAULT_PRESET_ICON_KEY];
}
