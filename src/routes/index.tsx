
export default function Index() {
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-red-600">ANÁLISE DE DIVERGÊNCIA: PREVENTIVA MÁQUINA DE GELO</h1>
      
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4">
        <p className="font-bold">Por que a tarefa #76542478 não aparece como "executada" no Relatório de OS Abertas?</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border p-4 rounded shadow-sm space-y-2">
          <h2 className="font-bold border-b pb-1 text-blue-700">Dados Identificados</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li><strong>Equipamento:</strong> #MÁQUINA DE GELO EVEREST (ID 4011157)</li>
            <li><strong>Cliente:</strong> NIP NAPOLI - REDE IZ</li>
            <li><strong>Tarefa:</strong> #76542478 (Visita Preventiva + OS)</li>
            <li><strong>Data Conclusão:</strong> 07/07/2026</li>
            <li><strong>Vínculo ERP:</strong> OS #10028 (ID 389541490)</li>
            <li><strong>Situação Atual no ERP:</strong> EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA</li>
          </ul>
        </div>

        <div className="border p-4 rounded shadow-sm space-y-2">
          <h2 className="font-bold border-b pb-1 text-red-700">Causa da Divergência</h2>
          <p className="text-sm">
            No <strong>Controle de OS (Relatório de OS Abertas)</strong>, o sistema prioriza o vínculo financeiro canônico. 
            A OS #10028 está configurada com a tarefa de execução <strong>#78084137</strong> (realizada em 10/08/2026), 
            o que sobrescreve a preventiva de julho no contexto financeiro dessa OS.
          </p>
          <p className="text-sm font-semibold">
            A preventiva de 07/07 está corretamente registrada no histórico técnico do equipamento, mas não é a "execução atual" vinculada financeiramente à OS #10028.
          </p>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded text-sm">
        <p><strong>Ação tomada:</strong> Verificado no banco de dados que a tarefa está sincronizada. A "falta" no relatório é uma regra de negócio de priorização (Execução Final > Preventiva Intermediária) para evitar duplicidade de faturamento na mesma OS.</p>
      </div>

      <div className="pt-4">
        <p className="text-sm text-gray-500 mb-2">Imagem de referência enviada:</p>
        <img src="https://sorax.lovable.app/api/public/i/jw8vwa966q.png" className="max-w-full rounded shadow border" alt="Referência" />
      </div>
    </div>
  );
}

