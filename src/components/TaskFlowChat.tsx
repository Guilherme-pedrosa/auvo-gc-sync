import { useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const TASKFLOW_EMBED_BASE = "https://calendar-todo-dance.lovable.app/embed/chat";

interface TaskFlowChatProps {
  /** ID da OS quando o chat é aberto a partir de uma OS específica */
  osId?: string | number;
  /** Número/código amigável da OS (aparece no header) */
  osNumber?: string;
  /** URL pra abrir essa OS no Auvo */
  auvoLink?: string;
  /** URL pra abrir essa OS no GestãoClick */
  gcLink?: string;
  /** Identificador da página (default: pega da rota) */
  page?: string;
  /** Variante visual */
  variant?: "floating" | "inline";
  /** Label do botão (apenas inline) */
  label?: string;
}

/**
 * Botão que abre o chat do TaskFlow num drawer lateral.
 * Cada combinação de (osId + page) gera uma thread única e persistente.
 */
export function TaskFlowChat({
  osId,
  osNumber,
  auvoLink,
  gcLink,
  page,
  variant = "floating",
  label = "Chat",
}: TaskFlowChatProps) {
  const location = useLocation();
  const params = useParams();
  const [open, setOpen] = useState(false);

  const pageId =
    page ||
    location.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\//g, "-")
      .replace(/[^a-z0-9-]/gi, "")
      .toLowerCase() ||
    "home";

  const finalOsId = osId ?? params.id ?? params.osId;
  const sourceUrl = typeof window !== "undefined" ? window.location.href : "";

  const embedUrl = (() => {
    const url = new URL(TASKFLOW_EMBED_BASE);
    if (finalOsId) url.searchParams.set("osId", String(finalOsId));
    if (osNumber) url.searchParams.set("osNumber", osNumber);
    url.searchParams.set("page", pageId);
    if (auvoLink) url.searchParams.set("auvoLink", auvoLink);
    if (gcLink) url.searchParams.set("gcLink", gcLink);
    if (sourceUrl) url.searchParams.set("sourceUrl", sourceUrl);
    return url.toString();
  })();

  const trigger =
    variant === "floating" ? (
      <Button
        type="button"
        size="icon"
        className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-lg"
        aria-label="Abrir Chat TaskFlow"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
    ) : (
      <Button type="button" variant="outline" size="sm">
        <MessageSquare className="h-4 w-4" />
        {label}
      </Button>
    );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="min-w-0 text-sm font-semibold text-foreground">
            Chat TaskFlow
            {osNumber && <span className="text-muted-foreground"> · OS {osNumber}</span>}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Fechar Chat TaskFlow">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className={cn("min-h-0 flex-1 bg-background", !open && "hidden")}>
          {open && <iframe title="Chat TaskFlow" src={embedUrl} className="h-full w-full border-0" allow="clipboard-write" />}
        </div>
      </SheetContent>
    </Sheet>
  );
}