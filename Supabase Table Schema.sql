-- SQL script to create the 'candidates' table for the LinkedIn Scraper extension.
-- Run this in your Supabase project's SQL Editor.

CREATE TABLE public.candidates (
  -- A unique identifier for each record. Using UUID is best practice.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core information scraped from LinkedIn.
  candidate_name VARCHAR(255),
  current_title VARCHAR(255),
  current_company VARCHAR(255),
  
  -- The LinkedIn URL must be unique to prevent duplicate entries for the same person.
  linkedin_url TEXT UNIQUE,

  -- A long-form text field to store the concatenated summary of the profile.
  candidate_description TEXT,
  
  -- Fields for future analytical use. They are nullable for now.
  overall_score NUMERIC,
  technical_skills NUMERIC,
  experience_relevance NUMERIC,
  seniority_match NUMERIC,
  education_fit NUMERIC,
  industry_experience NUMERIC,
  location_compatibility NUMERIC,
  confidence_level NUMERIC,
  strengths TEXT,
  concerns TEXT,
  recommendations TEXT,
  match_explanation TEXT,
  key_differentiators TEXT,
  interview_focus_areas TEXT,

  -- Metadata fields.
  source VARCHAR(255) DEFAULT 'LinkedIn Extension',
  created_at TIMESTAMPTZ WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add comments to columns for better documentation within the database.
COMMENT ON TABLE public.candidates IS 'Stores candidate data scraped from LinkedIn profiles via a Chrome Extension.';
COMMENT ON COLUMN public.candidates.linkedin_url IS 'Unique URL of the candidate''s public LinkedIn profile.';
COMMENT ON COLUMN public.candidates.candidate_description IS 'A comprehensive, concatenated summary of the candidate''s About, Experience, and Education sections.';

-- IMPORTANT: Enable Row Level Security (RLS) on the new table.
-- This is a critical security measure. By default, tables are not accessible via the public API.
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows anonymous users (the extension) to insert data.
-- For a production app, you might want more restrictive policies, but this is a good start.
CREATE POLICY "Allow public insert for anyone" ON public.candidates FOR INSERT WITH CHECK (true);

-- Optional: Create a policy to allow reading of data. 
-- For this extension's purpose, it's not strictly necessary, but can be useful for debugging.
CREATE POLICY "Allow public read for anyone" ON public.candidates FOR SELECT USING (true);

