export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_interviews: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string | null
          created_bando_id: string | null
          created_contract_id: string | null
          created_counterpart_id: string | null
          created_employee_id: string | null
          created_record_type: string | null
          file_url: string | null
          final_classification: string | null
          id: string
          initial_classification: string | null
          initial_confidence: number | null
          original_filename: string | null
          parsed_text: string | null
          questions_answers: Json | null
          routing_was_automatic: boolean | null
          status: string | null
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          created_bando_id?: string | null
          created_contract_id?: string | null
          created_counterpart_id?: string | null
          created_employee_id?: string | null
          created_record_type?: string | null
          file_url?: string | null
          final_classification?: string | null
          id?: string
          initial_classification?: string | null
          initial_confidence?: number | null
          original_filename?: string | null
          parsed_text?: string | null
          questions_answers?: Json | null
          routing_was_automatic?: boolean | null
          status?: string | null
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_bando_id?: string | null
          created_contract_id?: string | null
          created_counterpart_id?: string | null
          created_employee_id?: string | null
          created_record_type?: string | null
          file_url?: string | null
          final_classification?: string | null
          id?: string
          initial_classification?: string | null
          initial_confidence?: number | null
          original_filename?: string | null
          parsed_text?: string | null
          questions_answers?: Json | null
          routing_was_automatic?: boolean | null
          status?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_interviews_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interviews_created_bando_id_fkey"
            columns: ["created_bando_id"]
            isOneToOne: false
            referencedRelation: "bandi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interviews_created_bando_id_fkey"
            columns: ["created_bando_id"]
            isOneToOne: false
            referencedRelation: "v_bandi_top_match"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interviews_created_contract_id_fkey"
            columns: ["created_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interviews_created_contract_id_fkey"
            columns: ["created_contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interviews_created_counterpart_id_fkey"
            columns: ["created_counterpart_id"]
            isOneToOne: false
            referencedRelation: "counterparts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interviews_created_employee_id_fkey"
            columns: ["created_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interviews_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_type: string
          bando_id: string | null
          company_id: string
          contract_id: string | null
          counterpart_id: string | null
          created_at: string | null
          description: string | null
          employee_id: string | null
          escalated_at: string | null
          escalated_to: string | null
          escalation_reason: string | null
          handle_note: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          invoice_id: string | null
          milestone_id: string | null
          notified_at: string | null
          notified_via: string[] | null
          priority: string
          snoozed_until: string | null
          status: string | null
          title: string
          trigger_date: string
          triggered_at: string | null
        }
        Insert: {
          alert_type: string
          bando_id?: string | null
          company_id: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          description?: string | null
          employee_id?: string | null
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_reason?: string | null
          handle_note?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          invoice_id?: string | null
          milestone_id?: string | null
          notified_at?: string | null
          notified_via?: string[] | null
          priority: string
          snoozed_until?: string | null
          status?: string | null
          title: string
          trigger_date: string
          triggered_at?: string | null
        }
        Update: {
          alert_type?: string
          bando_id?: string | null
          company_id?: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          description?: string | null
          employee_id?: string | null
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_reason?: string | null
          handle_note?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          invoice_id?: string | null
          milestone_id?: string | null
          notified_at?: string | null
          notified_via?: string[] | null
          priority?: string
          snoozed_until?: string | null
          status?: string | null
          title?: string
          trigger_date?: string
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_counterpart_id_fkey"
            columns: ["counterpart_id"]
            isOneToOne: false
            referencedRelation: "counterparts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_escalated_to_fkey"
            columns: ["escalated_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_alert_bando"
            columns: ["bando_id"]
            isOneToOne: false
            referencedRelation: "bandi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_alert_bando"
            columns: ["bando_id"]
            isOneToOne: false
            referencedRelation: "v_bandi_top_match"
            referencedColumns: ["id"]
          },
        ]
      }
      bandi: {
        Row: {
          alert_sent: boolean | null
          alert_sent_at: string | null
          authority_code: string | null
          authority_name: string
          authority_type: string | null
          award_criteria: string | null
          award_date: string | null
          awarded_value: number | null
          bando_embedding: string | null
          base_value: number | null
          checklist_json: Json | null
          cig: string | null
          clarifications_deadline: string | null
          company_id: string
          company_profile_snapshot: Json | null
          contract_category: string | null
          cpv_codes: string[] | null
          cup: string | null
          currency: string | null
          deadline: string
          description: string | null
          documents_required: string[] | null
          estimated_value: number | null
          external_id: string | null
          gap_analysis_json: Json | null
          id: string
          internal_notes: string | null
          is_active: boolean | null
          last_updated_at: string | null
          lot_count: number | null
          lots_json: Json | null
          match_breakdown: Json | null
          match_explanation: string | null
          match_score: number | null
          nuts_code: string | null
          object: string | null
          participation_status: string | null
          procedure_type: string | null
          publication_date: string | null
          requirements_json: Json | null
          resulting_contract_id: string | null
          rti_allowed: boolean | null
          rti_mandatory: boolean | null
          rti_partner_ids: string[] | null
          score_feasibility: number | null
          score_geo: number | null
          score_requirements: number | null
          score_sector: number | null
          score_size: number | null
          scraped_at: string | null
          site_visit_date: string | null
          source: string
          source_label: string | null
          source_url: string
          subappalto_allowed: boolean | null
          subappalto_max_pct: number | null
          technical_docs_url: string | null
          title: string
          winner_name: string | null
          winner_vat: string | null
        }
        Insert: {
          alert_sent?: boolean | null
          alert_sent_at?: string | null
          authority_code?: string | null
          authority_name: string
          authority_type?: string | null
          award_criteria?: string | null
          award_date?: string | null
          awarded_value?: number | null
          bando_embedding?: string | null
          base_value?: number | null
          checklist_json?: Json | null
          cig?: string | null
          clarifications_deadline?: string | null
          company_id: string
          company_profile_snapshot?: Json | null
          contract_category?: string | null
          cpv_codes?: string[] | null
          cup?: string | null
          currency?: string | null
          deadline: string
          description?: string | null
          documents_required?: string[] | null
          estimated_value?: number | null
          external_id?: string | null
          gap_analysis_json?: Json | null
          id?: string
          internal_notes?: string | null
          is_active?: boolean | null
          last_updated_at?: string | null
          lot_count?: number | null
          lots_json?: Json | null
          match_breakdown?: Json | null
          match_explanation?: string | null
          match_score?: number | null
          nuts_code?: string | null
          object?: string | null
          participation_status?: string | null
          procedure_type?: string | null
          publication_date?: string | null
          requirements_json?: Json | null
          resulting_contract_id?: string | null
          rti_allowed?: boolean | null
          rti_mandatory?: boolean | null
          rti_partner_ids?: string[] | null
          score_feasibility?: number | null
          score_geo?: number | null
          score_requirements?: number | null
          score_sector?: number | null
          score_size?: number | null
          scraped_at?: string | null
          site_visit_date?: string | null
          source: string
          source_label?: string | null
          source_url: string
          subappalto_allowed?: boolean | null
          subappalto_max_pct?: number | null
          technical_docs_url?: string | null
          title: string
          winner_name?: string | null
          winner_vat?: string | null
        }
        Update: {
          alert_sent?: boolean | null
          alert_sent_at?: string | null
          authority_code?: string | null
          authority_name?: string
          authority_type?: string | null
          award_criteria?: string | null
          award_date?: string | null
          awarded_value?: number | null
          bando_embedding?: string | null
          base_value?: number | null
          checklist_json?: Json | null
          cig?: string | null
          clarifications_deadline?: string | null
          company_id?: string
          company_profile_snapshot?: Json | null
          contract_category?: string | null
          cpv_codes?: string[] | null
          cup?: string | null
          currency?: string | null
          deadline?: string
          description?: string | null
          documents_required?: string[] | null
          estimated_value?: number | null
          external_id?: string | null
          gap_analysis_json?: Json | null
          id?: string
          internal_notes?: string | null
          is_active?: boolean | null
          last_updated_at?: string | null
          lot_count?: number | null
          lots_json?: Json | null
          match_breakdown?: Json | null
          match_explanation?: string | null
          match_score?: number | null
          nuts_code?: string | null
          object?: string | null
          participation_status?: string | null
          procedure_type?: string | null
          publication_date?: string | null
          requirements_json?: Json | null
          resulting_contract_id?: string | null
          rti_allowed?: boolean | null
          rti_mandatory?: boolean | null
          rti_partner_ids?: string[] | null
          score_feasibility?: number | null
          score_geo?: number | null
          score_requirements?: number | null
          score_sector?: number | null
          score_size?: number | null
          scraped_at?: string | null
          site_visit_date?: string | null
          source?: string
          source_label?: string | null
          source_url?: string
          subappalto_allowed?: boolean | null
          subappalto_max_pct?: number | null
          technical_docs_url?: string | null
          title?: string
          winner_name?: string | null
          winner_vat?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bandi_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bandi_resulting_contract_id_fkey"
            columns: ["resulting_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bandi_resulting_contract_id_fkey"
            columns: ["resulting_contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      bandi_competitor_awards: {
        Row: {
          authority_name: string | null
          awarded_value: number | null
          bando_id: string | null
          base_value: number | null
          cig: string | null
          company_id: string
          cpv_codes: string[] | null
          discount_pct: number | null
          id: string
          procedure_year: number | null
          scraped_at: string | null
          source_url: string | null
          winner_name: string
          winner_vat: string | null
        }
        Insert: {
          authority_name?: string | null
          awarded_value?: number | null
          bando_id?: string | null
          base_value?: number | null
          cig?: string | null
          company_id: string
          cpv_codes?: string[] | null
          discount_pct?: number | null
          id?: string
          procedure_year?: number | null
          scraped_at?: string | null
          source_url?: string | null
          winner_name: string
          winner_vat?: string | null
        }
        Update: {
          authority_name?: string | null
          awarded_value?: number | null
          bando_id?: string | null
          base_value?: number | null
          cig?: string | null
          company_id?: string
          cpv_codes?: string[] | null
          discount_pct?: number | null
          id?: string
          procedure_year?: number | null
          scraped_at?: string | null
          source_url?: string | null
          winner_name?: string
          winner_vat?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bandi_competitor_awards_bando_id_fkey"
            columns: ["bando_id"]
            isOneToOne: false
            referencedRelation: "bandi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bandi_competitor_awards_bando_id_fkey"
            columns: ["bando_id"]
            isOneToOne: false
            referencedRelation: "v_bandi_top_match"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bandi_competitor_awards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      change_requests: {
        Row: {
          additional_value: number | null
          approved_at: string | null
          contract_id: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          resulting_amendment_id: string | null
          scope_item_ids: string[] | null
          sent_at: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          additional_value?: number | null
          approved_at?: string | null
          contract_id: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          resulting_amendment_id?: string | null
          scope_item_ids?: string[] | null
          sent_at?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          additional_value?: number | null
          approved_at?: string | null
          contract_id?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          resulting_amendment_id?: string | null
          scope_item_ids?: string[] | null
          sent_at?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "change_requests_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_resulting_amendment_id_fkey"
            columns: ["resulting_amendment_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_resulting_amendment_id_fkey"
            columns: ["resulting_amendment_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      clauses: {
        Row: {
          ai_flag: string | null
          ai_suggestion: string | null
          benchmark_comparison: string | null
          clause_type: string | null
          contract_id: string
          created_at: string | null
          id: string
          original_text: string
          page_number: number | null
          risk_explanation: string | null
          risk_level: string | null
          simplified_text: string | null
        }
        Insert: {
          ai_flag?: string | null
          ai_suggestion?: string | null
          benchmark_comparison?: string | null
          clause_type?: string | null
          contract_id: string
          created_at?: string | null
          id?: string
          original_text: string
          page_number?: number | null
          risk_explanation?: string | null
          risk_level?: string | null
          simplified_text?: string | null
        }
        Update: {
          ai_flag?: string | null
          ai_suggestion?: string | null
          benchmark_comparison?: string | null
          clause_type?: string | null
          contract_id?: string
          created_at?: string | null
          id?: string
          original_text?: string
          page_number?: number | null
          risk_explanation?: string | null
          risk_level?: string | null
          simplified_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clauses_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clauses_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          annual_revenue: number | null
          ateco_code: string | null
          cap: string | null
          certifications: string[] | null
          city: string | null
          country: string | null
          created_at: string | null
          created_by_ai: boolean | null
          employee_count: number | null
          fiscal_code: string | null
          geographic_operations: string[] | null
          id: string
          name: string
          past_pa_contracts: boolean | null
          past_pa_contracts_value: number | null
          pec: string | null
          province: string | null
          sdi_code: string | null
          sector: string | null
          size: string | null
          updated_at: string | null
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          annual_revenue?: number | null
          ateco_code?: string | null
          cap?: string | null
          certifications?: string[] | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by_ai?: boolean | null
          employee_count?: number | null
          fiscal_code?: string | null
          geographic_operations?: string[] | null
          id?: string
          name: string
          past_pa_contracts?: boolean | null
          past_pa_contracts_value?: number | null
          pec?: string | null
          province?: string | null
          sdi_code?: string | null
          sector?: string | null
          size?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          annual_revenue?: number | null
          ateco_code?: string | null
          cap?: string | null
          certifications?: string[] | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by_ai?: boolean | null
          employee_count?: number | null
          fiscal_code?: string | null
          geographic_operations?: string[] | null
          id?: string
          name?: string
          past_pa_contracts?: boolean | null
          past_pa_contracts_value?: number | null
          pec?: string | null
          province?: string | null
          sdi_code?: string | null
          sector?: string | null
          size?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      contract_documents: {
        Row: {
          contract_id: string
          document_role: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          is_current: boolean | null
          signature_provider: string | null
          signature_status: string | null
          signed_at: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          version: number | null
        }
        Insert: {
          contract_id: string
          document_role?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          is_current?: boolean | null
          signature_provider?: string | null
          signature_status?: string | null
          signed_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          version?: number | null
        }
        Update: {
          contract_id?: string
          document_role?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          is_current?: boolean | null
          signature_provider?: string | null
          signature_status?: string | null
          signed_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          ai_confidence: number | null
          ai_extracted_at: string | null
          ai_summary: string | null
          auto_renewal: boolean | null
          company_id: string
          contract_relation: string | null
          contract_type: string
          counterpart_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          effective_date: string | null
          embedding: string | null
          employee_id: string | null
          end_date: string | null
          governing_law: string | null
          id: string
          is_current_version: boolean | null
          is_public_admin: boolean | null
          istat_indexation: boolean | null
          istat_indexation_month: number | null
          jurisdiction: string | null
          language: string | null
          notes: string | null
          parent_contract_id: string | null
          payment_frequency: string | null
          payment_terms: number | null
          raw_text: string | null
          reference_number: string | null
          renewal_duration_months: number | null
          renewal_notice_days: number | null
          risk_score: number | null
          signed_date: string | null
          start_date: string | null
          status: string | null
          surety_bond_amount: number | null
          surety_bond_expiry: string | null
          surety_bond_issuer: string | null
          surety_bond_required: boolean | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
          value: number | null
          value_type: string | null
          vat_rate: number | null
          vat_regime: string | null
          version: number | null
          withholding_rate: number | null
          withholding_tax: boolean | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_extracted_at?: string | null
          ai_summary?: string | null
          auto_renewal?: boolean | null
          company_id: string
          contract_relation?: string | null
          contract_type: string
          counterpart_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          effective_date?: string | null
          embedding?: string | null
          employee_id?: string | null
          end_date?: string | null
          governing_law?: string | null
          id?: string
          is_current_version?: boolean | null
          is_public_admin?: boolean | null
          istat_indexation?: boolean | null
          istat_indexation_month?: number | null
          jurisdiction?: string | null
          language?: string | null
          notes?: string | null
          parent_contract_id?: string | null
          payment_frequency?: string | null
          payment_terms?: number | null
          raw_text?: string | null
          reference_number?: string | null
          renewal_duration_months?: number | null
          renewal_notice_days?: number | null
          risk_score?: number | null
          signed_date?: string | null
          start_date?: string | null
          status?: string | null
          surety_bond_amount?: number | null
          surety_bond_expiry?: string | null
          surety_bond_issuer?: string | null
          surety_bond_required?: boolean | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
          value?: number | null
          value_type?: string | null
          vat_rate?: number | null
          vat_regime?: string | null
          version?: number | null
          withholding_rate?: number | null
          withholding_tax?: boolean | null
        }
        Update: {
          ai_confidence?: number | null
          ai_extracted_at?: string | null
          ai_summary?: string | null
          auto_renewal?: boolean | null
          company_id?: string
          contract_relation?: string | null
          contract_type?: string
          counterpart_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          effective_date?: string | null
          embedding?: string | null
          employee_id?: string | null
          end_date?: string | null
          governing_law?: string | null
          id?: string
          is_current_version?: boolean | null
          is_public_admin?: boolean | null
          istat_indexation?: boolean | null
          istat_indexation_month?: number | null
          jurisdiction?: string | null
          language?: string | null
          notes?: string | null
          parent_contract_id?: string | null
          payment_frequency?: string | null
          payment_terms?: number | null
          raw_text?: string | null
          reference_number?: string | null
          renewal_duration_months?: number | null
          renewal_notice_days?: number | null
          risk_score?: number | null
          signed_date?: string | null
          start_date?: string | null
          status?: string | null
          surety_bond_amount?: number | null
          surety_bond_expiry?: string | null
          surety_bond_issuer?: string | null
          surety_bond_required?: boolean | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
          value?: number | null
          value_type?: string | null
          vat_rate?: number | null
          vat_regime?: string | null
          version?: number | null
          withholding_rate?: number | null
          withholding_tax?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_counterpart_id_fkey"
            columns: ["counterpart_id"]
            isOneToOne: false
            referencedRelation: "counterparts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_parent_contract_id_fkey"
            columns: ["parent_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_parent_contract_id_fkey"
            columns: ["parent_contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparts: {
        Row: {
          address: string | null
          cap: string | null
          city: string | null
          company_id: string
          country: string | null
          created_at: string | null
          created_by_ai: boolean | null
          fiscal_code: string | null
          has_anac_annotations: boolean | null
          has_bankruptcy: boolean | null
          id: string
          name: string
          notes: string | null
          payment_avg_days: number | null
          payment_score: number | null
          pec: string | null
          province: string | null
          referent_email: string | null
          referent_name: string | null
          referent_phone: string | null
          reliability_label: string | null
          reliability_score: number | null
          reliability_updated_at: string | null
          score_consistency: number | null
          score_contributory: number | null
          score_legal: number | null
          score_reputation: number | null
          score_solidity: number | null
          sdi_code: string | null
          sector: string | null
          tags: string[] | null
          total_exposure: number | null
          total_revenue: number | null
          type: string
          updated_at: string | null
          vat_number: string | null
          vat_verified: boolean | null
          verification_json: Json | null
        }
        Insert: {
          address?: string | null
          cap?: string | null
          city?: string | null
          company_id: string
          country?: string | null
          created_at?: string | null
          created_by_ai?: boolean | null
          fiscal_code?: string | null
          has_anac_annotations?: boolean | null
          has_bankruptcy?: boolean | null
          id?: string
          name: string
          notes?: string | null
          payment_avg_days?: number | null
          payment_score?: number | null
          pec?: string | null
          province?: string | null
          referent_email?: string | null
          referent_name?: string | null
          referent_phone?: string | null
          reliability_label?: string | null
          reliability_score?: number | null
          reliability_updated_at?: string | null
          score_consistency?: number | null
          score_contributory?: number | null
          score_legal?: number | null
          score_reputation?: number | null
          score_solidity?: number | null
          sdi_code?: string | null
          sector?: string | null
          tags?: string[] | null
          total_exposure?: number | null
          total_revenue?: number | null
          type: string
          updated_at?: string | null
          vat_number?: string | null
          vat_verified?: boolean | null
          verification_json?: Json | null
        }
        Update: {
          address?: string | null
          cap?: string | null
          city?: string | null
          company_id?: string
          country?: string | null
          created_at?: string | null
          created_by_ai?: boolean | null
          fiscal_code?: string | null
          has_anac_annotations?: boolean | null
          has_bankruptcy?: boolean | null
          id?: string
          name?: string
          notes?: string | null
          payment_avg_days?: number | null
          payment_score?: number | null
          pec?: string | null
          province?: string | null
          referent_email?: string | null
          referent_name?: string | null
          referent_phone?: string | null
          reliability_label?: string | null
          reliability_score?: number | null
          reliability_updated_at?: string | null
          score_consistency?: number | null
          score_contributory?: number | null
          score_legal?: number | null
          score_reputation?: number | null
          score_solidity?: number | null
          sdi_code?: string | null
          sector?: string | null
          tags?: string[] | null
          total_exposure?: number | null
          total_revenue?: number | null
          type?: string
          updated_at?: string | null
          vat_number?: string | null
          vat_verified?: boolean | null
          verification_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "counterparts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          birth_date: string | null
          birth_place: string | null
          ccnl: string | null
          ccnl_level: string | null
          ccnl_version_date: string | null
          city: string | null
          company_car: boolean | null
          company_id: string
          company_phone: boolean | null
          created_at: string | null
          created_by_ai: boolean | null
          current_contract_id: string | null
          data_verified_at: string | null
          department: string | null
          email: string | null
          employee_type: string | null
          fiscal_code: string | null
          fiscal_code_match: boolean | null
          fiscal_code_valid: boolean | null
          fixed_term_count: number | null
          fixed_term_months: number | null
          full_name: string
          gross_cost: number | null
          hire_date: string | null
          iban: string | null
          iban_valid: boolean | null
          id: string
          meal_voucher_daily: number | null
          medical_exam_date: string | null
          notes: string | null
          notice_days: number | null
          osint_consent: boolean | null
          osint_consent_date: string | null
          other_benefits: Json | null
          phone: string | null
          probation_end_date: string | null
          province: string | null
          ral: number | null
          role: string | null
          safety_training_date: string | null
          termination_date: string | null
          updated_at: string | null
          welfare_budget: number | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          birth_place?: string | null
          ccnl?: string | null
          ccnl_level?: string | null
          ccnl_version_date?: string | null
          city?: string | null
          company_car?: boolean | null
          company_id: string
          company_phone?: boolean | null
          created_at?: string | null
          created_by_ai?: boolean | null
          current_contract_id?: string | null
          data_verified_at?: string | null
          department?: string | null
          email?: string | null
          employee_type?: string | null
          fiscal_code?: string | null
          fiscal_code_match?: boolean | null
          fiscal_code_valid?: boolean | null
          fixed_term_count?: number | null
          fixed_term_months?: number | null
          full_name: string
          gross_cost?: number | null
          hire_date?: string | null
          iban?: string | null
          iban_valid?: boolean | null
          id?: string
          meal_voucher_daily?: number | null
          medical_exam_date?: string | null
          notes?: string | null
          notice_days?: number | null
          osint_consent?: boolean | null
          osint_consent_date?: string | null
          other_benefits?: Json | null
          phone?: string | null
          probation_end_date?: string | null
          province?: string | null
          ral?: number | null
          role?: string | null
          safety_training_date?: string | null
          termination_date?: string | null
          updated_at?: string | null
          welfare_budget?: number | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          birth_place?: string | null
          ccnl?: string | null
          ccnl_level?: string | null
          ccnl_version_date?: string | null
          city?: string | null
          company_car?: boolean | null
          company_id?: string
          company_phone?: boolean | null
          created_at?: string | null
          created_by_ai?: boolean | null
          current_contract_id?: string | null
          data_verified_at?: string | null
          department?: string | null
          email?: string | null
          employee_type?: string | null
          fiscal_code?: string | null
          fiscal_code_match?: boolean | null
          fiscal_code_valid?: boolean | null
          fixed_term_count?: number | null
          fixed_term_months?: number | null
          full_name?: string
          gross_cost?: number | null
          hire_date?: string | null
          iban?: string | null
          iban_valid?: boolean | null
          id?: string
          meal_voucher_daily?: number | null
          medical_exam_date?: string | null
          notes?: string | null
          notice_days?: number | null
          osint_consent?: boolean | null
          osint_consent_date?: string | null
          other_benefits?: Json | null
          phone?: string | null
          probation_end_date?: string | null
          province?: string | null
          ral?: number | null
          role?: string | null
          safety_training_date?: string | null
          termination_date?: string | null
          updated_at?: string | null
          welfare_budget?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_current_contract"
            columns: ["current_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_current_contract"
            columns: ["current_contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      gdpr_records: {
        Row: {
          company_id: string
          contract_id: string | null
          counterpart_id: string | null
          created_at: string | null
          data_categories: string[] | null
          dpa_date: string | null
          dpa_document_id: string | null
          dpa_signed: boolean | null
          id: string
          is_data_controller: boolean | null
          is_data_processor: boolean | null
          last_review_date: string | null
          processing_purposes: string | null
          retention_period_months: number | null
          sub_processors: string[] | null
        }
        Insert: {
          company_id: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          data_categories?: string[] | null
          dpa_date?: string | null
          dpa_document_id?: string | null
          dpa_signed?: boolean | null
          id?: string
          is_data_controller?: boolean | null
          is_data_processor?: boolean | null
          last_review_date?: string | null
          processing_purposes?: string | null
          retention_period_months?: number | null
          sub_processors?: string[] | null
        }
        Update: {
          company_id?: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          data_categories?: string[] | null
          dpa_date?: string | null
          dpa_document_id?: string | null
          dpa_signed?: boolean | null
          id?: string
          is_data_controller?: boolean | null
          is_data_processor?: boolean | null
          last_review_date?: string | null
          processing_purposes?: string | null
          retention_period_months?: number | null
          sub_processors?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "gdpr_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gdpr_records_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gdpr_records_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gdpr_records_counterpart_id_fkey"
            columns: ["counterpart_id"]
            isOneToOne: false
            referencedRelation: "counterparts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gdpr_records_dpa_document_id_fkey"
            columns: ["dpa_document_id"]
            isOneToOne: false
            referencedRelation: "contract_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          company_id: string
          content_json: Json | null
          contract_id: string | null
          counterpart_id: string | null
          created_at: string | null
          document_type: string
          employee_id: string | null
          file_url: string | null
          generated_by: string | null
          generated_text: string | null
          id: string
          sent_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          content_json?: Json | null
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          document_type: string
          employee_id?: string | null
          file_url?: string | null
          generated_by?: string | null
          generated_text?: string | null
          id?: string
          sent_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          content_json?: Json | null
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          document_type?: string
          employee_id?: string | null
          file_url?: string | null
          generated_by?: string | null
          generated_text?: string | null
          id?: string
          sent_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_counterpart_id_fkey"
            columns: ["counterpart_id"]
            isOneToOne: false
            referencedRelation: "counterparts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_gross: number | null
          amount_net: number
          amount_payable: number | null
          company_id: string
          contract_id: string | null
          counterpart_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          due_date: string | null
          file_url: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string
          milestone_id: string | null
          notes: string | null
          pa_protocol: string | null
          payment_date: string | null
          payment_status: string | null
          sdi_error_code: string | null
          sdi_error_description: string | null
          sdi_identifier: string | null
          sdi_status: string | null
          updated_at: string | null
          vat_amount: number | null
          vat_rate: number | null
          withholding_amount: number | null
        }
        Insert: {
          amount_gross?: number | null
          amount_net: number
          amount_payable?: number | null
          company_id: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          due_date?: string | null
          file_url?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type: string
          milestone_id?: string | null
          notes?: string | null
          pa_protocol?: string | null
          payment_date?: string | null
          payment_status?: string | null
          sdi_error_code?: string | null
          sdi_error_description?: string | null
          sdi_identifier?: string | null
          sdi_status?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          withholding_amount?: number | null
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number
          amount_payable?: number | null
          company_id?: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          due_date?: string | null
          file_url?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string
          milestone_id?: string | null
          notes?: string | null
          pa_protocol?: string | null
          payment_date?: string | null
          payment_status?: string | null
          sdi_error_code?: string | null
          sdi_error_description?: string | null
          sdi_identifier?: string | null
          sdi_status?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          withholding_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_counterpart_id_fkey"
            columns: ["counterpart_id"]
            isOneToOne: false
            referencedRelation: "counterparts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          amount: number | null
          approval_contact: string | null
          approval_date: string | null
          contract_id: string
          created_at: string | null
          delivery_date: string | null
          description: string | null
          due_date: string | null
          id: string
          invoice_id: string | null
          requires_approval: boolean | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          approval_contact?: string | null
          approval_date?: string | null
          contract_id: string
          created_at?: string | null
          delivery_date?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          requires_approval?: boolean | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          approval_contact?: string | null
          approval_date?: string | null
          contract_id?: string
          created_at?: string | null
          delivery_date?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          requires_approval?: boolean | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_milestone_invoice"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiation_events: {
        Row: {
          clauses_affected: string[] | null
          contract_id: string
          description: string | null
          document_version: number | null
          event_date: string | null
          event_type: string | null
          id: string
          initiated_by: string | null
        }
        Insert: {
          clauses_affected?: string[] | null
          contract_id: string
          description?: string | null
          document_version?: number | null
          event_date?: string | null
          event_type?: string | null
          id?: string
          initiated_by?: string | null
        }
        Update: {
          clauses_affected?: string[] | null
          contract_id?: string
          description?: string | null
          document_version?: number | null
          event_date?: string | null
          event_type?: string | null
          id?: string
          initiated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      obligations: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          completion_note: string | null
          contract_id: string
          created_at: string | null
          description: string
          due_date: string | null
          id: string
          obligation_type: string | null
          party: string
          recurrence: string | null
          recurrence_end_date: string | null
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          contract_id: string
          created_at?: string | null
          description: string
          due_date?: string | null
          id?: string
          obligation_type?: string | null
          party: string
          recurrence?: string | null
          recurrence_end_date?: string | null
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          contract_id?: string
          created_at?: string | null
          description?: string
          due_date?: string | null
          id?: string
          obligation_type?: string | null
          party?: string
          recurrence?: string | null
          recurrence_end_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obligations_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          actual_date: string | null
          amount: number
          company_id: string
          contract_id: string | null
          counterpart_id: string | null
          created_at: string | null
          currency: string | null
          days_delta: number | null
          direction: string
          expected_date: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          status: string | null
        }
        Insert: {
          actual_date?: string | null
          amount: number
          company_id: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          currency?: string | null
          days_delta?: number | null
          direction: string
          expected_date?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          status?: string | null
        }
        Update: {
          actual_date?: string | null
          amount?: number
          company_id?: string
          contract_id?: string | null
          counterpart_id?: string | null
          created_at?: string | null
          currency?: string | null
          days_delta?: number | null
          direction?: string
          expected_date?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_counterpart_id_fkey"
            columns: ["counterpart_id"]
            isOneToOne: false
            referencedRelation: "counterparts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_items: {
        Row: {
          contract_id: string
          created_at: string | null
          description: string
          detected_by_ai: boolean | null
          id: string
          item_type: string | null
          quantity: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          contract_id: string
          created_at?: string | null
          description: string
          detected_by_ai?: boolean | null
          id?: string
          item_type?: string | null
          quantity?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          contract_id?: string
          created_at?: string | null
          description?: string
          detected_by_ai?: boolean | null
          id?: string
          item_type?: string | null
          quantity?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scope_items_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_items_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring_soon"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          last_login_at: string | null
          role: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          last_login_at?: string | null
          role?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_bandi_top_match: {
        Row: {
          authority_name: string | null
          base_value: number | null
          company_id: string | null
          days_until_deadline: number | null
          deadline: string | null
          gap_analysis_json: Json | null
          id: string | null
          match_score: number | null
          participation_status: string | null
          source: string | null
          source_label: string | null
          title: string | null
        }
        Insert: {
          authority_name?: string | null
          base_value?: number | null
          company_id?: string | null
          days_until_deadline?: never
          deadline?: string | null
          gap_analysis_json?: Json | null
          id?: string | null
          match_score?: number | null
          participation_status?: string | null
          source?: string | null
          source_label?: string | null
          title?: string | null
        }
        Update: {
          authority_name?: string | null
          base_value?: number | null
          company_id?: string | null
          days_until_deadline?: never
          deadline?: string | null
          gap_analysis_json?: Json | null
          id?: string | null
          match_score?: number | null
          participation_status?: string | null
          source?: string | null
          source_label?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bandi_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_contracts_expiring_soon: {
        Row: {
          auto_renewal: boolean | null
          company_id: string | null
          contract_type: string | null
          counterpart_name: string | null
          counterpart_type: string | null
          days_until_expiry: number | null
          disdetta_deadline: string | null
          employee_name: string | null
          end_date: string | null
          id: string | null
          renewal_notice_days: number | null
          status: string | null
          title: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_dashboard_kpi: {
        Row: {
          active_contracts: number | null
          commercial_contracts: number | null
          company_id: string | null
          expiring_30d: number | null
          hr_contracts: number | null
          portfolio_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auth_company_id: { Args: never; Returns: string }
      get_dashboard_kpi: {
        Args: { p_company_id: string }
        Returns: {
          active_contracts: number
          expiring_30d: number
          pending_alerts: number
          portfolio_value: number
          top_bandi_count: number
          unpaid_invoices_value: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


