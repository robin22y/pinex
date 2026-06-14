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
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BarChart2,
  BarChart3,
  Bed,
  Book,
  Bookmark,
  Box,
  Brain,
  Building2,
  Calculator,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardList,
  Clock,
  Coins,
  Compass,
  Cookie,
  CreditCard,
  Download,
  Droplet,
  Dumbbell,
  FileText,
  Filter,
  FlaskConical,
  Folder,
  Footprints,
  Frown,
  Gift,
  Globe,
  GraduationCap,
  Home,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  LayoutList,
  Link as LinkIcon,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  Magnet,
  Mail,
  MailCheck,
  Map,
  Menu,
  Microscope,
  Minus,
  PartyPopper,
  Pencil,
  PieChart,
  Pin,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  SearchX,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Sprout,
  Star,
  Store,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  Triangle,
  Trophy,
  Tv,
  Unlock,
  User,
  UserPlus,
  Users,
  Volume2,
  X,
  XCircle,
  Zap,
} from 'lucide-react'

// Name → lucide component. Names follow the tabler convention
// (`ti-chevron-down` → `'chevron-down'`) so existing call sites
// `<Icon name="chevron-down" />` keep working. Flaticon `fi-rr-*` names
// also pass — the renderer below strips the prefix before lookup.
//
// Where lucide lacks an exact match (e.g. tabler `circle-filled`,
// flaticon `fi-rr-cricket`), we use the closest lucide icon — inline
// fill is applied via FILLED below for glyphs that should look solid.
const MAP = {
  'activity': Activity,
  'alert-triangle': AlertTriangle,
  'apps': LayoutGrid, // fi-rr-apps
  'angle-down': ChevronDown, // fi-rr-angle-down
  'angle-right': ChevronRight, // fi-rr-angle-right
  'angle-up': ChevronUp, // fi-rr-angle-up
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrows-cross': ArrowUpDown, // fi-rr-arrows-cross
  'arrows-sort': ArrowUpDown,
  'bank': Building2, // fi-rr-bank → office building tower
  'bed': Bed,
  'binoculars': Search, // fi-rr-binoculars (no lucide equiv in v1.17)
  'bolt': Zap,
  'book': Book,
  'book-alt': Book, // fi-rr-book-alt
  'bookmark': Bookmark,
  'bookmark-filled': Bookmark,
  'box': Box,
  'brain': Brain,
  'brand-telegram': Send,
  'brightness': Sun, // fi-rr-brightness → theme toggle
  'bullseye': Target,
  'cactus': Sprout, // fi-rr-cactus (no exact lucide)
  'calculator': Calculator,
  'calendar': Calendar,
  'chart-arrow-down': TrendingDown,
  'chart-histogram': BarChart3,
  'chart-line': TrendingUp,
  'chart-line-up': TrendingUp,
  'chart-pie': PieChart,
  'chart-pulse': Activity, // fi-rr-chart-pulse
  'check': Check,
  'check-circle': CheckCircle, // fi-rr-check-circle
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle': Circle,
  'circle-check': CheckCircle,
  'circle-filled': Circle,
  'circle-x': XCircle,
  'clipboard-list': ClipboardList,
  'clock': Clock,
  'coins': Coins,
  'compass': Compass,
  'confetti': PartyPopper,
  'cookie': Cookie,
  'credit-card': CreditCard,
  'cricket': Trophy, // fi-rr-cricket (no sport icon in lucide v1.17)
  'cross': X, // fi-rr-cross
  'cross-circle': XCircle, // fi-rr-cross-circle
  'cube': Box,
  'document': FileText, // fi-rr-document
  'download': Download,
  'envelope': Mail, // fi-rr-envelope
  'envelope-open': MailCheck, // fi-rr-envelope-open
  'face-confused': Frown,
  'file-type-pdf': FileText,
  'filter': Filter,
  'flask': FlaskConical,
  'folder': Folder,
  'gift': Gift,
  'globe': Globe,
  'graduation-cap': GraduationCap,
  'home': Home,
  'info': Info, // fi-rr-info
  'info-circle': Info,
  'layout-grid': LayoutGrid,
  'layout-list': LayoutList,
  'link': LinkIcon,
  'list': LayoutList, // fi-rr-list
  'list-check': ListChecks,
  'loader-2': Loader2,
  'loading': Loader2, // fi-rr-loading
  'lock': Lock,
  'lock-alt': ShieldCheck, // fi-rr-lock-alt
  'lock-check': ShieldCheck,
  'logout': LogOut,
  'magnet': Magnet,
  'mail': Mail,
  'mail-check': MailCheck,
  'map': Map,
  'menu-2': Menu,
  'menu-burger': Menu, // fi-rr-menu-burger
  'microscope': Microscope,
  'minus': Minus,
  'muscle': Dumbbell, // fi-rr-muscle
  'paper-plane': Send, // fi-rr-paper-plane
  'party-horn': PartyPopper, // fi-rr-party-horn
  'pencil': Pencil,
  'photo': ImageIcon,
  'picture': ImageIcon, // fi-rr-picture
  'pie-chart': PieChart,
  'pin-filled': Pin,
  'plus': Plus,
  'refresh': RefreshCw,
  'rocket': Rocket,
  'rocket-lunch': Rocket, // fi-rr-rocket-lunch (typo preserved)
  'running': Footprints,
  'search': Search,
  'search-alt': SearchX, // fi-rr-search-alt
  'search-off': SearchX,
  'seedling': Sprout, // fi-rr-seedling
  'settings': Settings,
  'share': Share2,
  'shield': Shield,
  'shop': Store, // fi-rr-shop
  'sign-out-alt': LogOut, // fi-rr-sign-out-alt
  'sparkles': Sparkles,
  'star': Star,
  'stats': BarChart2,
  'thumbtack': Pin, // fi-rr-thumbtack
  'trending-down': TrendingDown,
  'trending-up': TrendingUp,
  'triangle': Triangle,
  'triangle-warning': AlertTriangle, // fi-rr-triangle-warning
  'trophy': Trophy,
  'tv': Tv,
  'unlock': Unlock,
  'user': User,
  'user-add': UserPlus, // fi-rr-user-add
  'user-plus': UserPlus,
  'users': Users,
  'volume': Volume2, // fi-rr-volume
  'water': Droplet, // fi-rr-water
  'window-frame-open': AppWindow, // fi-rr-window-frame-open
  'x': X,
}

// Icons whose source glyph was filled — emulate via fill="currentColor".
// Lucide ships outline-only icons, so we paint the interior to match.
const FILLED = new Set(['bookmark-filled', 'circle-filled', 'pin-filled'])

export default function Icon({ name, size = 16, style, className = '', ...rest }) {
  if (!name) return null

  // Accept both tabler-style names (`'chevron-down'`) and Flaticon-style
  // names (`'fi-rr-chevron-down'`). The latter exists in legacy data
  // structures (Learn / Academy / guruScore) — strip the prefix before
  // lookup so we don't have to touch every data row to migrate.
  const normalized = name.startsWith('fi-rr-') ? name.slice(6) : name

  const Component = MAP[normalized]
  if (!Component) {
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.warn(`[Icon] No mapping for "${name}"`)
    return null
  }
  const filledStyle = FILLED.has(normalized) ? { fill: 'currentColor' } : null
  return <Component size={size} className={className || undefined} style={{ ...filledStyle, ...style }} {...rest} />
}
