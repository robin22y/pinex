-- feat: create journal_meta table with RLS
-- Run this in Supabase SQL Editor

CREATE TABLE journal_meta (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  company_name text,
  status text DEFAULT 'watching'
    CHECK (status IN ('watching','owned','sold')),
  entry_date date NOT NULL,
  next_review_due date,
  review_stage text DEFAULT '7d'
    CHECK (review_stage IN
      ('7d','30d','90d','180d','365d','post_sell_90d','complete')),
  sell_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE journal_meta ENABLE ROW LEVEL SECURITY;

-- Add policy: users can only read and write their own rows
CREATE POLICY "Users own their journal meta"
ON journal_meta
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
