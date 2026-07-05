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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
