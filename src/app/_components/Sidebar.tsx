"use client";

// Persistent left navigation sidebar, rendered once by the root layout and
// present on every page. It is a Client Component because it highlights the
// active route via usePathname() — the only reason this isn't a Server
// Component. It holds no other client state.
//
// Design system (docs/design-system.md): dark surface background, brand-yellow
// accent for the active item, outline icons (inline SVG — no icon dependency
// added). Responsiveness: collapses to an icon-only rail below `md`, expanding
// to icons + labels at `md` and up (see RESPONSIVE note below).

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

// Minimal geometric outline icons (24×24, stroke=currentColor) so they inherit
// the link's text colour — including the brand-yellow active state — for free.
const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg {...iconProps} aria-hidden>
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/cards",
    label: "Cards",
    icon: (
      <svg {...iconProps} aria-hidden>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M2.5 9.5h19" />
        <path d="M6 15h4" />
      </svg>
    ),
  },
  {
    href: "/transactions",
    label: "Transactions",
    icon: (
      <svg {...iconProps} aria-hidden>
        <path d="M7 7h13" />
        <path d="m16 3 4 4-4 4" />
        <path d="M17 17H4" />
        <path d="m8 21-4-4 4-4" />
      </svg>
    ),
  },
  {
    href: "/payments",
    label: "Payments",
    icon: (
      <svg {...iconProps} aria-hidden>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <path d="M9 9h4" />
        <path d="M9 12h4" />
        <path d="M9 12c2.5 0 3.5 3 0 3l3 0" />
      </svg>
    ),
  },
  {
    href: "/milestones",
    label: "Milestones",
    icon: (
      <svg {...iconProps} aria-hidden>
        <path d="M5 21V4" />
        <path d="M5 4h11l-2 3 2 3H5" />
      </svg>
    ),
  },
  {
    href: "/assistant",
    label: "AI Assistant",
    icon: (
      <svg {...iconProps} aria-hidden>
        <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" />
        <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14Z" />
      </svg>
    ),
  },
];

/** True when `href` is the active route. `/` matches exactly; others match as a
 *  prefix so future nested routes (e.g. /cards/123) keep their parent active. */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    // RESPONSIVE: icon-only rail (w-16) on narrow viewports; widens to w-64 with
    // text labels at md+. Labels use `hidden md:inline` so they vanish on the
    // rail without reflowing the icons. Full body height, independently styled
    // dark surface; the layout makes the content area (not this) scroll.
    <nav
      aria-label="Primary"
      className="flex h-full w-16 shrink-0 flex-col border-r border-white/5 bg-surface-dark md:w-64"
    >
      {/* Brand / logo area. Shows a compact mark on the rail, full name at md+. */}
      <div className="flex h-16 items-center gap-2.5 border-b border-white/5 px-4 md:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-yellow font-bold text-charcoal">
          CC
        </span>
        <span className="hidden text-base font-semibold text-text-primary-dark md:inline">
          CC Manager
        </span>
      </div>

      {/* Navigation links */}
      <ul className="flex flex-1 flex-col gap-1 p-2 md:p-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  "justify-center md:justify-start",
                  active
                    ? "bg-brand-yellow/10 text-brand-yellow"
                    : "text-text-secondary-dark hover:bg-white/5 hover:text-text-primary-dark",
                ].join(" ")}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
