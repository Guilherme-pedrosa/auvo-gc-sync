import { Component, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
  }

  private handleReset = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("signOut falhou:", err);
    }
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("sb-") || k.includes("supabase"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
    window.location.href = "/login";
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-lg w-full space-y-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">Algo deu errado</h1>
          <p className="text-sm text-muted-foreground">
            Ocorreu um erro ao carregar a aplicação. Tente limpar a sessão e entrar novamente.
          </p>
          <pre className="text-left text-xs bg-muted p-3 rounded overflow-auto max-h-48">
            {this.state.error.message}
            {this.state.error.stack ? "\n\n" + this.state.error.stack : ""}
          </pre>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted"
            >
              Recarregar
            </button>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
            >
              Limpar sessão e fazer login
            </button>
          </div>
        </div>
      </div>
    );
  }
}