-- ============================================================
-- AZ Dispatch — 0019: new order status enum values ONLY.
--
-- MIGRATION RULE: Supabase runs each file in ONE transaction, so
-- enum values added here cannot be referenced in this same file.
-- That is the fix for the earlier bug where a migration added an
-- enum value and used it in the same run.
--
-- THIS FILE CONTAINS NOTHING BUT alter type ... add value if not
-- exists statements. Run it BEFORE 0020 (in the SQL editor, in
-- order). It is safe to re-run.
-- ============================================================

alter type public.order_status add value if not exists 'accepted_by_business';
alter type public.order_status add value if not exists 'ready_for_pickup';
alter type public.order_status add value if not exists 'rider_quoted';
