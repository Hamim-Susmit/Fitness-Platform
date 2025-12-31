-- Development seed data for class scheduling
-- Requires an existing gym and owner/staff user.

with gym as (
  select id from public.gyms limit 1
),
owner_user as (
  select id from public.users where role = 'owner' limit 1
),
insert_types as (
  insert into public.class_types (gym_id, name, description, intensity, duration_minutes)
  select g.id, 'Yoga Flow', 'Breath-focused vinyasa flow', 'medium', 60 from gym g
  union all
  select g.id, 'HIIT Blast', 'High intensity interval training', 'high', 45 from gym g
  returning id, name
),
insert_instructor as (
  insert into public.instructors (gym_id, user_id, bio, specialties)
  select g.id, o.id, 'Certified trainer and yoga instructor', array['Yoga', 'HIIT']
  from gym g
  cross join owner_user o
  returning id
)
insert into public.class_schedules (
  gym_id,
  class_type_id,
  instructor_id,
  capacity,
  start_time,
  end_time,
  timezone,
  recurrence_rule,
  start_date,
  end_date
)
select
  g.id,
  (select id from insert_types where name = 'Yoga Flow' limit 1),
  (select id from insert_instructor limit 1),
  20,
  '07:00:00-05',
  '08:00:00-05',
  'America/New_York',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  current_date,
  null
from gym g;

insert into public.class_schedules (
  gym_id,
  class_type_id,
  instructor_id,
  capacity,
  start_time,
  end_time,
  timezone,
  recurrence_rule,
  start_date,
  end_date
)
select
  g.id,
  (select id from public.class_types where name = 'HIIT Blast' and gym_id = g.id limit 1),
  (select id from public.instructors where gym_id = g.id limit 1),
  15,
  '18:00:00-05',
  '18:45:00-05',
  'America/New_York',
  null,
  current_date + interval '7 days',
  current_date + interval '7 days'
from gym g;
