import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  RefreshCw, BarChart3, Kanban, Settings, LayoutDashboard, DollarSign, ListChecks, Radio, Wrench, CalendarDays
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/",
  },
  {
    label: "Auvo → GC Sync",
    icon: RefreshCw,
    path: "/financeiro/auvo-sync",
  },
  {
    label: "Dashboard Técnicos",
    icon: BarChart3,
    path: "/financeiro/dashboard-tecnicos",
  },
  {
    label: "Kanban Orçamentos",
    icon: Kanban,
    path: "/financeiro/kanban-orcamentos",
  },
  {
    label: "Kanban Personalizado",
    icon: ListChecks,
    path: "/financeiro/kanban-personalizado",
  },
  {
    label: "Acompanhamento",
    icon: Radio,
    path: "/financeiro/acompanhamento",
  },
  {
    label: "Kanban OS",
    icon: Wrench,
    path: "/financeiro/kanban-os",
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

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
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {navItems.map((item) => {
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
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2">
            <div className="h-7 w-7 rounded-full bg-sidebar-accent flex items-center justify-center flex-shrink-0">
              <Settings className="h-3.5 w-3.5 text-sidebar-foreground/60" />
            </div>
            <span className="text-xs text-sidebar-foreground/50 hidden lg:block">v1.0</span>
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
