// General UI icon adapter. Keep application imports independent of the icon pack.
// Prefer outlined Remix icons; aliases preserve the shared application API.
export {
  RiAddLine as Plus,
  RiChat3Line as MessageSquare,
  RiChat3Fill as MessageSquareFilled,
  RiBookOpenLine as BookOpen,
  RiBookOpenFill as BookOpenFilled,
  RiSettings3Fill as SettingsFilled,
  RiErrorWarningLine as AlertCircle,
  RiArrowDownLine as ArrowDown,
  RiArrowLeftDownLine as ArrowDownLeft,
  RiArrowLeftLine as ArrowLeft,
  RiArrowRightLine as ArrowRight,
  RiArrowUpLine as ArrowUp,
  RiArrowRightUpLine as ArrowUpRight,
  RiCheckLine as Check,
  RiCheckLine as CheckIcon,
  RiArrowDownSLine as ChevronDown,
  RiArrowDownSLine as ChevronDownIcon,
  RiArrowRightSLine as ChevronRight,
  RiArrowRightSLine as ChevronRightIcon,
  RiArrowUpSLine as ChevronUpIcon,
  RiExpandUpDownLine as ChevronsUpDown,
  RiErrorWarningLine as CircleAlert,
  RiCheckboxCircleLine as CircleCheck,
  RiCheckboxCircleLine as CircleCheckIcon,
  RiCloseCircleLine as CircleX,
  RiClipboardLine as ClipboardList,
  RiTimeLine as Clock,
  RiFileCopyLine as Copy,
  RiDownloadLine as Download,
  RiExternalLinkLine as ExternalLink,
  RiGiftLine as Gift,
  RiGlobalLine as Globe,
  RiInformationLine as Info,
  RiInformationLine as InfoIcon,
  RiSubtractLine as Minus,
  RiMoreLine as MoreHorizontal,
  RiCloseCircleLine as OctagonXIcon,
  RiSideBarLine as PanelLeftIcon,
  RiSearchLine as Search,
  RiShieldCheckLine as ShieldCheck,
  RiAlertLine as TriangleAlert,
  RiAlertLine as TriangleAlertIcon,
  RiArrowGoBackLine as Undo2,
  RiUserLine as UserRound,
  RiGroupLine as Users,
  RiWifiOffLine as WifiOff,
  RiCloseLine as X,
  RiCloseLine as XIcon,
} from "@remixicon/react";

// Custom Dya UI icons share the same public entry point as pack-backed icons.
export { InsightsIcon } from "./components/insights-icon";

// Lucide’s face-scan glyph is clearer for passkey/security actions.
export { ScanFace, Network, RefreshCw, LogIn, LogIn as LoginCircle, LogOut } from "lucide-react";

export { TradeIcon, WalletIcon as Wallet } from "./components/navigation-icon";

export { CoinsIcon as Coins } from "./components/coins-icon";

export { SettingsIcon as Settings } from "./components/settings-icon";

export { LoaderCircle } from "./components/loader-circle";

export { DyaIcon } from "./components/dya-icon";
export { PrivacyIcon } from './components/privacy-icon';
