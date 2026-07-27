import {
  LayoutDashboard,
  Mail,
  PhoneCall,
  Globe,
  FileText,
  Bell,
  KeyRound,
  Settings,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  badge?: string
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    ],
  },
  {
    title: "Services",
    items: [
      { href: "/dashboard/mailboxes", label: "Mailboxes", icon: Mail },
      { href: "/dashboard/numbers", label: "Numbers & Calls", icon: PhoneCall },
      { href: "/dashboard/domains", label: "Domains & DNS", icon: Globe },
      { href: "/dashboard/events", label: "Events", icon: Bell },
    ],
  },
  {
    title: "Developer",
    items: [
      { href: "/dashboard/api-keys", label: "Agent tokens", icon: KeyRound },
      { href: "/dashboard/guide", label: "API guide", icon: FileText },
      { href: "/dashboard/settings", label: "Account & services", icon: Settings },
    ],
  },
]
