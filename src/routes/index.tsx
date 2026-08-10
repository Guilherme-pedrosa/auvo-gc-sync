export default function Index() {
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-blue-600">DOCUMENTAÇÃO: DIÁLOGO DE AGENDAMENTO (PREVISÃO)</h1>
      
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
        <p className="font-bold text-blue-900">Atualização do "Editar Previsão" / "Agendar Execução"</p>
        <p className="text-sm text-blue-800">Conforme solicitado, o diálogo agora apresenta os detalhes do orçamento e avisos de estoque sincronizados.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border p-4 rounded shadow-sm space-y-2 bg-white">
          <h2 className="font-bold border-b pb-1 text-slate-700">O que foi adicionado:</h2>
          <ul className="list-disc pl-5 text-sm space-y-2 text-slate-600">
            <li><strong>Detalhes do Orçamento:</strong> Exibição do número do orçamento diretamente no card de edição.</li>
            <li><strong>Link GestãoClick:</strong> Botão "Ver no GC" que abre o orçamento no ERP (modo edição).</li>
            <li><strong>Status de Chegadas:</strong> Alerta visual quando há peças sem saldo ou aguardando reposição.</li>
            <li><strong>Data Mínima:</strong> Bloqueio/aviso de data baseado na previsão de chegada de peças do Controle Chegadas.</li>
          </ul>
        </div>

        <div className="border p-4 rounded shadow-sm space-y-2 bg-slate-50">
          <h2 className="font-bold border-b pb-1 text-slate-700">Origem dos Dados:</h2>
          <p className="text-sm text-slate-600">
            As informações são injetadas a partir do <code>ChegadaItem</code> na <code>AgendamentoPage.tsx</code>, 
            garantindo que o usuário veja o status real das peças antes de confirmar a previsão com o técnico.
          </p>
        </div>
      </div>

      <div className="pt-4 border-t">
        <p className="text-sm font-medium text-slate-500 mb-2">Referência visual do layout atualizado:</p>
        <div className="max-w-md border rounded-lg shadow-xl overflow-hidden bg-white p-4">
           <div className="flex items-center justify-between border-b pb-2 mb-3">
             <span className="font-bold text-sm">Editar previsão</span>
             <span className="text-slate-400 text-xs">✕</span>
           </div>
           <div className="space-y-3 opacity-80 pointer-events-none">
             <div className="h-8 bg-slate-100 rounded w-full"></div>
             <div className="grid grid-cols-2 gap-2">
               <div className="h-8 bg-slate-100 rounded"></div>
               <div className="h-8 bg-slate-100 rounded"></div>
             </div>
             <div className="p-2 bg-slate-50 border rounded text-[10px] space-y-1">
               <div className="flex justify-between font-bold border-b pb-1">
                 <span>Orçamento 12345</span>
                 <span className="text-blue-600 underline">Ver no GC</span>
               </div>
               <div className="text-amber-800 bg-amber-50 p-1 rounded">
                 <strong>Aviso:</strong> Aguardando chegada de peças...
               </div>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
}

