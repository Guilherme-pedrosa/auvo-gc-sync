export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alertas_horas_config: {
        Row: {
          atualizado_em: string
          curta_requer_revisao: boolean | null
          detectar_horas_negativas: boolean
          detectar_overlap_tecnico: boolean
          excessiva_requer_revisao: boolean | null
          id: string
          limite_excessivo_horas: number
          limite_maximo_horas: number
          limite_minimo_minutos: number
          longa_requer_revisao: boolean | null
          negativa_requer_revisao: boolean | null
          overlap_requer_revisao: boolean | null
          sem_checkout_requer_revisao: boolean | null
          sem_janela_requer_revisao: boolean | null
        }
        Insert: {
          atualizado_em?: string
          curta_requer_revisao?: boolean | null
          detectar_horas_negativas?: boolean
          detectar_overlap_tecnico?: boolean
          excessiva_requer_revisao?: boolean | null
          id?: string
          limite_excessivo_horas?: number
          limite_maximo_horas?: number
          limite_minimo_minutos?: number
          longa_requer_revisao?: boolean | null
          negativa_requer_revisao?: boolean | null
          overlap_requer_revisao?: boolean | null
          sem_checkout_requer_revisao?: boolean | null
          sem_janela_requer_revisao?: boolean | null
        }
        Update: {
          atualizado_em?: string
          curta_requer_revisao?: boolean | null
          detectar_horas_negativas?: boolean
          detectar_overlap_tecnico?: boolean
          excessiva_requer_revisao?: boolean | null
          id?: string
          limite_excessivo_horas?: number
          limite_maximo_horas?: number
          limite_minimo_minutos?: number
          longa_requer_revisao?: boolean | null
          negativa_requer_revisao?: boolean | null
          overlap_requer_revisao?: boolean | null
          sem_checkout_requer_revisao?: boolean | null
          sem_janela_requer_revisao?: boolean | null
        }
        Relationships: []
      }
      atividades_nao_executadas: {
        Row: {
          auvo_task_id: string
          cliente: string | null
          data_planejada: string
          descricao: string | null
          id: string
          motivo: string | null
          registrado_em: string
          status_original: string
          tecnico_id: string
          tecnico_nome: string
        }
        Insert: {
          auvo_task_id: string
          cliente?: string | null
          data_planejada: string
          descricao?: string | null
          id?: string
          motivo?: string | null
          registrado_em?: string
          status_original?: string
          tecnico_id: string
          tecnico_nome: string
        }
        Update: {
          auvo_task_id?: string
          cliente?: string | null
          data_planejada?: string
          descricao?: string | null
          id?: string
          motivo?: string | null
          registrado_em?: string
          status_original?: string
          tecnico_id?: string
          tecnico_nome?: string
        }
        Relationships: []
      }
      auvo_gc_sync_log: {
        Row: {
          detalhes: Json | null
          dry_run: boolean | null
          duracao_ms: number | null
          erros: number | null
          executado_em: string
          id: string
          observacao: string | null
          os_atualizadas: number | null
          os_candidatas: number | null
          os_com_pendencia: number | null
          os_divergencia_pecas: number | null
          os_nao_encontradas: number | null
          os_sem_pendencia: number | null
        }
        Insert: {
          detalhes?: Json | null
          dry_run?: boolean | null
          duracao_ms?: number | null
          erros?: number | null
          executado_em?: string
          id?: string
          observacao?: string | null
          os_atualizadas?: number | null
          os_candidatas?: number | null
          os_com_pendencia?: number | null
          os_divergencia_pecas?: number | null
          os_nao_encontradas?: number | null
          os_sem_pendencia?: number | null
        }
        Update: {
          detalhes?: Json | null
          dry_run?: boolean | null
          duracao_ms?: number | null
          erros?: number | null
          executado_em?: string
          id?: string
          observacao?: string | null
          os_atualizadas?: number | null
          os_candidatas?: number | null
          os_com_pendencia?: number | null
          os_divergencia_pecas?: number | null
          os_nao_encontradas?: number | null
          os_sem_pendencia?: number | null
        }
        Relationships: []
      }
      auvo_gc_usuario_map: {
        Row: {
          ativo: boolean | null
          atualizado_em: string | null
          auvo_user_id: string
          auvo_user_nome: string
          criado_em: string | null
          gc_vendedor_id: string
          gc_vendedor_nome: string
          id: string
        }
        Insert: {
          ativo?: boolean | null
          atualizado_em?: string | null
          auvo_user_id: string
          auvo_user_nome: string
          criado_em?: string | null
          gc_vendedor_id: string
          gc_vendedor_nome: string
          id?: string
        }
        Update: {
          ativo?: boolean | null
          atualizado_em?: string | null
          auvo_user_id?: string
          auvo_user_nome?: string
          criado_em?: string | null
          gc_vendedor_id?: string
          gc_vendedor_nome?: string
          id?: string
        }
        Relationships: []
      }
      contratos: {
        Row: {
          ativo: boolean
          atualizado_em: string
          cliente_nome: string | null
          criado_em: string
          grupo_id: string | null
          horas_mes_contratadas: number | null
          id: string
          nome: string
          observacao: string | null
          premiacao_preventiva_hora: number
          taxa_comissao_peca: number
          taxa_comissao_servico: number
          valor_hora: number
          vigencia_fim: string | null
          vigencia_inicio: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          cliente_nome?: string | null
          criado_em?: string
          grupo_id?: string | null
          horas_mes_contratadas?: number | null
          id?: string
          nome: string
          observacao?: string | null
          premiacao_preventiva_hora?: number
          taxa_comissao_peca?: number
          taxa_comissao_servico?: number
          valor_hora?: number
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          cliente_nome?: string | null
          criado_em?: string
          grupo_id?: string | null
          horas_mes_contratadas?: number | null
          id?: string
          nome?: string
          observacao?: string | null
          premiacao_preventiva_hora?: number
          taxa_comissao_peca?: number
          taxa_comissao_servico?: number
          valor_hora?: number
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      demerito_lancamentos: {
        Row: {
          criado_em: string
          criado_por: string | null
          id: string
          mes: string
          motivo_id: string | null
          motivo_nome: string
          observacao: string | null
          percentual: number
          tecnico_nome: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          mes: string
          motivo_id?: string | null
          motivo_nome: string
          observacao?: string | null
          percentual?: number
          tecnico_nome: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          mes?: string
          motivo_id?: string | null
          motivo_nome?: string
          observacao?: string | null
          percentual?: number
          tecnico_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "demerito_lancamentos_motivo_id_fkey"
            columns: ["motivo_id"]
            isOneToOne: false
            referencedRelation: "demerito_motivos"
            referencedColumns: ["id"]
          },
        ]
      }
      demerito_motivos: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          id: string
          nome: string
          percentual: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          id?: string
          nome: string
          percentual?: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          id?: string
          nome?: string
          percentual?: number
        }
        Relationships: []
      }
      equipamento_plano_adiamentos: {
        Row: {
          ano_referencia: number
          criado_em: string
          criado_por: string | null
          id: string
          justificativa: string | null
          mes_destino: number
          mes_origem: number
          plano_id: string
        }
        Insert: {
          ano_referencia: number
          criado_em?: string
          criado_por?: string | null
          id?: string
          justificativa?: string | null
          mes_destino: number
          mes_origem: number
          plano_id: string
        }
        Update: {
          ano_referencia?: number
          criado_em?: string
          criado_por?: string | null
          id?: string
          justificativa?: string | null
          mes_destino?: number
          mes_origem?: number
          plano_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_plano_adiamentos_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "equipamento_plano_preventivo"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_plano_excecoes: {
        Row: {
          criado_em: string
          criado_por: string | null
          id: string
          mes: number
          motivo: string | null
          plano_id: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          mes: number
          motivo?: string | null
          plano_id: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          mes?: number
          motivo?: string | null
          plano_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_plano_excecoes_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "equipamento_plano_preventivo"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_plano_preventivo: {
        Row: {
          adiamentos_count: number
          ano_referencia: number
          ativo: boolean
          atualizado_em: string
          cliente_nome: string
          codigo_barras_auvo: string
          criado_em: string
          criado_por: string | null
          criticidade: Database["public"]["Enums"]["preventiva_criticidade"]
          data_inativacao: string | null
          grupo_id: string
          horas_estimadas_total: number
          horas_por_tecnico: number
          id: string
          mes_inicio_ciclo: number
          observacao: string | null
          periodicidade: Database["public"]["Enums"]["preventiva_periodicidade"]
          qtd_tecnicos: number
          status: Database["public"]["Enums"]["preventiva_status"]
        }
        Insert: {
          adiamentos_count?: number
          ano_referencia: number
          ativo?: boolean
          atualizado_em?: string
          cliente_nome: string
          codigo_barras_auvo: string
          criado_em?: string
          criado_por?: string | null
          criticidade?: Database["public"]["Enums"]["preventiva_criticidade"]
          data_inativacao?: string | null
          grupo_id: string
          horas_estimadas_total: number
          horas_por_tecnico: number
          id?: string
          mes_inicio_ciclo?: number
          observacao?: string | null
          periodicidade: Database["public"]["Enums"]["preventiva_periodicidade"]
          qtd_tecnicos?: number
          status?: Database["public"]["Enums"]["preventiva_status"]
        }
        Update: {
          adiamentos_count?: number
          ano_referencia?: number
          ativo?: boolean
          atualizado_em?: string
          cliente_nome?: string
          codigo_barras_auvo?: string
          criado_em?: string
          criado_por?: string | null
          criticidade?: Database["public"]["Enums"]["preventiva_criticidade"]
          data_inativacao?: string | null
          grupo_id?: string
          horas_estimadas_total?: number
          horas_por_tecnico?: number
          id?: string
          mes_inicio_ciclo?: number
          observacao?: string | null
          periodicidade?: Database["public"]["Enums"]["preventiva_periodicidade"]
          qtd_tecnicos?: number
          status?: Database["public"]["Enums"]["preventiva_status"]
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_plano_preventivo_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_preventiva_consolidado: {
        Row: {
          atualizado_em: string
          auvo_equipment_id: string | null
          categoria: string | null
          cliente: string | null
          criticidade: string | null
          equip_id: string
          equip_status: string | null
          grupo_id: string | null
          horas_por_tecnico: number | null
          ht_por_ocorrencia: number | null
          identificador: string | null
          marca: string | null
          nome: string | null
          periodicidade: string | null
          periodicidade_meses: number | null
          proxima_preventiva: string | null
          proxima_source: string | null
          qtd_tecnicos: number | null
          status_preventiva: string | null
          tipo_id: string | null
          tipo_nome: string | null
          total_tarefas: number
          ultima_preventiva: string | null
          ultima_preventiva_link: string | null
          ultima_preventiva_task_id: string | null
          ultima_preventiva_tecnico: string | null
        }
        Insert: {
          atualizado_em?: string
          auvo_equipment_id?: string | null
          categoria?: string | null
          cliente?: string | null
          criticidade?: string | null
          equip_id: string
          equip_status?: string | null
          grupo_id?: string | null
          horas_por_tecnico?: number | null
          ht_por_ocorrencia?: number | null
          identificador?: string | null
          marca?: string | null
          nome?: string | null
          periodicidade?: string | null
          periodicidade_meses?: number | null
          proxima_preventiva?: string | null
          proxima_source?: string | null
          qtd_tecnicos?: number | null
          status_preventiva?: string | null
          tipo_id?: string | null
          tipo_nome?: string | null
          total_tarefas?: number
          ultima_preventiva?: string | null
          ultima_preventiva_link?: string | null
          ultima_preventiva_task_id?: string | null
          ultima_preventiva_tecnico?: string | null
        }
        Update: {
          atualizado_em?: string
          auvo_equipment_id?: string | null
          categoria?: string | null
          cliente?: string | null
          criticidade?: string | null
          equip_id?: string
          equip_status?: string | null
          grupo_id?: string | null
          horas_por_tecnico?: number | null
          ht_por_ocorrencia?: number | null
          identificador?: string | null
          marca?: string | null
          nome?: string | null
          periodicidade?: string | null
          periodicidade_meses?: number | null
          proxima_preventiva?: string | null
          proxima_source?: string | null
          qtd_tecnicos?: number | null
          status_preventiva?: string | null
          tipo_id?: string | null
          tipo_nome?: string | null
          total_tarefas?: number
          ultima_preventiva?: string | null
          ultima_preventiva_link?: string | null
          ultima_preventiva_task_id?: string | null
          ultima_preventiva_tecnico?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipamento_preventiva_consolidado_equip_id_fkey"
            columns: ["equip_id"]
            isOneToOne: true
            referencedRelation: "equipamentos_auvo"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamento_tarefas_auvo: {
        Row: {
          auvo_equipment_id: string
          auvo_link: string | null
          auvo_task_id: string
          auvo_task_type_description: string | null
          auvo_task_type_id: string | null
          cliente: string | null
          data_conclusao: string | null
          data_tarefa: string | null
          id: string
          source: string
          status_auvo: string | null
          synced_at: string
          tecnico: string | null
        }
        Insert: {
          auvo_equipment_id: string
          auvo_link?: string | null
          auvo_task_id: string
          auvo_task_type_description?: string | null
          auvo_task_type_id?: string | null
          cliente?: string | null
          data_conclusao?: string | null
          data_tarefa?: string | null
          id?: string
          source?: string
          status_auvo?: string | null
          synced_at?: string
          tecnico?: string | null
        }
        Update: {
          auvo_equipment_id?: string
          auvo_link?: string | null
          auvo_task_id?: string
          auvo_task_type_description?: string | null
          auvo_task_type_id?: string | null
          cliente?: string | null
          data_conclusao?: string | null
          data_tarefa?: string | null
          id?: string
          source?: string
          status_auvo?: string | null
          synced_at?: string
          tecnico?: string | null
        }
        Relationships: []
      }
      equipamentos_auvo: {
        Row: {
          atualizado_em: string | null
          auvo_equipment_id: string | null
          categoria: string | null
          cliente: string | null
          criado_em: string | null
          descricao: string | null
          id: string
          identificador: string | null
          marca: string | null
          marca_manual_override: boolean | null
          marca_source: string | null
          nome: string
          override_horas_por_tecnico: number | null
          override_periodicidade: string | null
          override_qtd_tecnicos: number | null
          status: string | null
          tipo_id: string | null
        }
        Insert: {
          atualizado_em?: string | null
          auvo_equipment_id?: string | null
          categoria?: string | null
          cliente?: string | null
          criado_em?: string | null
          descricao?: string | null
          id?: string
          identificador?: string | null
          marca?: string | null
          marca_manual_override?: boolean | null
          marca_source?: string | null
          nome: string
          override_horas_por_tecnico?: number | null
          override_periodicidade?: string | null
          override_qtd_tecnicos?: number | null
          status?: string | null
          tipo_id?: string | null
        }
        Update: {
          atualizado_em?: string | null
          auvo_equipment_id?: string | null
          categoria?: string | null
          cliente?: string | null
          criado_em?: string | null
          descricao?: string | null
          id?: string
          identificador?: string | null
          marca?: string | null
          marca_manual_override?: boolean | null
          marca_source?: string | null
          nome?: string
          override_horas_por_tecnico?: number | null
          override_periodicidade?: string | null
          override_qtd_tecnicos?: number | null
          status?: string | null
          tipo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipamentos_auvo_tipo_id_fkey"
            columns: ["tipo_id"]
            isOneToOne: false
            referencedRelation: "tipos_equipamento"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_kanban_cache: {
        Row: {
          atualizado_em: string
          coluna: string
          criado_em: string
          dados: Json
          gc_orcamento_id: string
          posicao: number
          situacao_id_origem: string
        }
        Insert: {
          atualizado_em?: string
          coluna: string
          criado_em?: string
          dados?: Json
          gc_orcamento_id: string
          posicao?: number
          situacao_id_origem: string
        }
        Update: {
          atualizado_em?: string
          coluna?: string
          criado_em?: string
          dados?: Json
          gc_orcamento_id?: string
          posicao?: number
          situacao_id_origem?: string
        }
        Relationships: []
      }
      followup_kanban_colunas: {
        Row: {
          atualizado_em: string
          criado_em: string
          eh_situacao: boolean
          id: string
          ordem: number
          situacao_id: string | null
          titulo: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          eh_situacao?: boolean
          id: string
          ordem?: number
          situacao_id?: string | null
          titulo: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          eh_situacao?: boolean
          id?: string
          ordem?: number
          situacao_id?: string | null
          titulo?: string
        }
        Relationships: []
      }
      grupo_cliente_membros: {
        Row: {
          cliente_nome: string
          criado_em: string
          grupo_id: string
          id: string
        }
        Insert: {
          cliente_nome: string
          criado_em?: string
          grupo_id: string
          id?: string
        }
        Update: {
          cliente_nome?: string
          criado_em?: string
          grupo_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grupo_cliente_membros_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_clientes: {
        Row: {
          criado_em: string
          id: string
          nome: string
        }
        Insert: {
          criado_em?: string
          id?: string
          nome: string
        }
        Update: {
          criado_em?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      kanban_custom_cache: {
        Row: {
          atualizado_em: string
          auvo_task_id: string
          coluna: string
          config_id: string
          criado_em: string
          dados: Json
          posicao: number
        }
        Insert: {
          atualizado_em?: string
          auvo_task_id: string
          coluna?: string
          config_id?: string
          criado_em?: string
          dados: Json
          posicao?: number
        }
        Update: {
          atualizado_em?: string
          auvo_task_id?: string
          coluna?: string
          config_id?: string
          criado_em?: string
          dados?: Json
          posicao?: number
        }
        Relationships: []
      }
      kanban_oficina_cache: {
        Row: {
          atualizado_em: string
          auvo_task_id: string
          coluna: string
          criado_em: string
          dados: Json
          posicao: number
        }
        Insert: {
          atualizado_em?: string
          auvo_task_id: string
          coluna?: string
          criado_em?: string
          dados: Json
          posicao?: number
        }
        Update: {
          atualizado_em?: string
          auvo_task_id?: string
          coluna?: string
          criado_em?: string
          dados?: Json
          posicao?: number
        }
        Relationships: []
      }
      kanban_orcamentos_cache: {
        Row: {
          atualizado_em: string
          auvo_task_id: string
          coluna: string
          criado_em: string
          dados: Json
          posicao: number
        }
        Insert: {
          atualizado_em?: string
          auvo_task_id: string
          coluna?: string
          criado_em?: string
          dados: Json
          posicao?: number
        }
        Update: {
          atualizado_em?: string
          auvo_task_id?: string
          coluna?: string
          criado_em?: string
          dados?: Json
          posicao?: number
        }
        Relationships: []
      }
      kanban_os_cache: {
        Row: {
          atualizado_em: string
          auvo_task_id: string | null
          coluna: string
          criado_em: string
          gc_os_id: string
          posicao: number
        }
        Insert: {
          atualizado_em?: string
          auvo_task_id?: string | null
          coluna?: string
          criado_em?: string
          gc_os_id: string
          posicao?: number
        }
        Update: {
          atualizado_em?: string
          auvo_task_id?: string | null
          coluna?: string
          criado_em?: string
          gc_os_id?: string
          posicao?: number
        }
        Relationships: []
      }
      kanban_resolution_details: {
        Row: {
          atualizado_em: string
          auvo_task_id: string
          motivo: string
          resolvido_em: string
          resolvido_por_id: string | null
          resolvido_por_nome: string | null
        }
        Insert: {
          atualizado_em?: string
          auvo_task_id: string
          motivo: string
          resolvido_em?: string
          resolvido_por_id?: string | null
          resolvido_por_nome?: string | null
        }
        Update: {
          atualizado_em?: string
          auvo_task_id?: string
          motivo?: string
          resolvido_em?: string
          resolvido_por_id?: string | null
          resolvido_por_nome?: string | null
        }
        Relationships: []
      }
      kanban_sync_meta: {
        Row: {
          id: string
          periodo_fim: string | null
          periodo_inicio: string | null
          ultimo_sync: string | null
        }
        Insert: {
          id?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          ultimo_sync?: string | null
        }
        Update: {
          id?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          ultimo_sync?: string | null
        }
        Relationships: []
      }
      metas_tecnicos: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          id: string
          meta_faturamento: number
          nome_tecnico: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          id?: string
          meta_faturamento?: number
          nome_tecnico: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          id?: string
          meta_faturamento?: number
          nome_tecnico?: string
        }
        Relationships: []
      }
      orcamento_aprovacao_log: {
        Row: {
          acao: string
          cliente: string | null
          criado_em: string
          detalhes: Json | null
          gc_orcamento_codigo: string | null
          gc_orcamento_id: string
          id: string
          ip: string | null
          observacao: string | null
          situacao_id_antes: string | null
          situacao_id_depois: string | null
          termo_aceito: boolean | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          user_nome: string | null
        }
        Insert: {
          acao: string
          cliente?: string | null
          criado_em?: string
          detalhes?: Json | null
          gc_orcamento_codigo?: string | null
          gc_orcamento_id: string
          id?: string
          ip?: string | null
          observacao?: string | null
          situacao_id_antes?: string | null
          situacao_id_depois?: string | null
          termo_aceito?: boolean | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_nome?: string | null
        }
        Update: {
          acao?: string
          cliente?: string | null
          criado_em?: string
          detalhes?: Json | null
          gc_orcamento_codigo?: string | null
          gc_orcamento_id?: string
          id?: string
          ip?: string | null
          observacao?: string | null
          situacao_id_antes?: string | null
          situacao_id_depois?: string | null
          termo_aceito?: boolean | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_nome?: string | null
        }
        Relationships: []
      }
      orcamento_detalhe_cache: {
        Row: {
          atualizado_em: string
          fingerprint: string | null
          gc_orcamento_id: string
          orcamento: Json
          tarefas: Json
        }
        Insert: {
          atualizado_em?: string
          fingerprint?: string | null
          gc_orcamento_id: string
          orcamento?: Json
          tarefas?: Json
        }
        Update: {
          atualizado_em?: string
          fingerprint?: string | null
          gc_orcamento_id?: string
          orcamento?: Json
          tarefas?: Json
        }
        Relationships: []
      }
      os_operation_locks: {
        Row: {
          gc_os_id: string
          locked_at: string
          locked_by: string
          operation: string
        }
        Insert: {
          gc_os_id: string
          locked_at?: string
          locked_by: string
          operation?: string
        }
        Update: {
          gc_os_id?: string
          locked_at?: string
          locked_by?: string
          operation?: string
        }
        Relationships: []
      }
      os_retornos: {
        Row: {
          cliente_original: string | null
          criado_em: string
          criado_por: string | null
          data_saida_original: string | null
          gc_os_codigo: string
          id: string
          mes_desconto: string | null
          observacao: string | null
          tecnico_original: string | null
          tecnico_retorno: string
          valor_desconto: number
        }
        Insert: {
          cliente_original?: string | null
          criado_em?: string
          criado_por?: string | null
          data_saida_original?: string | null
          gc_os_codigo: string
          id?: string
          mes_desconto?: string | null
          observacao?: string | null
          tecnico_original?: string | null
          tecnico_retorno: string
          valor_desconto?: number
        }
        Update: {
          cliente_original?: string | null
          criado_em?: string
          criado_por?: string | null
          data_saida_original?: string | null
          gc_os_codigo?: string
          id?: string
          mes_desconto?: string | null
          observacao?: string | null
          tecnico_original?: string | null
          tecnico_retorno?: string
          valor_desconto?: number
        }
        Relationships: []
      }
      os_revisao: {
        Row: {
          alertas_motivo: string
          atualizado_em: string
          auvo_task_id: string
          criado_em: string
          decidido_em: string | null
          decidido_por: string | null
          horas_ajustadas: number | null
          horas_originais: number
          justificativa: string | null
          status_revisao: string
        }
        Insert: {
          alertas_motivo: string
          atualizado_em?: string
          auvo_task_id: string
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          horas_ajustadas?: number | null
          horas_originais: number
          justificativa?: string | null
          status_revisao: string
        }
        Update: {
          alertas_motivo?: string
          atualizado_em?: string
          auvo_task_id?: string
          criado_em?: string
          decidido_em?: string | null
          decidido_por?: string | null
          horas_ajustadas?: number | null
          horas_originais?: number
          justificativa?: string | null
          status_revisao?: string
        }
        Relationships: []
      }
      plano_preventivo_execucao: {
        Row: {
          created_at: string
          data_planejada: string | null
          data_realizada: string
          horas_decimal: number | null
          id: string
          item_id: string
          mes_planejado: number | null
          origem: string
          task_id: string | null
          task_type_id: string | null
        }
        Insert: {
          created_at?: string
          data_planejada?: string | null
          data_realizada: string
          horas_decimal?: number | null
          id?: string
          item_id: string
          mes_planejado?: number | null
          origem?: string
          task_id?: string | null
          task_type_id?: string | null
        }
        Update: {
          created_at?: string
          data_planejada?: string | null
          data_realizada?: string
          horas_decimal?: number | null
          id?: string
          item_id?: string
          mes_planejado?: number | null
          origem?: string
          task_id?: string | null
          task_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plano_preventivo_execucao_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "plano_preventivo_item"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_preventivo_item: {
        Row: {
          ano_referencia: number
          ativo: boolean
          categoria: string | null
          created_at: string
          criticidade: string | null
          equipamento_auvo_id: string | null
          equipamento_nome: string
          grupo_id: string
          horas_total: number
          id: string
          match_confianca: string | null
          meses_planejados: number[]
          observacao: string | null
          periodicidade: string
          periodicidade_meses: number
          proxima_data: string | null
          ultima_execucao_data: string | null
          ultima_execucao_task_id: string | null
          updated_at: string
        }
        Insert: {
          ano_referencia?: number
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          criticidade?: string | null
          equipamento_auvo_id?: string | null
          equipamento_nome: string
          grupo_id: string
          horas_total?: number
          id?: string
          match_confianca?: string | null
          meses_planejados?: number[]
          observacao?: string | null
          periodicidade: string
          periodicidade_meses: number
          proxima_data?: string | null
          ultima_execucao_data?: string | null
          ultima_execucao_task_id?: string | null
          updated_at?: string
        }
        Update: {
          ano_referencia?: number
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          criticidade?: string | null
          equipamento_auvo_id?: string | null
          equipamento_nome?: string
          grupo_id?: string
          horas_total?: number
          id?: string
          match_confianca?: string | null
          meses_planejados?: number[]
          observacao?: string | null
          periodicidade?: string
          periodicidade_meses?: number
          proxima_data?: string | null
          ultima_execucao_data?: string | null
          ultima_execucao_task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_preventivo_item_equipamento_auvo_id_fkey"
            columns: ["equipamento_auvo_id"]
            isOneToOne: false
            referencedRelation: "equipamentos_auvo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_preventivo_item_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      premiacao_os_compartilhada: {
        Row: {
          atualizado_em: string
          criado_em: string
          gc_os_codigo: string
          id: string
          observacao: string | null
          tecnico_secundario: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          gc_os_codigo: string
          id?: string
          observacao?: string | null
          tecnico_secundario: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          gc_os_codigo?: string
          id?: string
          observacao?: string | null
          tecnico_secundario?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          atualizado_em: string
          auvo_user_id: string | null
          criado_em: string
          email: string
          gc_user_id: string | null
          grupo_id: string | null
          id: string
          nome: string
        }
        Insert: {
          atualizado_em?: string
          auvo_user_id?: string | null
          criado_em?: string
          email?: string
          gc_user_id?: string | null
          grupo_id?: string | null
          id: string
          nome?: string
        }
        Update: {
          atualizado_em?: string
          auvo_user_id?: string | null
          criado_em?: string
          email?: string
          gc_user_id?: string | null
          grupo_id?: string | null
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_client_requirements: {
        Row: {
          atualizado_em: string
          client_id: string
          criado_em: string
          document_type_id: string
          id: string
          is_required: boolean
          observacoes: string | null
          required_for: string
        }
        Insert: {
          atualizado_em?: string
          client_id: string
          criado_em?: string
          document_type_id: string
          id?: string
          is_required?: boolean
          observacoes?: string | null
          required_for: string
        }
        Update: {
          atualizado_em?: string
          client_id?: string
          criado_em?: string
          document_type_id?: string
          id?: string
          is_required?: boolean
          observacoes?: string | null
          required_for?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_client_requirements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "rh_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_client_requirements_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "rh_document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_clientes: {
        Row: {
          ativo: boolean
          atualizado_em: string
          cep: string | null
          cidade: string | null
          cpf_cnpj: string | null
          criado_em: string
          email: string | null
          endereco: string | null
          gc_cliente_id: string | null
          id: string
          integration_send_channel: string | null
          integration_validity_days: number | null
          nome: string
          nome_fantasia: string | null
          nome_normalizado: string
          observacoes: string | null
          origem: string
          sync_em: string | null
          telefone: string | null
          uf: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          cep?: string | null
          cidade?: string | null
          cpf_cnpj?: string | null
          criado_em?: string
          email?: string | null
          endereco?: string | null
          gc_cliente_id?: string | null
          id?: string
          integration_send_channel?: string | null
          integration_validity_days?: number | null
          nome: string
          nome_fantasia?: string | null
          nome_normalizado: string
          observacoes?: string | null
          origem?: string
          sync_em?: string | null
          telefone?: string | null
          uf?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          cep?: string | null
          cidade?: string | null
          cpf_cnpj?: string | null
          criado_em?: string
          email?: string | null
          endereco?: string | null
          gc_cliente_id?: string | null
          id?: string
          integration_send_channel?: string | null
          integration_validity_days?: number | null
          nome?: string
          nome_fantasia?: string | null
          nome_normalizado?: string
          observacoes?: string | null
          origem?: string
          sync_em?: string | null
          telefone?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      rh_colaborador_docs: {
        Row: {
          arquivo_nome: string | null
          arquivo_sha256: string | null
          arquivo_url: string | null
          atualizado_em: string
          colaborador_id: string
          criado_em: string
          data_emissao: string | null
          data_vencimento: string | null
          document_type_id: string
          id: string
          observacoes: string | null
          tipo_customizado: string | null
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_sha256?: string | null
          arquivo_url?: string | null
          atualizado_em?: string
          colaborador_id: string
          criado_em?: string
          data_emissao?: string | null
          data_vencimento?: string | null
          document_type_id: string
          id?: string
          observacoes?: string | null
          tipo_customizado?: string | null
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_sha256?: string | null
          arquivo_url?: string | null
          atualizado_em?: string
          colaborador_id?: string
          criado_em?: string
          data_emissao?: string | null
          data_vencimento?: string | null
          document_type_id?: string
          id?: string
          observacoes?: string | null
          tipo_customizado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_colaborador_docs_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "rh_colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_colaborador_docs_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "rh_document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_colaboradores: {
        Row: {
          ativo: boolean
          atualizado_em: string
          auvo_user_id: string | null
          cargo: string | null
          cpf_cnpj: string | null
          criado_em: string
          departamento: string | null
          email: string | null
          funcao: string | null
          id: string
          nome: string
          nome_fantasia: string | null
          observacoes: string | null
          telefone: string | null
          tipo_pessoa: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          auvo_user_id?: string | null
          cargo?: string | null
          cpf_cnpj?: string | null
          criado_em?: string
          departamento?: string | null
          email?: string | null
          funcao?: string | null
          id?: string
          nome: string
          nome_fantasia?: string | null
          observacoes?: string | null
          telefone?: string | null
          tipo_pessoa?: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          auvo_user_id?: string | null
          cargo?: string | null
          cpf_cnpj?: string | null
          criado_em?: string
          departamento?: string | null
          email?: string | null
          funcao?: string | null
          id?: string
          nome?: string
          nome_fantasia?: string | null
          observacoes?: string | null
          telefone?: string | null
          tipo_pessoa?: string
        }
        Relationships: []
      }
      rh_company_documents: {
        Row: {
          arquivo_nome: string | null
          arquivo_url: string | null
          atualizado_em: string
          criado_em: string
          data_emissao: string | null
          data_vencimento: string | null
          document_type_id: string
          id: string
          numero: string | null
          observacoes: string | null
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_url?: string | null
          atualizado_em?: string
          criado_em?: string
          data_emissao?: string | null
          data_vencimento?: string | null
          document_type_id: string
          id?: string
          numero?: string | null
          observacoes?: string | null
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_url?: string | null
          atualizado_em?: string
          criado_em?: string
          data_emissao?: string | null
          data_vencimento?: string | null
          document_type_id?: string
          id?: string
          numero?: string | null
          observacoes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_company_documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "rh_document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_document_types: {
        Row: {
          ativo: boolean
          atualizado_em: string
          code: string
          criado_em: string
          id: string
          name: string
          pacote_padrao: string[]
          requires_expiry: boolean
          scope: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          code: string
          criado_em?: string
          id?: string
          name: string
          pacote_padrao?: string[]
          requires_expiry?: boolean
          scope: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          code?: string
          criado_em?: string
          id?: string
          name?: string
          pacote_padrao?: string[]
          requires_expiry?: boolean
          scope?: string
        }
        Relationships: []
      }
      rh_integration_audit: {
        Row: {
          action: string
          criado_em: string
          detalhes: Json | null
          id: string
          integration_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          criado_em?: string
          detalhes?: Json | null
          id?: string
          integration_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          criado_em?: string
          detalhes?: Json | null
          id?: string
          integration_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_integration_audit_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "rh_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_integrations: {
        Row: {
          atualizado_em: string
          blocked_reasons: Json
          client_id: string
          completed_at: string | null
          completed_by_technician_id: string | null
          criado_em: string
          criado_por: string | null
          docs_accepted_at: string | null
          docs_sent_at: string | null
          earliest_expiry_date: string | null
          id: string
          integration_valid_until: string | null
          observacoes: string | null
          scheduled_at: string | null
          send_channel: string | null
          sent_at: string | null
          status: string
          technician_ids: string[]
          validated_at: string | null
          validity_days_snapshot: number | null
          zip_file_name: string | null
          zip_url: string | null
        }
        Insert: {
          atualizado_em?: string
          blocked_reasons?: Json
          client_id: string
          completed_at?: string | null
          completed_by_technician_id?: string | null
          criado_em?: string
          criado_por?: string | null
          docs_accepted_at?: string | null
          docs_sent_at?: string | null
          earliest_expiry_date?: string | null
          id?: string
          integration_valid_until?: string | null
          observacoes?: string | null
          scheduled_at?: string | null
          send_channel?: string | null
          sent_at?: string | null
          status?: string
          technician_ids?: string[]
          validated_at?: string | null
          validity_days_snapshot?: number | null
          zip_file_name?: string | null
          zip_url?: string | null
        }
        Update: {
          atualizado_em?: string
          blocked_reasons?: Json
          client_id?: string
          completed_at?: string | null
          completed_by_technician_id?: string | null
          criado_em?: string
          criado_por?: string | null
          docs_accepted_at?: string | null
          docs_sent_at?: string | null
          earliest_expiry_date?: string | null
          id?: string
          integration_valid_until?: string | null
          observacoes?: string | null
          scheduled_at?: string | null
          send_channel?: string | null
          sent_at?: string | null
          status?: string
          technician_ids?: string[]
          validated_at?: string | null
          validity_days_snapshot?: number | null
          zip_file_name?: string | null
          zip_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_integrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "rh_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_integrations_completed_by_technician_id_fkey"
            columns: ["completed_by_technician_id"]
            isOneToOne: false
            referencedRelation: "rh_colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas_central: {
        Row: {
          atualizado_em: string | null
          auvo_link: string | null
          auvo_survey_url: string | null
          auvo_task_id: string
          auvo_task_url: string | null
          check_in: boolean | null
          check_in_iso: string | null
          check_out: boolean | null
          check_out_iso: string | null
          cliente: string | null
          criado_em: string | null
          data_conclusao: string | null
          data_tarefa: string | null
          descricao: string | null
          deslocamento_inicio: string | null
          duracao_decimal: number | null
          duracao_deslocamento: number | null
          endereco: string | null
          equipamento_id_serie: string | null
          equipamento_nome: string | null
          gc_link_from_text: boolean | null
          gc_orc_cliente: string | null
          gc_orc_cor_situacao: string | null
          gc_orc_data: string | null
          gc_orc_link: string | null
          gc_orc_situacao: string | null
          gc_orc_situacao_id: string | null
          gc_orc_tipo: string | null
          gc_orc_valor_produtos: number | null
          gc_orc_valor_servicos: number | null
          gc_orc_valor_total: number | null
          gc_orc_vendedor: string | null
          gc_orcamento_codigo: string | null
          gc_orcamento_id: string | null
          gc_os_cliente: string | null
          gc_os_codigo: string | null
          gc_os_cor_situacao: string | null
          gc_os_data: string | null
          gc_os_data_saida: string | null
          gc_os_id: string | null
          gc_os_link: string | null
          gc_os_link_cobranca: string | null
          gc_os_situacao: string | null
          gc_os_situacao_id: string | null
          gc_os_tarefa_exec: string | null
          gc_os_tarefa_os: string | null
          gc_os_valor_total: number | null
          gc_os_vendedor: string | null
          hora_fim: string | null
          hora_inicio: string | null
          mirror_key: string
          orcamento_realizado: boolean | null
          orientacao: string | null
          os_realizada: boolean | null
          pendencia: string | null
          questionario_id: string | null
          questionario_preenchido: boolean | null
          questionario_respostas: Json | null
          status_auvo: string | null
          task_type_id: string | null
          tecnico: string | null
          tecnico_id: string | null
        }
        Insert: {
          atualizado_em?: string | null
          auvo_link?: string | null
          auvo_survey_url?: string | null
          auvo_task_id: string
          auvo_task_url?: string | null
          check_in?: boolean | null
          check_in_iso?: string | null
          check_out?: boolean | null
          check_out_iso?: string | null
          cliente?: string | null
          criado_em?: string | null
          data_conclusao?: string | null
          data_tarefa?: string | null
          descricao?: string | null
          deslocamento_inicio?: string | null
          duracao_decimal?: number | null
          duracao_deslocamento?: number | null
          endereco?: string | null
          equipamento_id_serie?: string | null
          equipamento_nome?: string | null
          gc_link_from_text?: boolean | null
          gc_orc_cliente?: string | null
          gc_orc_cor_situacao?: string | null
          gc_orc_data?: string | null
          gc_orc_link?: string | null
          gc_orc_situacao?: string | null
          gc_orc_situacao_id?: string | null
          gc_orc_tipo?: string | null
          gc_orc_valor_produtos?: number | null
          gc_orc_valor_servicos?: number | null
          gc_orc_valor_total?: number | null
          gc_orc_vendedor?: string | null
          gc_orcamento_codigo?: string | null
          gc_orcamento_id?: string | null
          gc_os_cliente?: string | null
          gc_os_codigo?: string | null
          gc_os_cor_situacao?: string | null
          gc_os_data?: string | null
          gc_os_data_saida?: string | null
          gc_os_id?: string | null
          gc_os_link?: string | null
          gc_os_link_cobranca?: string | null
          gc_os_situacao?: string | null
          gc_os_situacao_id?: string | null
          gc_os_tarefa_exec?: string | null
          gc_os_tarefa_os?: string | null
          gc_os_valor_total?: number | null
          gc_os_vendedor?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          mirror_key: string
          orcamento_realizado?: boolean | null
          orientacao?: string | null
          os_realizada?: boolean | null
          pendencia?: string | null
          questionario_id?: string | null
          questionario_preenchido?: boolean | null
          questionario_respostas?: Json | null
          status_auvo?: string | null
          task_type_id?: string | null
          tecnico?: string | null
          tecnico_id?: string | null
        }
        Update: {
          atualizado_em?: string | null
          auvo_link?: string | null
          auvo_survey_url?: string | null
          auvo_task_id?: string
          auvo_task_url?: string | null
          check_in?: boolean | null
          check_in_iso?: string | null
          check_out?: boolean | null
          check_out_iso?: string | null
          cliente?: string | null
          criado_em?: string | null
          data_conclusao?: string | null
          data_tarefa?: string | null
          descricao?: string | null
          deslocamento_inicio?: string | null
          duracao_decimal?: number | null
          duracao_deslocamento?: number | null
          endereco?: string | null
          equipamento_id_serie?: string | null
          equipamento_nome?: string | null
          gc_link_from_text?: boolean | null
          gc_orc_cliente?: string | null
          gc_orc_cor_situacao?: string | null
          gc_orc_data?: string | null
          gc_orc_link?: string | null
          gc_orc_situacao?: string | null
          gc_orc_situacao_id?: string | null
          gc_orc_tipo?: string | null
          gc_orc_valor_produtos?: number | null
          gc_orc_valor_servicos?: number | null
          gc_orc_valor_total?: number | null
          gc_orc_vendedor?: string | null
          gc_orcamento_codigo?: string | null
          gc_orcamento_id?: string | null
          gc_os_cliente?: string | null
          gc_os_codigo?: string | null
          gc_os_cor_situacao?: string | null
          gc_os_data?: string | null
          gc_os_data_saida?: string | null
          gc_os_id?: string | null
          gc_os_link?: string | null
          gc_os_link_cobranca?: string | null
          gc_os_situacao?: string | null
          gc_os_situacao_id?: string | null
          gc_os_tarefa_exec?: string | null
          gc_os_tarefa_os?: string | null
          gc_os_valor_total?: number | null
          gc_os_vendedor?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          mirror_key?: string
          orcamento_realizado?: boolean | null
          orientacao?: string | null
          os_realizada?: boolean | null
          pendencia?: string | null
          questionario_id?: string | null
          questionario_preenchido?: boolean | null
          questionario_respostas?: Json | null
          status_auvo?: string | null
          task_type_id?: string | null
          tecnico?: string | null
          tecnico_id?: string | null
        }
        Relationships: []
      }
      tipos_equipamento: {
        Row: {
          ativo: boolean
          categoria: string | null
          created_at: string
          criticidade: string
          horas_por_tecnico: number
          id: string
          nome: string
          observacoes: string | null
          palavras_chave: string[]
          periodicidade: string
          prioridade: number | null
          qtd_tecnicos: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          criticidade?: string
          horas_por_tecnico?: number
          id?: string
          nome: string
          observacoes?: string | null
          palavras_chave?: string[]
          periodicidade?: string
          prioridade?: number | null
          qtd_tecnicos?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          criticidade?: string
          horas_por_tecnico?: number
          id?: string
          nome?: string
          observacoes?: string | null
          palavras_chave?: string[]
          periodicidade?: string
          prioridade?: number | null
          qtd_tecnicos?: number
          updated_at?: string
        }
        Relationships: []
      }
      tipos_tarefa_preventiva: {
        Row: {
          aplica_a_categoria: string | null
          ativo: boolean
          atualizado_em: string
          auvo_task_type_id: string
          criado_em: string
          descricao: string
          id: string
        }
        Insert: {
          aplica_a_categoria?: string | null
          ativo?: boolean
          atualizado_em?: string
          auvo_task_type_id: string
          criado_em?: string
          descricao: string
          id?: string
        }
        Update: {
          aplica_a_categoria?: string | null
          ativo?: boolean
          atualizado_em?: string
          auvo_task_type_id?: string
          criado_em?: string
          descricao?: string
          id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      valor_hora_config: {
        Row: {
          aplica_taxa_emergencial: boolean | null
          atualizado_em: string
          criado_em: string
          grupo_id: string | null
          id: string
          referencia_nome: string
          task_types_emergenciais: string | null
          taxa_fixa_emergencial: number | null
          tecnico_nome: string
          tipo_referencia: string
          valor_hora: number
          valor_hora_fds: number | null
        }
        Insert: {
          aplica_taxa_emergencial?: boolean | null
          atualizado_em?: string
          criado_em?: string
          grupo_id?: string | null
          id?: string
          referencia_nome: string
          task_types_emergenciais?: string | null
          taxa_fixa_emergencial?: number | null
          tecnico_nome: string
          tipo_referencia?: string
          valor_hora?: number
          valor_hora_fds?: number | null
        }
        Update: {
          aplica_taxa_emergencial?: boolean | null
          atualizado_em?: string
          criado_em?: string
          grupo_id?: string | null
          id?: string
          referencia_nome?: string
          task_types_emergenciais?: string | null
          taxa_fixa_emergencial?: number | null
          tecnico_nome?: string
          tipo_referencia?: string
          valor_hora?: number
          valor_hora_fds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "valor_hora_config_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_job_events: {
        Row: {
          auvo_task_id: string
          criado_em: string
          event_type: string
          from_status: string | null
          id: string
          note: string | null
          to_status: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          auvo_task_id: string
          criado_em?: string
          event_type?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          auvo_task_id?: string
          criado_em?: string
          event_type?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      workshop_job_items: {
        Row: {
          atualizado_em: string
          auvo_task_id: string
          criado_em: string
          descricao: string
          id: string
          origem: string | null
          preco_unitario: number
          quantidade: number
          status_item: string | null
          tipo: string
        }
        Insert: {
          atualizado_em?: string
          auvo_task_id: string
          criado_em?: string
          descricao?: string
          id?: string
          origem?: string | null
          preco_unitario?: number
          quantidade?: number
          status_item?: string | null
          tipo?: string
        }
        Update: {
          atualizado_em?: string
          auvo_task_id?: string
          criado_em?: string
          descricao?: string
          id?: string
          origem?: string | null
          preco_unitario?: number
          quantidade?: number
          status_item?: string | null
          tipo?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "cliente"
      preventiva_criticidade: "CRITICA" | "ALTA" | "MEDIA" | "BAIXA"
      preventiva_periodicidade:
        | "MENSAL"
        | "BIMESTRAL"
        | "TRIMESTRAL"
        | "SEMESTRAL"
        | "ANUAL"
        | "QUADRIMESTRAL"
      preventiva_status: "RASCUNHO" | "VIGENTE"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "cliente"],
      preventiva_criticidade: ["CRITICA", "ALTA", "MEDIA", "BAIXA"],
      preventiva_periodicidade: [
        "MENSAL",
        "BIMESTRAL",
        "TRIMESTRAL",
        "SEMESTRAL",
        "ANUAL",
        "QUADRIMESTRAL",
      ],
      preventiva_status: ["RASCUNHO", "VIGENTE"],
    },
  },
} as const
