import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  RefreshCw, BarChart3, Kanban, LayoutDashboard, ListChecks, Radio, Wrench, CalendarDays, ChevronDown
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState } from "react";

interface NavGroup {
  label: string;
  items: { label: string; icon: React.ElementType; path: string }[];
}

const navGroups: NavGroup[] = [
  {
    label: "Visão Geral",
    items: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/" },
    ],
  },
  {
    label: "Operacional",
    items: [
      { label: "Dashboard Técnicos", icon: BarChart3, path: "/financeiro/dashboard-tecnicos" },
      { label: "Acompanhamento", icon: Radio, path: "/financeiro/acompanhamento" },
      { label: "Agenda Semanal", icon: CalendarDays, path: "/financeiro/agenda-semanal" },
    ],
  },
  {
    label: "Kanban",
    items: [
      { label: "Orçamentos", icon: Kanban, path: "/financeiro/kanban-orcamentos" },
      { label: "Personalizado", icon: ListChecks, path: "/financeiro/kanban-personalizado" },
      { label: "Ordens de Serviço", icon: Wrench, path: "/financeiro/kanban-os" },
    ],
  },
  {
    label: "Integrações",
    items: [
      { label: "Auvo → GC Sync", icon: RefreshCw, path: "/financeiro/auvo-sync" },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Auto-expand groups that contain the active route
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    navGroups.forEach((g) => {
      if (g.items.some((i) => i.path === location.pathname)) {
        initial.add(g.label);
      }
    });
    // Always expand single-item groups
    navGroups.forEach((g) => {
      if (g.items.length === 1) initial.add(g.label);
    });
    return initial;
  });

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-16 lg:w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
              <span className="text-sidebar-primary-foreground font-bold text-sm">W</span>
            </div>
            <span className="text-sidebar-foreground font-semibold text-sm hidden lg:block">
              WeDo
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-3 overflow-y-auto">
          {navGroups.map((group) => {
            const isExpanded = expandedGroups.has(group.label);
            const hasActiveItem = group.items.some((i) => i.path === location.pathname);

            return (
              <div key={group.label}>
                {/* Group header — hidden on mobile (icon-only sidebar) */}
                <button
                  onClick={() => toggleGroup(group.label)}
                  className={cn(
                    "w-full hidden lg:flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                    hasActiveItem
                      ? "text-sidebar-primary"
                      : "text-sidebar-foreground/40 hover:text-sidebar-foreground/60"
                  )}
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform duration-200",
                      !isExpanded && "-rotate-90"
                    )}
                  />
                </button>

                {/* Items */}
                <div
                  className={cn(
                    "space-y-0.5 mt-0.5 overflow-hidden transition-all duration-200",
                    // On desktop, respect collapsed state; on mobile always show icons
                    !isExpanded ? "lg:max-h-0 lg:opacity-0" : "lg:max-h-96 lg:opacity-100"
                  )}
                >
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <Tooltip key={item.path} delayDuration={0}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => navigate(item.path)}
                            className={cn(
                              "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                              isActive
                                ? "bg-sidebar-accent text-sidebar-primary-foreground font-medium"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            )}
                          >
                            <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive && "text-sidebar-primary")} />
                            <span className="hidden lg:block truncate">{item.label}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="lg:hidden">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2">
            <div className="h-7 w-7 rounded-full bg-sidebar-accent flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] text-sidebar-foreground/60 font-medium">v1</span>
            </div>
            <span className="text-xs text-sidebar-foreground/50 hidden lg:block">WeDo v1.0</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
