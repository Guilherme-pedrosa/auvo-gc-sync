import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap } from "lucide-react";

export default function TiposTreinamentoPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Tipos de Treinamento</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo dos tipos de treinamento (NR-10, NR-35, primeiros socorros, etc.) usados no cadastro central.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
            Módulo em preparação
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configuração reservada. Os tipos serão gerenciados aqui em uma próxima etapa.
        </CardContent>
      </Card>
    </div>
  );
}