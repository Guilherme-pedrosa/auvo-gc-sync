import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redireciona para o Agendamento de Equipe, que é o ponto central
    navigate("/operacional/agendamento-equipe", { replace: true });
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <p className="text-lg whitespace-pre-wrap">
        me responda qual o motivo da redução da premiação do Denilson?{"\n\n"}
        Veja o link da imagem enviada abaixo e analise o conteúdo dela para responder:{"\n"}
        Imagem 1: <a href="https://sorax.lovable.app/api/public/i/9fsxhjiym9.png" className="text-blue-500 underline">https://sorax.lovable.app/api/public/i/9fsxhjiym9.png</a>
      </p>
    </div>
  );
}