export default function Index() {
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-blue-600">LÓGICA DE CORES: QUADRO DE AGENDAMENTO (CHEGADA)</h1>
      
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
        <p className="font-bold text-blue-900">Como as cores dos cards são definidas?</p>
        <p className="text-sm text-blue-800">A lógica de cores no quadro "Chegada Orçamentos" baseia-se no status da entrega das peças em relação à data atual e à disponibilidade de estoque.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border p-4 rounded shadow-sm space-y-2 bg-white">
          <h2 className="font-bold border-b pb-1 text-slate-700">1. Status de Chegada (Bordas e Ícones)</h2>
          <ul className="list-disc pl-5 text-sm space-y-2 text-slate-600">
            <li><span className="text-red-600 font-bold">Vermelho (Atrasada):</span> Data de chegada prevista é anterior a hoje e as peças não foram confirmadas.</li>
            <li><span className="text-amber-600 font-bold">Amarelo (Hoje):</span> As peças têm previsão de chegada para a data atual.</li>
            <li><span className="text-emerald-600 font-bold">Verde (Prevista):</span> Data de chegada futura confirmada nos pedidos de compra.</li>
            <li><span className="text-slate-400 font-bold">Cinza (Sem Data):</span> O orçamento/pedido não possui nenhuma data de previsão vinculada no ERP.</li>
          </ul>
        </div>

        <div className="border p-4 rounded shadow-sm space-y-2 bg-slate-50">
          <h2 className="font-bold border-b pb-1 text-slate-700">2. Status de Execução (Badges Internas)</h2>
          <ul className="list-disc pl-5 text-sm space-y-2 text-slate-600">
            <li><strong>Verde:</strong> "Disponível em estoque" (Pode agendar agora).</li>
            <li><strong>Amarelo:</strong> "Sem estoque · aguarda reposição" (Existe pedido de compra vinculado).</li>
            <li><strong>Cinza:</strong> "Estoque não confirmado" (Aguardando verificação técnica/administrativa).</li>
            <li><strong>Vermelho (Alerta):</strong> "OS já lançada" (Evita duplicidade de tarefas no Auvo).</li>
          </ul>
        </div>
      </div>

      <div className="bg-gray-50 border p-4 rounded text-xs text-slate-500">
        <p><strong>Nota técnica:</strong> As cores no calendário seguem a mesma lógica (<code>STATUS_STYLE</code>), priorizando a cor de "Atraso" se houver qualquer item crítico no dia.</p>
      </div>

      <div className="pt-4">
        <p className="text-sm text-gray-500 mb-2">Referência visual analisada:</p>
        <img src="user-uploads://image-742.png" className="max-w-full rounded shadow border" alt="Quadro de Agendamento" />
      </div>
    </div>
  );
}

