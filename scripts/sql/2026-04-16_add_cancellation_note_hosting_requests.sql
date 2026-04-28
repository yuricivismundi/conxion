-- Migration: add cancellation_note column to hosting_requests
-- Date: 2026-04-16

alter table public.hosting_requests
  add column if not exists cancellation_note text;
