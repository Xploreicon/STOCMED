-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drugs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 1. Users policies
DROP POLICY IF EXISTS "Allow users to view own profile" ON public.users;
CREATE POLICY "Allow users to view own profile" 
ON public.users FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to insert own profile" ON public.users;
CREATE POLICY "Allow users to insert own profile" 
ON public.users FOR INSERT 
WITH CHECK (auth.uid() = user_id OR auth.uid() IS NULL); -- Allow registration triggers or custom signup flows

DROP POLICY IF EXISTS "Allow users to update own profile" ON public.users;
CREATE POLICY "Allow users to update own profile" 
ON public.users FOR UPDATE 
USING (auth.uid() = user_id);

-- 2. Pharmacies policies
DROP POLICY IF EXISTS "Allow active pharmacies to be publicly viewable" ON public.pharmacies;
CREATE POLICY "Allow active pharmacies to be publicly viewable" 
ON public.pharmacies FOR SELECT 
USING (is_active = TRUE OR user_id = auth.uid());

DROP POLICY IF EXISTS "Allow users to insert own pharmacy" ON public.pharmacies;
CREATE POLICY "Allow users to insert own pharmacy" 
ON public.pharmacies FOR INSERT 
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow users to update own pharmacy" ON public.pharmacies;
CREATE POLICY "Allow users to update own pharmacy" 
ON public.pharmacies FOR UPDATE 
USING (user_id = auth.uid());

-- 3. Drugs policies
DROP POLICY IF EXISTS "Allow viewing drugs of active pharmacies" ON public.drugs;
CREATE POLICY "Allow viewing drugs of active pharmacies" 
ON public.drugs FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.pharmacies p 
        WHERE p.id = pharmacy_id AND (p.is_active = TRUE OR p.user_id = auth.uid())
    )
);

DROP POLICY IF EXISTS "Allow pharmacies to manage own drugs" ON public.drugs;
CREATE POLICY "Allow pharmacies to manage own drugs" 
ON public.drugs FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.pharmacies p 
        WHERE p.id = pharmacy_id AND p.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.pharmacies p 
        WHERE p.id = pharmacy_id AND p.user_id = auth.uid()
    )
);

-- 4. Searches policies
DROP POLICY IF EXISTS "Allow users to view own searches" ON public.searches;
CREATE POLICY "Allow users to view own searches" 
ON public.searches FOR SELECT 
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow anyone to insert searches" ON public.searches;
CREATE POLICY "Allow anyone to insert searches" 
ON public.searches FOR INSERT 
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Allow updating own/anonymous searches for click metadata" ON public.searches;
CREATE POLICY "Allow updating own/anonymous searches for click metadata" 
ON public.searches FOR UPDATE 
USING (user_id = auth.uid() OR user_id IS NULL)
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Allow users to delete own searches" ON public.searches;
CREATE POLICY "Allow users to delete own searches" 
ON public.searches FOR DELETE 
USING (user_id = auth.uid());

-- 5. Chat Messages policies
DROP POLICY IF EXISTS "Allow users to view own chat messages" ON public.chat_messages;
CREATE POLICY "Allow users to view own chat messages" 
ON public.chat_messages FOR SELECT 
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow users/anon to insert chat messages" ON public.chat_messages;
CREATE POLICY "Allow users/anon to insert chat messages" 
ON public.chat_messages FOR INSERT 
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Allow users to update own chat messages" ON public.chat_messages;
CREATE POLICY "Allow users to update own chat messages" 
ON public.chat_messages FOR UPDATE 
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Allow users to delete own chat messages" ON public.chat_messages;
CREATE POLICY "Allow users to delete own chat messages" 
ON public.chat_messages FOR DELETE 
USING (user_id = auth.uid());
