"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Activity,
  BarChart3,
  ChevronDown,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Main navigation, in the order from the brief. */
const NAV = [
  { href: "/zbm", label: "ZBM", icon: Users },
  { href: "/hos", label: "HOS", icon: UserRound },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/uploads", label: "Upload History", icon: History },
  { href: "/activity", label: "Activity Log", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Props = { user: { full_name: string; email: string; is_admin: boolean } };

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function AppNav({ user }: Props) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]); // close the phone menu after navigating

  const initials = user.full_name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="glass glass-strong sticky top-0 z-40 rounded-none border-x-0 border-t-0 border-b-black/[0.06] pt-[env(safe-area-inset-top)] shadow-none">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label={`${APP_NAME} home`}>
          <span className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
            <Image src="/brand/htlb-mark.png" alt="HTLB Systems logo" width={36} height={36} priority />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold tracking-tight">HTLB</span>
            <span className="block text-[11px] font-medium text-muted-foreground">Candidate Tracker</span>
          </span>
        </Link>

        {/* Desktop navigation */}
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                isActive(pathname, href) ? "bg-primary text-white shadow-sm shadow-primary/25" : "text-foreground/70 hover:bg-black/[0.05] hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex-1 lg:hidden" />

        <DropdownMenu>
          <DropdownMenuTrigger className="hidden shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm hover:bg-black/[0.05] focus-visible:outline-none lg:flex">
            <Avatar initials={initials} />
            <span className="max-w-32 truncate">{user.full_name}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <UserLabel user={user} />
            <DropdownMenuSeparator />
            <form action={signOut}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut /> Log out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Phone / tablet menu */}
        <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogPrimitive.Trigger className="flex size-10 items-center justify-center rounded-full hover:bg-black/[0.05] lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-md data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content className="glass glass-strong fixed inset-x-2 top-2 z-50 rounded-3xl p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-4">
              <div className="flex items-center justify-between px-2 pb-2">
                <DialogPrimitive.Title className="text-sm font-semibold">{APP_NAME}</DialogPrimitive.Title>
                <DialogPrimitive.Close className="flex size-9 items-center justify-center rounded-full hover:bg-black/[0.05]" aria-label="Close menu">
                  <X className="size-5" />
                </DialogPrimitive.Close>
              </div>
              <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
              <nav className="grid grid-cols-2 gap-1.5">
                {NAV.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-2xl px-3 py-3 text-[15px] font-medium",
                      isActive(pathname, href) ? "bg-primary text-white" : "bg-white/60 hover:bg-white",
                    )}
                  >
                    <Icon className="size-[18px]" /> {label}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white/60 p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar initials={initials} />
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{user.full_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  </div>
                </div>
                <form action={signOut}>
                  <button type="submit" className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-destructive hover:bg-red-50">
                    <LogOut className="size-4" /> Log out
                  </button>
                </form>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>
    </header>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#1f4d36] to-[#2f6f4f] text-xs font-semibold text-white ring-2 ring-gold/60">
      {initials}
    </span>
  );
}

function UserLabel({ user }: Props) {
  return (
    <DropdownMenuLabel>
      <div className="font-medium">{user.full_name}</div>
      <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
      {user.is_admin && (
        <div className="mt-1 flex items-center gap-1 text-xs font-normal text-gold-deep">
          <ShieldCheck className="size-3.5" /> Admin
        </div>
      )}
    </DropdownMenuLabel>
  );
}
