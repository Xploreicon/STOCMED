import type { Database } from '@/types/supabase'

// Older generated tables omitted Relationships. The pinned SDK requires that
// structural field even when a table has no relationship metadata. Types only;
// database objects, grants and generated Row/Insert/Update fields are unchanged.
type ClientTables = {
  [Name in keyof Database['public']['Tables']]: Database['public']['Tables'][Name] & {
    Relationships: Database['public']['Tables'][Name] extends { Relationships: infer Relations }
      ? Relations : []
  }
}
export type ClientDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: ClientTables
    Functions: Database['public']['Functions'] & {
      complete_oauth_profile: {
        Args: {
          p_role: 'patient'; p_full_name: string; p_phone: string; p_location: string
          p_pharmacy_name: null; p_license_number: null; p_address: null; p_city: null; p_state: null
        }
        Returns: { role: 'patient' | 'pharmacy'; pharmacy_id: string | null; existing_profile: boolean }
      }
    }
  }
}
