-- Phase 3: attendance tracking

alter table public.class_bookings
  add column if not exists attendance_status text not null default 'pending',
  add column if not exists attendance_marked_at timestamptz,
  add column if not exists attendance_marked_by uuid references public.staff (user_id);

alter table public.class_bookings
  drop constraint if exists class_bookings_attendance_status_check;

alter table public.class_bookings
  add constraint class_bookings_attendance_status_check
  check (attendance_status in ('pending', 'checked_in', 'no_show', 'excused'));

alter table public.class_instances
  add column if not exists checkin_method text not null default 'manual';

alter table public.class_instances
  drop constraint if exists class_instances_checkin_method_check;

alter table public.class_instances
  add constraint class_instances_checkin_method_check
  check (checkin_method in ('manual', 'qr', 'hybrid'));

create index if not exists idx_class_bookings_attendance
  on public.class_bookings (class_instance_id, attendance_status);

-- Booking status is lifecycle; attendance_status tracks roll-call state.
