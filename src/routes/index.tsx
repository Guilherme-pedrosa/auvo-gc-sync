export default function Index() {
  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <header className="space-y-2 border-b pb-6">
        <h1 className="text-3xl font-bold text-blue-700 tracking-tight">Lógica de Validação: Auvo ↔ GestãoClick</h1>
        <p className="text-slate-500 italic">
          Entenda como o sistema identifica se uma tarefa foi finalizada corretamente e sem pendências.
        </p>
      </header>

      <section className="space-y-4">
        <div className="bg-emerald-50 border-l-4 border-emerald-500 p-6 rounded-r-lg shadow-sm">
          <h2 className="text-xl font-bold text-emerald-900 mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white text-xs">✓</span>
            Critérios para o "Verde" (Finalizado OK)
          </h2>
          <p className="text-emerald-800 leading-relaxed mb-4">
            Para que uma tarefa seja considerada <strong>100% concluída</strong> (exibida em verde no agendamento), ela deve atender simultaneamente a três requisitos:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white/60 p-4 rounded border border-emerald-200">
              <span className="block font-bold text-emerald-700 mb-1">1. Status Auvo</span>
              <span className="text-sm text-emerald-900">A tarefa deve estar marcada como <strong>"Finalizada"</strong> no Auvo.</span>
            </div>
            <div className="bg-white/60 p-4 rounded border border-emerald-200">
              <span className="block font-bold text-emerald-700 mb-1">2. Registros Físicos</span>
              <span className="text-sm text-emerald-900">É obrigatório possuir tanto o <strong>Check-in</strong> quanto o <strong>Check-out</strong> (ISO timestamps) realizados pelo técnico.</span>
            </div>
            <div className="bg-white/60 p-4 rounded border border-emerald-200">
              <span className="block font-bold text-emerald-700 mb-1">3. Sem Pendências GC</span>
              <span className="text-sm text-emerald-900">A situação da OS no GestãoClick <strong>não</strong> pode conter palavras como: <em>Pendente, Negociação, Aguardando, Correção ou Separação</em>.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border p-5 rounded-lg shadow-sm bg-amber-50 border-amber-200">
          <h3 className="font-bold text-amber-900 mb-2">Atenção: Amarelo Escuro</h3>
          <p className="text-sm text-amber-800">
            Se a tarefa está <strong>Finalizada</strong> mas o texto aparece em <strong>amarelo escuro</strong>, significa que algum dos requisitos acima falhou (ex: falta de check-in ou OS ainda está em 'Aguardando Peças').
          </p>
        </div>
        <div className="border p-5 rounded-lg shadow-sm bg-red-50 border-red-200">
          <h3 className="font-bold text-red-900 mb-2">Alerta: Texto Vermelho</h3>
          <p className="text-sm text-red-800">
            Indica tarefas <strong>Pausadas</strong> ou tarefas agendadas que <strong>atrasaram mais de 2 horas</strong> do horário previsto sem terem sido iniciadas/concluídas.
          </p>
        </div>
      </section>

      <section className="bg-slate-50 border p-6 rounded-lg space-y-4">
        <h3 className="font-bold text-slate-800 border-b pb-2">Como o sistema descobre a OS?</h3>
        <p className="text-sm text-slate-600 leading-relaxed">
          O sistema realiza um cruzamento inteligente:
        </p>
        <ul className="list-disc pl-5 text-sm space-y-2 text-slate-700">
          <li><strong>Prioridade 1:</strong> Procura pelo ID da tarefa no campo customizado <code>73343 (Tarefa OS)</code> da Ordem de Serviço.</li>
          <li><strong>Prioridade 2:</strong> Se não encontrar, varre o campo <code>73344 (Tarefa Execução)</code>, que pode conter múltiplos IDs separados por barra.</li>
          <li><strong>Fallback:</strong> Tenta extrair referências de orçamento (ex: <code>#5835</code>) ou números de OS diretamente da <strong>Orientação</strong> da tarefa no Auvo.</li>
        </ul>
      </section>

      <footer className="pt-4 border-t text-center space-y-4">
        <div className="bg-blue-50 border-blue-200 border p-4 rounded text-left">
          <h3 className="text-blue-800 font-bold text-sm mb-2">Exibição de Detalhes da OS</h3>
          <p className="text-xs text-blue-700 leading-relaxed">
            Os diálogos de detalhes de tarefa agora exibem informações completas da OS vinculada (Faturamento, Vendedor e Data de Abertura), alinhados com o padrão do Controle de OS para facilitar a conferência de valores.
          </p>
        </div>
        
        <p className="text-xs text-gray-400">
          ignore o dito acima.
          
          eu preciso de um filtro de clientes, preciso de um filtro para os que não estão vinculados, preciso ver o nome completo do clientes
          
          RH &gt; Clientes
          
          Veja o link da imagem enviada abaixo e analise o conteúdo dela para responder:
          Imagem 1: https://sorax.lovable.app/api/public/i/j11gw3z01q.png
        </p>
      </footer>
    </div>
  );
}





