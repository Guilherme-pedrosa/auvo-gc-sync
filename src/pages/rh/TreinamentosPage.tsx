import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap } from "lucide-react";

export default function TreinamentosPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Treinamentos</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro central de treinamentos. Cada treinamento terá dados gerais, participantes, arquivos e histórico.
          Os participantes selecionados serão vinculados automaticamente ao prontuário dos colaboradores.
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
          A estrutura do módulo está reservada. O cadastro de treinamentos, participantes e certificados
          será habilitado em uma próxima etapa, reutilizando as tabelas e componentes já existentes de RH.
        </CardContent>
      </Card>
    </div>
  );
}