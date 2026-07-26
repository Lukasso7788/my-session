-- Assign all infinite-room templates to the dedicated MySession account.
-- Kept as a separate migration because the ownership/admin migration may
-- already have been applied before this Auth user was created.
select public.assign_mysession_infinite_room_ownership(
  'ccdfa263-9c1f-4cb0-a9c1-b57f41b191bc'::uuid
);
