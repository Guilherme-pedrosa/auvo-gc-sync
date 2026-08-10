export default function Index() {
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-red-600">ANÁLISE E CORREÇÃO: DATA DA ÚLTIMA PREVENTIVA (#4011157)</h1>
      
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4">
        <p className="font-bold">Por que o sistema estava exibindo 06/02/2026 em vez de 07/07/2026?</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border p-4 rounded shadow-sm space-y-2 bg-white">
          <h2 className="font-bold border-b pb-1 text-blue-700">Diagnóstico</h2>
          <ul className="list-disc pl-5 text-sm space-y-2 text-slate-700">
            <li><strong>Banco de Dados Consolidado:</strong> Já possuía a data correta (07/07/2026).</li>
            <li><strong>Módulo de Plano:</strong> O "Plano de Preventivas" estava com uma informação defasada (06/02/2026) salvada em seu cache interno.</li>
            <li><strong>Causa da Exibição:</strong> O código da página priorizava qualquer dado vindo do Plano sobre o dado real dos vínculos do Auvo, causando a regressão visual da data.</li>
          </ul>
        </div>

        <div className="border p-4 rounded shadow-sm space-y-2 bg-emerald-50">
          <h2 className="font-bold border-b pb-1 text-emerald-700">Correção Aplicada</h2>
          <p className="text-sm text-slate-700">
            Ajustei a lógica em <code>EquipamentosPreventivosPage.tsx</code> para que o Plano de Preventivas <strong>nunca</strong> sobrescreva a data da última execução se a data detectada nativamente no Auvo for mais recente.
          </p>
          <p className="text-xs font-semibold text-emerald-800">
            Agora o sistema sempre exibirá a preventiva mais atual, independentemente de atrasos na atualização do cache do plano anual.
          </p>
        </div>
      </div>

      <div className="bg-gray-100 p-4 rounded text-sm italic">
        <p>A data de 07/07/2026 agora deve ser exibida corretamente na listagem para a Máquina de Gelo do cliente NIP NAPOLI.</p>
      </div>

      <div className="pt-4">
        <p className="text-sm text-gray-500 mb-2">Referência do erro relatado:</p>
        <img src="https://sorax.lovable.app/api/public/i/800hjn6a01.png" className="max-w-full rounded shadow border" alt="Erro na data" />
      </div>
    </div>
  );
}

