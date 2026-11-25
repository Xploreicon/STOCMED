export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          user_id: string
          email: string
          full_name: string
          phone: string
          role: 'patient' | 'pharmacy'
          location: string | null
          created_at: string
          updated_at: string
          is_admin: boolean
          is_licensed_pharmacist: boolean
          is_stocmed_sp: boolean
          admin_authorized_at: string | null
          admin_authorization_basis: string | null
          pharmacist_license_number: string | null
          pharmacist_license_verified_at: string | null
          pharmacist_license_verification_basis: string | null
          stocmed_sp_authorized_at: string | null
          stocmed_sp_authorization_basis: string | null
        }
        Insert: {
          id?: string
          user_id?: string
          email: string
          full_name: string
          phone: string
          role: 'patient' | 'pharmacy'
          location?: string | null
          created_at?: string
          updated_at?: string
          is_admin?: boolean
          is_licensed_pharmacist?: boolean
          is_stocmed_sp?: boolean
          admin_authorized_at?: string | null
          admin_authorization_basis?: string | null
          pharmacist_license_number?: string | null
          pharmacist_license_verified_at?: string | null
          pharmacist_license_verification_basis?: string | null
          stocmed_sp_authorized_at?: string | null
          stocmed_sp_authorization_basis?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          email?: string
          full_name?: string
          phone?: string
          role?: 'patient' | 'pharmacy'
          location?: string | null
          created_at?: string
          updated_at?: string
          is_admin?: boolean
          is_licensed_pharmacist?: boolean
          is_stocmed_sp?: boolean
          admin_authorized_at?: string | null
          admin_authorization_basis?: string | null
          pharmacist_license_number?: string | null
          pharmacist_license_verified_at?: string | null
          pharmacist_license_verification_basis?: string | null
          stocmed_sp_authorized_at?: string | null
          stocmed_sp_authorization_basis?: string | null
        }
      }
      notifications: {
        Row: {
          id: string
          recipient_type: 'patient' | 'pharmacist'
          recipient_id: string
          pharmacy_id: string | null
          type: 'low_stock' | 'expiry' | 'daily_summary' | `reservation_${string}` | 'broadcast' | 'order'
          title: string
          body: string
          data: Json
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          recipient_type: 'patient' | 'pharmacist'
          recipient_id: string
          pharmacy_id?: string | null
          type: 'low_stock' | 'expiry' | 'daily_summary' | `reservation_${string}` | 'broadcast' | 'order'
          title: string
          body: string
          data?: Json
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          recipient_type?: 'patient' | 'pharmacist'
          recipient_id?: string
          pharmacy_id?: string | null
          type?: 'low_stock' | 'expiry' | 'daily_summary' | `reservation_${string}` | 'broadcast' | 'order'
          title?: string
          body?: string
          data?: Json
          read_at?: string | null
          created_at?: string
        }
      }
      notification_deliveries: {
        Row: {
          id: string
          notification_id: string | null
          channel: 'email' | 'sms' | 'push'
          notification_type: string
          provider: 'resend' | 'termii' | 'web_push'
          pharmacy_id: string | null
          user_id: string | null
          recipient: string | null
          recipient_hash: string
          idempotency_key: string
          status: 'pending' | 'queued' | 'sending' | 'sent' | 'delivered' | 'retry' | 'failed' | 'skipped'
          provider_message_id: string | null
          provider_status: string | null
          cost: number | null
          attempts: number
          payload: Json
          last_error: string | null
          send_after: string
          sent_at: string | null
          delivered_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          notification_id?: string | null
          channel: 'email' | 'sms' | 'push'
          notification_type: string
          provider: 'resend' | 'termii' | 'web_push'
          pharmacy_id?: string | null
          user_id?: string | null
          recipient?: string | null
          recipient_hash: string
          idempotency_key: string
          status?: 'pending' | 'queued' | 'sending' | 'sent' | 'delivered' | 'retry' | 'failed' | 'skipped'
          provider_message_id?: string | null
          provider_status?: string | null
          cost?: number | null
          attempts?: number
          payload?: Json
          last_error?: string | null
          send_after?: string
          sent_at?: string | null
          delivered_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['notification_deliveries']['Insert']>
      }
      notification_preferences: {
        Row: {
          user_id: string
          pharmacy_id: string | null
          product_email_opt_in: boolean
          refill_email_opt_in: boolean
          reminder_sms_opt_in: boolean
          type_channels: Json
          patient_email_consent: boolean
          patient_sms_consent: boolean
          patient_push_consent: boolean
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          pharmacy_id?: string | null
          product_email_opt_in?: boolean
          refill_email_opt_in?: boolean
          reminder_sms_opt_in?: boolean
          type_channels?: Json
          patient_email_consent?: boolean
          patient_sms_consent?: boolean
          patient_push_consent?: boolean
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['notification_preferences']['Insert']>
      }
      pharmacies: {
        Row: {
          id: string
          user_id: string
          pharmacy_name: string
          license_number: string
          address: string
          city: string
          state: string
          latitude: number | null
          longitude: number | null
          phone: string
          is_verified: boolean
          is_active: boolean
          reservations_enabled: boolean
          is_test_account: boolean
          test_account_label: string | null
          reservation_hold_minutes: number
          verification_status: 'provisional' | 'full' | 'revoked'
          pcn_confirmation_status: 'confirmed' | 'to_be_confirmed'
          provisional_started_at: string | null
          provisional_expires_at: string | null
          verification_submitted_at: string | null
          pcn_standards_accepted_at: string | null
          verification_authorized_at: string | null
          verification_authorization_basis: string | null
          verification_documents_evidence_basis: string | null
          verification_standards_evidence_basis: string | null
          legacy_verification_bootstrap_eligible: boolean
          created_at: string
          updated_at: string
          logo_url: string | null
          opening_time: string | null
          closing_time: string | null
        }
        Insert: {
          id?: string
          user_id: string
          pharmacy_name: string
          license_number: string
          address: string
          city: string
          state: string
          latitude?: number | null
          longitude?: number | null
          phone: string
          is_verified?: boolean
          is_active?: boolean
          reservations_enabled?: boolean
          is_test_account?: boolean
          test_account_label?: string | null
          reservation_hold_minutes?: number
          verification_status?: 'provisional' | 'full' | 'revoked'
          pcn_confirmation_status?: 'confirmed' | 'to_be_confirmed'
          provisional_started_at?: string | null
          provisional_expires_at?: string | null
          verification_submitted_at?: string | null
          pcn_standards_accepted_at?: string | null
          verification_authorized_at?: string | null
          verification_authorization_basis?: string | null
          verification_documents_evidence_basis?: string | null
          verification_standards_evidence_basis?: string | null
          legacy_verification_bootstrap_eligible?: boolean
          created_at?: string
          updated_at?: string
          logo_url?: string | null
          opening_time?: string | null
          closing_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'pharmacies_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
        Update: {
          id?: string
          user_id?: string
          pharmacy_name?: string
          license_number?: string
          address?: string
          city?: string
          state?: string
          latitude?: number | null
          longitude?: number | null
          phone?: string
          is_verified?: boolean
          is_active?: boolean
          reservations_enabled?: boolean
          is_test_account?: boolean
          test_account_label?: string | null
          reservation_hold_minutes?: number
          verification_status?: 'provisional' | 'full' | 'revoked'
          pcn_confirmation_status?: 'confirmed' | 'to_be_confirmed'
          provisional_started_at?: string | null
          provisional_expires_at?: string | null
          verification_submitted_at?: string | null
          pcn_standards_accepted_at?: string | null
          verification_authorized_at?: string | null
          verification_authorization_basis?: string | null
          verification_documents_evidence_basis?: string | null
          verification_standards_evidence_basis?: string | null
          legacy_verification_bootstrap_eligible?: boolean
          created_at?: string
          updated_at?: string
          logo_url?: string | null
          opening_time?: string | null
          closing_time?: string | null
        }
      }
      drugs: {
        Row: {
          id: string
          pharmacy_id: string
          name: string
          generic_name: string | null
          brand_name: string | null
          category: string
          dosage_form: string
          strength: string | null
          description: string | null
          price: number
          quantity_in_stock: number
          low_stock_threshold: number
          requires_prescription: boolean
          manufacturer: string | null
          expiry_date: string | null
          created_at: string
          updated_at: string
          image_url: string | null
        }
        Insert: {
          id?: string
          pharmacy_id: string
          name: string
          generic_name?: string | null
          brand_name?: string | null
          category: string
          dosage_form: string
          strength?: string | null
          description?: string | null
          price: number
          quantity_in_stock: number
          low_stock_threshold?: number
          requires_prescription?: boolean
          manufacturer?: string | null
          expiry_date?: string | null
          created_at?: string
          updated_at?: string
          image_url?: string | null
        }
        Update: {
          id?: string
          pharmacy_id?: string
          name?: string
          generic_name?: string | null
          brand_name?: string | null
          category?: string
          dosage_form?: string
          strength?: string | null
          description?: string | null
          price?: number
          quantity_in_stock?: number
          low_stock_threshold?: number
          requires_prescription?: boolean
          manufacturer?: string | null
          expiry_date?: string | null
          created_at?: string
          updated_at?: string
          image_url?: string | null
        }
      }
      searches: {
        Row: {
          id: string
          user_id: string | null
          session_id: string | null
          query_text: string
          interpreted_query: Json | null
          results_count: number | null
          clicked_result: string | null
          timestamp: string
          location: string | null
          metadata: Json | null
          product_id: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          query_text: string
          interpreted_query?: Json | null
          results_count?: number | null
          clicked_result?: string | null
          timestamp?: string
          location?: string | null
          metadata?: Json | null
          product_id?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          query_text?: string
          interpreted_query?: Json | null
          results_count?: number | null
          clicked_result?: string | null
          timestamp?: string
          location?: string | null
          metadata?: Json | null
          product_id?: string | null
        }
      }
      user_search_history: {
        Row: {
          id: string
          user_id: string
          query_text: string
          product_id: string | null
          results_count: number | null
          location: string | null
          searched_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          user_id: string
          query_text: string
          product_id?: string | null
          results_count?: number | null
          location?: string | null
          searched_at?: string
          expires_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          query_text?: string
          product_id?: string | null
          results_count?: number | null
          location?: string | null
          searched_at?: string
          expires_at?: string
        }
      }
      chat_messages: {
        Row: {
          id: string
          user_id: string | null
          session_id: string | null
          role: string
          content: string
          timestamp: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          role: string
          content: string
          timestamp?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          role?: string
          content?: string
          timestamp?: string
        }
      }
      products: {
        Row: {
          id: string
          generic_name: string
          brand_name: string | null
          manufacturer: string | null
          strength: string
          dosage_form: string | null
          category: string | null
          pack_size: string | null
          nafdac_number: string | null
          barcode: string | null
          atc_code: string | null
          requires_prescription: boolean
          description: string | null
          image_url: string | null
          is_verified: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          generic_name: string
          brand_name?: string | null
          manufacturer?: string | null
          strength: string
          dosage_form?: string | null
          category?: string | null
          pack_size?: string | null
          nafdac_number?: string | null
          barcode?: string | null
          atc_code?: string | null
          requires_prescription?: boolean
          description?: string | null
          image_url?: string | null
          is_verified?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          generic_name?: string
          brand_name?: string | null
          manufacturer?: string | null
          strength?: string
          dosage_form?: string | null
          category?: string | null
          pack_size?: string | null
          nafdac_number?: string | null
          barcode?: string | null
          atc_code?: string | null
          requires_prescription?: boolean
          description?: string | null
          image_url?: string | null
          is_verified?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      pharmacy_inventory: {
        Row: {
          id: string
          pharmacy_id: string
          product_id: string | null
          item_type: 'medicine' | 'store'
          tracks_expiry: boolean
          item_name: string | null
          brand: string | null
          barcode: string | null
          unit_description: string | null
          store_category: string | null
          unit_cost: number | null
          price: number
          quantity_in_stock: number
          low_stock_threshold: number
          is_listed: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          pharmacy_id: string
          product_id?: string | null
          item_type?: 'medicine' | 'store'
          tracks_expiry?: boolean
          item_name?: string | null
          brand?: string | null
          barcode?: string | null
          unit_description?: string | null
          store_category?: string | null
          unit_cost?: number | null
          price: number
          quantity_in_stock?: number
          low_stock_threshold?: number
          is_listed?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          pharmacy_id?: string
          product_id?: string | null
          item_type?: 'medicine' | 'store'
          tracks_expiry?: boolean
          item_name?: string | null
          brand?: string | null
          barcode?: string | null
          unit_description?: string | null
          store_category?: string | null
          unit_cost?: number | null
          price?: number
          quantity_in_stock?: number
          low_stock_threshold?: number
          is_listed?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pharmacy_inventory_pharmacy_id_fkey'
            columns: ['pharmacy_id']
            isOneToOne: false
            referencedRelation: 'pharmacies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pharmacy_inventory_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      batches: {
        Row: {
          id: string
          inventory_id: string
          batch_number: string
          expiry_date: string
          quantity_received: number
          cost_price: number | null
          created_at: string
        }
        Insert: {
          id?: string
          inventory_id: string
          batch_number: string
          expiry_date: string
          quantity_received: number
          cost_price?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          inventory_id?: string
          batch_number?: string
          expiry_date?: string
          quantity_received?: number
          cost_price?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'batches_inventory_id_fkey'
            columns: ['inventory_id']
            isOneToOne: false
            referencedRelation: 'pharmacy_inventory'
            referencedColumns: ['id']
          },
        ]
      }
      stock_movements: {
        Row: {
          id: string
          inventory_id: string
          batch_id: string | null
          type:
            | 'opening'
            | 'sale'
            | 'restock'
            | 'adjustment'
            | 'return'
            | 'expiry_writeoff'
            | 'transfer'
            | 'write_off'
          quantity: number
          reason: string | null
          reference: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          inventory_id: string
          batch_id?: string | null
          type:
            | 'opening'
            | 'sale'
            | 'restock'
            | 'adjustment'
            | 'return'
            | 'expiry_writeoff'
            | 'transfer'
            | 'write_off'
          quantity: number
          reason?: string | null
          reference?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          inventory_id?: string
          batch_id?: string | null
          type?:
            | 'opening'
            | 'sale'
            | 'restock'
            | 'adjustment'
            | 'return'
            | 'expiry_writeoff'
            | 'transfer'
            | 'write_off'
          quantity?: number
          reason?: string | null
          reference?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      product_categories: {
        Row: { name: string }
        Insert: { name: string }
        Update: { name?: string }
      }
      dosage_forms: {
        Row: { name: string }
        Insert: { name: string }
        Update: { name?: string }
      }
      triage_logs: {
        Row: {
          id: string
          query_hash: string
          intent: string
          risk_tier: string
          confidence: number
          layers_triggered: string[]
          matched_product_id: string | null
          thread_id: string | null
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          query_hash: string
          intent: string
          risk_tier: string
          confidence: number
          layers_triggered: string[]
          matched_product_id?: string | null
          thread_id?: string | null
          user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          query_hash?: string
          intent?: string
          risk_tier?: string
          confidence?: number
          layers_triggered?: string[]
          matched_product_id?: string | null
          thread_id?: string | null
          user_id?: string | null
          created_at?: string
        }
      }
      thread_locks: {
        Row: {
          thread_id: string
          locked_at: string
          lock_reason: string
          user_id: string | null
        }
        Insert: {
          thread_id: string
          locked_at?: string
          lock_reason: string
          user_id?: string | null
        }
        Update: {
          thread_id?: string
          locked_at?: string
          lock_reason?: string
          user_id?: string | null
        }
      }
      triage_config: {
        Row: {
          id: string
          config_key: string
          config_value: Json
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          config_key: string
          config_value: Json
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          config_key?: string
          config_value?: Json
          updated_by?: string | null
          updated_at?: string
        }
      }
      rx_submissions: {
        Row: {
          id: string
          user_id: string | null
          thread_id: string | null
          product_name: string
          file_url: string
          status: string
          reviewed_by: string | null
          review_notes: string | null
          created_at: string
          updated_at: string
          flow_model: 'central_legacy' | 'destination_model_a'
          destination_pharmacy_id: string | null
          inventory_id: string | null
          requested_quantity: number | null
          reservation_id: string | null
          destination_seen_at: string | null
          reviewed_at: string | null
          purge_after: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          thread_id?: string | null
          product_name: string
          file_url: string
          status?: string
          reviewed_by?: string | null
          review_notes?: string | null
          created_at?: string
          updated_at?: string
          flow_model?: 'central_legacy' | 'destination_model_a'
          destination_pharmacy_id?: string | null
          inventory_id?: string | null
          requested_quantity?: number | null
          reservation_id?: string | null
          destination_seen_at?: string | null
          reviewed_at?: string | null
          purge_after?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          thread_id?: string | null
          product_name?: string
          file_url?: string
          status?: string
          reviewed_by?: string | null
          review_notes?: string | null
          created_at?: string
          updated_at?: string
          flow_model?: 'central_legacy' | 'destination_model_a'
          destination_pharmacy_id?: string | null
          inventory_id?: string | null
          requested_quantity?: number | null
          reservation_id?: string | null
          destination_seen_at?: string | null
          reviewed_at?: string | null
          purge_after?: string | null
        }
      }
      symptom_intakes: {
        Row: {
          id: string
          user_id: string | null
          thread_id: string | null
          symptoms: string
          duration: string | null
          severity: string | null
          age: string | null
          pregnancy_breastfeeding: boolean
          current_medications: string | null
          allergies: string | null
          photo_url: string | null
          status: string
          assigned_pharmacist: string | null
          pharmacist_response: string | null
          sla_deadline: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          thread_id?: string | null
          symptoms: string
          duration?: string | null
          severity?: string | null
          age?: string | null
          pregnancy_breastfeeding?: boolean
          current_medications?: string | null
          allergies?: string | null
          photo_url?: string | null
          status?: string
          assigned_pharmacist?: string | null
          pharmacist_response?: string | null
          sla_deadline?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          thread_id?: string | null
          symptoms?: string
          duration?: string | null
          severity?: string | null
          age?: string | null
          pregnancy_breastfeeding?: boolean
          current_medications?: string | null
          allergies?: string | null
          photo_url?: string | null
          status?: string
          assigned_pharmacist?: string | null
          pharmacist_response?: string | null
          sla_deadline?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      research_consent: {
        Row: {
          id: string
          user_id: string
          consented: boolean
          consent_text_version: string
          sessions_since_consent: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          consented: boolean
          consent_text_version: string
          sessions_since_consent?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          consented?: boolean
          consent_text_version?: string
          sessions_since_consent?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_notification: {
        Args: {
          p_recipient_type: string
          p_recipient_id: string
          p_type: string
          p_title: string
          p_body: string
          p_pharmacy_id?: string | null
          p_data?: Json
          p_deliveries?: Json
        }
        Returns: string
      }
      enqueue_notification_delivery: {
        Args: {
          p_notification_id: string | null
          p_channel: string
          p_provider: string
          p_idempotency_key: string
          p_legacy?: Json
        }
        Returns: Json
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      mark_all_notifications_read: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      match_catalogue_product: {
        Args: { search_query: string }
        Returns: {
          id: string
          generic_name: string
          brand_name: string | null
          manufacturer: string | null
          strength: string | null
          dosage_form: string
          category: string
          pack_size: string | null
          confidence: number
        }[]
      }
      sync_shift_open: {
        Args: { p_shift_id: string; p_pharmacy_id: string; p_opening_float: number; p_opened_at: string }
        Returns: Json
      }
      sync_pos_sale_with_shift: {
        Args: { p_pharmacy_id: string; p_sale: Json }
        Returns: Json
      }
      sync_shift_close: {
        Args: { p_shift_id: string; p_pharmacy_id: string; p_counted_cash: number; p_notes: string | null; p_closed_at: string }
        Returns: Json
      }
      get_shift_report: {
        Args: { p_shift_id: string }
        Returns: Json
      }
    }
    Enums: {
      user_role: 'patient' | 'pharmacy'
      message_role: 'user' | 'assistant'
      inventory_item_type: 'medicine' | 'store'
      stock_movement_type:
        | 'opening'
        | 'sale'
        | 'restock'
        | 'adjustment'
        | 'return'
        | 'expiry_writeoff'
        | 'transfer'
        | 'write_off'
    }
  }
}
