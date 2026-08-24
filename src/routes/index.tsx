import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redireciona para o Agendamento de Equipe, que é o ponto central
    navigate("/operacional/agendamento-equipe", { replace: true });
  }, [navigate]);

  return (
    <div className="p-8">
      depois que seleciona o filtro, não é possível mais apagar a seleção.
      <br /><br />
      corrija
      <br /><br />
      Veja o link da imagem enviada abaixo e analise o conteúdo dela para responder:
      <br />
      Imagem 1: https://sorax.lovable.app/api/public/i/ugdxp8lkec.png
    </div>
  );
}