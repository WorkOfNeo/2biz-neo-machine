"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/check-assortments", label: "Check Purchases" },
  { href: "/assortment-on-style", label: "Assortment on Style" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

function NavLink({ href, label }: NavItem) {
  const pathname = usePathname();
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      className={
        "flex items-center rounded-md px-3 py-2 text-sm transition-colors " +
        (isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
      }
    >
      {label}
    </Link>
  );
}

function SidebarInner() {
  return (
    <div className="flex h-full w-64 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="text-base font-semibold">
          NEO 2BIZ MACHINE
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Quick actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}
      </nav>
      <div className="mt-auto text-xs text-muted-foreground">© NEO Labs</div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="border-border/60 hidden shrink-0 border-r md:block">
      <SidebarInner />
      <div className="md:hidden" />
    </aside>
  );
}

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="mr-2">Menu</Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <div className="h-full">{/* reuse the same content */}
            <div className="border-r h-full">{/* visual parity */}
              <div className="h-full">{/* wrapper */}
                <div className="h-full overflow-auto"><SidebarInner /></div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default Sidebar;


