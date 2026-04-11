-- Add display_role column to profiles
-- Purpose: Let users pick one role to show as their primary label on cards.
-- Safe to run multiple times.

alter table public.profiles
  add column if not exists display_role text;

alter table public.demo_profiles
  add column if not exists display_role text;
