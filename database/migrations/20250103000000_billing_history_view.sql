-- Billing history view for invoices + transactions

create or replace view public.billing_history_view as
select
  s.member_id,
  s.id as subscription_id,
  i.id as invoice_id,
  t.id as transaction_id,
  s.current_period_start as period_start,
  s.current_period_end as period_end,
  coalesce(t.amount_cents, i.amount_due_cents) as amount_cents,
  coalesce(t.currency, 'usd') as currency,
  case
    when t.status = 'succeeded' then 'paid'
    when t.status = 'failed' then 'failed'
    when t.status = 'refunded' then 'refunded'
    when t.status = 'pending' then 'pending'
    else 'pending'
  end as status,
  i.hosted_invoice_url,
  i.pdf_url,
  i.created_at
from public.invoices i
join public.subscriptions s on s.id = i.subscription_id
left join lateral (
  select t.*
  from public.transactions t
  where t.subscription_id = s.id
  order by t.created_at desc
  limit 1
) t on true;

create index if not exists idx_subscriptions_member_id on public.subscriptions (member_id);
create index if not exists idx_invoices_subscription_id on public.invoices (subscription_id);
