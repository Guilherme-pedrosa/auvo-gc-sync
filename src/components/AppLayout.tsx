import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  RefreshCw, BarChart3, Kanban, LayoutDashboard, ListChecks, Radio, Wrench, CalendarDays, ChevronDown, Users, LogOut, Shield, FileText, PanelLeftClose, PanelLeft
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
      { label: "Controle OS", icon: FileText, path: "/financeiro/relatorios" },
    ],
  },
  {
    label: "Kanban",
    items: [
      { label: "Orçamentos", icon: Kanban, path: "/financeiro/kanban-orcamentos" },
      { label: "Personalizado", icon: ListChecks, path: "/financeiro/kanban-personalizado" },
      { label: "Ordens de Serviço", icon: Wrench, path: "/financeiro/kanban-os" },
      { label: "Oficina", icon: Wrench, path: "/financeiro/kanban-oficina" },
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
  const { profile, isAdmin, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const allGroups: NavGroup[] = isAdmin
    ? [...navGroups, { label: "Administração", items: [{ label: "Usuários", icon: Users, path: "/admin/usuarios" }] }]
    : navGroups;

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    allGroups.forEach((g) => {
      if (g.items.some((i) => i.path === location.pathname)) initial.add(g.label);
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

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={cn(
        "flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col h-full transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-56"
      )}>
        {/* Logo + collapse toggle */}
        <div className="h-14 flex items-center justify-between px-3 border-b border-sidebar-border">
          <div className={cn("flex items-center gap-2.5 overflow-hidden", collapsed && "justify-center w-full")}>
            <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
              <span className="text-sidebar-primary-foreground font-bold text-sm">W</span>
            </div>
            {!collapsed && <span className="text-sidebar-foreground font-semibold text-sm whitespace-nowrap">WeDo</span>}
          </div>
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 py-3 px-2 space-y-3 overflow-y-auto">
          {allGroups.map((group) => {
            const isExpanded = expandedGroups.has(group.label);
            const hasActiveItem = group.items.some((i) => i.path === location.pathname);

            return (
              <div key={group.label}>
                {!collapsed && (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                      hasActiveItem ? "text-sidebar-primary" : "text-sidebar-foreground/40 hover:text-sidebar-foreground/60"
                    )}
                  >
                    <span>{group.label}</span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", !isExpanded && "-rotate-90")} />
                  </button>
                )}

                <div className={cn(
                  "space-y-0.5 mt-0.5 overflow-hidden transition-all duration-200",
                  !collapsed && !isExpanded ? "max-h-0 opacity-0" : "max-h-96 opacity-100"
                )}>
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <Tooltip key={item.path} delayDuration={0}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => navigate(item.path)}
                            className={cn(
                              "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                              collapsed && "justify-center px-0",
                              isActive
                                ? "bg-sidebar-accent text-sidebar-primary-foreground font-medium"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            )}
                          >
                            <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive && "text-sidebar-primary")} />
                            {!collapsed && <span className="truncate">{item.label}</span>}
                          </button>
                        </TooltipTrigger>
                        {collapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="px-2 py-2 border-t border-sidebar-border">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCollapsed(false)}
                  className="w-full flex items-center justify-center py-2 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expandir menu</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* User footer */}
        <div className={cn("p-3 border-t border-sidebar-border space-y-2", collapsed && "px-2")}>
          <div className={cn("flex items-center gap-2 px-2", collapsed && "justify-center px-0")}>
            <div className="h-7 w-7 rounded-full bg-sidebar-accent flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] text-sidebar-foreground/80 font-medium">
                {profile?.nome?.charAt(0)?.toUpperCase() || "?"}
              </span>
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs text-sidebar-foreground truncate">{profile?.nome || "Usuário"}</p>
                <p className="text-[10px] text-sidebar-foreground/50 flex items-center gap-1">
                  {isAdmin && <Shield className="h-2.5 w-2.5" />}
                  {isAdmin ? "Admin" : "Usuário"}
                </p>
              </div>
            )}
          </div>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleSignOut}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors",
                  collapsed && "justify-center px-0"
                )}
              >
                <LogOut className="h-4 w-4 flex-shrink-0" />
                {!collapsed && <span className="text-xs">Sair</span>}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Sair</TooltipContent>}
          </Tooltip>
        </div>
      </aside>

      <main className="flex-1 min-w-0 h-full overflow-auto">{children}</main>
    </div>
  );
}
