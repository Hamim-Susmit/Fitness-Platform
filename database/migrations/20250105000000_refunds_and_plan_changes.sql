-- Refunds + plan changes support

alter table public.transactions
  add column if not exists refund_amount_cents integer not null default 0,
  add column if not exists refund_reason text;

alter table public.subscriptions
  add column if not exists previous_pricing_plan_id uuid references public.pricing_plans (id),
  add column if not exists plan_change_requested_at timestamptz;

create index if not exists idx_subscriptions_stripe_subscription_id
  on public.subscriptions (stripe_subscription_id);
