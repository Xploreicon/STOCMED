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
          email: string
          full_name: string
          phone: string
          role: 'patient' | 'pharmacy'
          location: string | null
          created_at: string
          updated_at: string
          is_admin: boolean
          is_licensed_pharmacist: boolean
        }
        Insert: {
          id?: string
          email: string
          full_name: string
          phone: string
          role: 'patient' | 'pharmacy'
          location?: string | null
          created_at?: string
          updated_at?: string
          is_admin?: boolean
          is_licensed_pharmacist?: boolean
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          phone?: string
          role?: 'patient' | 'pharmacy'
          location?: string | null
          created_at?: string
          updated_at?: string
          is_admin?: boolean
          is_licensed_pharmacist?: boolean
        }
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
          created_at: string
          updated_at: string
          logo_url: string | null
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
          created_at?: string
          updated_at?: string
          logo_url?: string | null
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
          created_at?: string
          updated_at?: string
          logo_url?: string | null
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
          product_id: string
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
          product_id: string
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
          product_id?: string
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
