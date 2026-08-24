import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redireciona para o Agendamento de Equipe, que é o ponto central
    navigate("/operacional/agendamento-equipe", { replace: true });
  }, [navigate]);

  return null;
}