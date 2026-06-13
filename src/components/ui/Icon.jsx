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

// ── Flaticon UICONS map ────────────────────────────────────────────────
// When a name is in here, the Icon renders the Flaticon glyph from the
// uicons-regular-rounded font (loaded via index.html CDN) instead of
// the lucide SVG. Lookup precedence: Flaticon → lucide → null.
//
// Naming: keep the same tabler-style name as the lucide MAP so existing
// call sites `<Icon name="star" />` pick up Flaticon automatically.
// Class is the "fi-rr-..." suffix from the Flaticon catalog (the "fi"
// prefix is added at render time).
//
// To extend: add another `name → fi-rr-glyph` entry. Catalog at:
// https://www.flaticon.com/uicons/interface-icons/regular
const FLATICON_MAP = {
  // Currency / rewards
  'star':            'fi-rr-star',
  'coins':           'fi-rr-coins',
  'trophy':          'fi-rr-trophy',
  'gift':            'fi-rr-gift',

  // Finance / charts
  'chart-pie':       'fi-rr-chart-pie',
  'chart-line':      'fi-rr-chart-line-up',
  'trending-up':     'fi-rr-chart-line-up',
  'trending-down':   'fi-rr-chart-arrow-down',
  'stats':           'fi-rr-stats',
  'bank':            'fi-rr-bank',
  'credit-card':     'fi-rr-credit-card',

  // Stocks / lab
  'flask':           'fi-rr-flask',
  'sparkles':        'fi-rr-sparkles',
  'bolt':            'fi-rr-bolt',
  'pie-chart':       'fi-rr-chart-pie',

  // UI affordances
  'chevron-right':   'fi-rr-angle-right',
  'chevron-down':    'fi-rr-angle-down',
  'chevron-up':      'fi-rr-angle-up',
  'arrow-left':      'fi-rr-arrow-left',
  'arrow-right':     'fi-rr-arrow-right',
  'arrow-up':        'fi-rr-arrow-up',
  'arrow-down':      'fi-rr-arrow-down',
  'check':           'fi-rr-check',
  'x':               'fi-rr-cross',
  'circle-check':    'fi-rr-check-circle',
  'circle-x':        'fi-rr-cross-circle',
  'plus':            'fi-rr-plus',
  'minus':           'fi-rr-minus',
  'menu-2':          'fi-rr-menu-burger',
  'search':          'fi-rr-search',
  'search-off':      'fi-rr-search-alt',
  'filter':          'fi-rr-filter',
  'settings':        'fi-rr-settings',
  'refresh':         'fi-rr-refresh',
  'download':        'fi-rr-download',
  'share':           'fi-rr-share',
  'link':            'fi-rr-link',
  'pencil':          'fi-rr-pencil',
  'info-circle':     'fi-rr-info',
  'alert-triangle':  'fi-rr-triangle-warning',
  'clock':           'fi-rr-clock',
  'lock':            'fi-rr-lock',
  'lock-check':      'fi-rr-lock-alt',

  // Profile / users / messages
  'user':            'fi-rr-user',
  'user-plus':       'fi-rr-user-add',
  'users':           'fi-rr-users',
  'mail':            'fi-rr-envelope',
  'mail-check':      'fi-rr-envelope-open',
  'brand-telegram':  'fi-rr-paper-plane',

  // Content / lists
  'bookmark':        'fi-rr-bookmark',
  'bookmark-filled': 'fi-rr-bookmark',
  'book':            'fi-rr-book-alt',
  'home':            'fi-rr-home',
  'layout-grid':     'fi-rr-apps',
  'layout-list':     'fi-rr-list',
  'list-check':      'fi-rr-list-check',
  'file-type-pdf':   'fi-rr-document',
  'photo':           'fi-rr-picture',
  'pin-filled':      'fi-rr-thumbtack',

  // Activity
  'activity':        'fi-rr-chart-pulse',
  'confetti':        'fi-rr-party-horn',
  'cookie':          'fi-rr-cookie',
  'logout':          'fi-rr-sign-out-alt',
  'circle-filled':   'fi-rr-circle',
  'arrows-sort':     'fi-rr-arrows-cross',
  'loader-2':        'fi-rr-loading',
}

export default function Icon({ name, size = 16, style, className = '', ...rest }) {
  // Flaticon wins when the name has a glyph mapping. Renders an <i>
  // tag with the uicons-regular-rounded font. The `size` prop maps to
  // fontSize so callers don't need to change their existing calls.
  const fi = FLATICON_MAP[name]
  if (fi) {
    const filtered = { ...rest }
    // `fill` is a lucide-only prop; it has no meaning on an <i> and
    // browsers complain. Drop it silently.
    delete filtered.fill
    return (
      <i
        className={`fi ${fi}${className ? ' ' + className : ''}`}
        style={{ fontSize: size, lineHeight: 0, display: 'inline-flex', ...style }}
        {...filtered}
      />
    )
  }

  const Component = MAP[name]
  if (!Component) {
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.warn(`[Icon] No mapping for "${name}"`)
    return null
  }
  const filledStyle = FILLED.has(name) ? { fill: 'currentColor' } : null
  return <Component size={size} className={className || undefined} style={{ ...filledStyle, ...style }} {...rest} />
}
