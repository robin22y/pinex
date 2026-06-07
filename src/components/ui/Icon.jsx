/**
 * Icon — drop-in replacement for the @tabler/icons-webfont package.
 *
 * Why: @tabler/icons-webfont shipped a 829 KB woff2 file loaded at very-high
 * priority on every page, blocking LCP by ~600ms. Most pages used <20 of the
 * ~5000 icons inside. lucide-react ships individual tree-shakeable SVG
 * components — only the icons we actually import end up in the bundle.
 *
 * Usage:
 *   <Icon name="chevron-down" />
 *   <Icon name="x" size={20} style={{ color: 'red' }} />
 *   <Icon name={open ? 'chevron-up' : 'chevron-down'} />
 *
 * The `name` prop matches the tabler icon name (e.g. tabler "ti-chevron-down"
 * becomes name="chevron-down") — this keeps the migration mechanical.
 *
 * If a name isn't mapped, we log a console warning in dev and render nothing
 * (silent in prod) so a typo doesn't crash the page.
 */
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Zap,
  Book,
  Bookmark,
  Send,
  PieChart,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CheckCircle,
  Circle,
  XCircle,
  Clock,
  PartyPopper,
  Cookie,
  Download,
  FileText,
  Filter,
  FlaskConical,
  Home,
  Info,
  LayoutGrid,
  LayoutList,
  Link as LinkIcon,
  ListChecks,
  Loader2,
  Lock,
  ShieldCheck,
  LogOut,
  Mail,
  MailCheck,
  Menu,
  Minus,
  Pencil,
  Image as ImageIcon,
  Pin,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Settings,
  Share2,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

// Tabler name → lucide component.
// Where lucide lacks an exact match (e.g. tabler "circle-filled"), we use the
// closest lucide icon with an inline `fill` style to mimic the filled glyph.
const MAP = {
  'activity': Activity,
  'alert-triangle': AlertTriangle,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrows-sort': ArrowUpDown,
  'bolt': Zap, // tabler bolt ≈ lucide Zap (lightning)
  'book': Book,
  'bookmark': Bookmark,
  'bookmark-filled': Bookmark, // filled visual handled via prop
  'brand-telegram': Send, // closest paper-plane silhouette
  'chart-pie': PieChart,
  'check': Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle-check': CheckCircle,
  'circle-filled': Circle, // filled handled via prop
  'circle-x': XCircle,
  'clock': Clock,
  'confetti': PartyPopper,
  'cookie': Cookie,
  'download': Download,
  'file-type-pdf': FileText, // lucide has no pdf-specific glyph
  'filter': Filter,
  'flask': FlaskConical,
  'home': Home,
  'info-circle': Info,
  'layout-grid': LayoutGrid,
  'layout-list': LayoutList,
  'link': LinkIcon,
  'list-check': ListChecks,
  'loader-2': Loader2,
  'lock': Lock,
  'lock-check': ShieldCheck, // closest "verified lock" semantic
  'logout': LogOut,
  'mail': Mail,
  'mail-check': MailCheck,
  'menu-2': Menu,
  'minus': Minus,
  'pencil': Pencil,
  'photo': ImageIcon,
  'pin-filled': Pin, // filled handled via prop
  'plus': Plus,
  'refresh': RefreshCw,
  'search': Search,
  'search-off': SearchX,
  'settings': Settings,
  'share': Share2,
  'sparkles': Sparkles,
  'star': Star,
  'trending-down': TrendingDown,
  'trending-up': TrendingUp,
  'user': User,
  'user-plus': UserPlus,
  'users': Users,
  'x': X,
}

// Icons whose tabler glyph was filled — emulate via fill="currentColor".
// Lucide ships outline-only icons, so we paint the interior to match.
const FILLED = new Set(['bookmark-filled', 'circle-filled', 'pin-filled'])

export default function Icon({ name, size = 16, style, ...rest }) {
  const Component = MAP[name]
  if (!Component) {
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.warn(`[Icon] No mapping for "${name}"`)
    return null
  }
  const filledStyle = FILLED.has(name) ? { fill: 'currentColor' } : null
  return <Component size={size} style={{ ...filledStyle, ...style }} {...rest} />
}
