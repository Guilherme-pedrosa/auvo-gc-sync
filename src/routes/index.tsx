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
      como que 20% de 1142 é 913 reais???? na premiação você está debitando errado novamente!!!
      <br /><br />
      Verifique novamente mais uma vez o que eu te pedi mil vezes
      <br /><br />
      Veja o link da imagem enviada abaixo e analise o conteúdo dela para responder:
      <br />
      Imagem 1: https://sorax.lovable.app/api/public/i/idjapf981c.png
    </div>
  );
}