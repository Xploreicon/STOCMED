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
          user_id: string
          query: string
          results_count: number
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          query: string
          results_count: number
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          query?: string
          results_count?: number
          metadata?: Json | null
          created_at?: string
        }
      }
      chat_messages: {
        Row: {
          id: string
          user_id: string | null
          session_id: string | null
          role: 'user' | 'assistant'
          content: string
          metadata: Json | null
          timestamp: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          role: 'user' | 'assistant'
          content: string
          metadata?: Json | null
          timestamp?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          session_id?: string | null
          role?: 'user' | 'assistant'
          content?: string
          metadata?: Json | null
          timestamp?: string
        }
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
    }
  }
}
