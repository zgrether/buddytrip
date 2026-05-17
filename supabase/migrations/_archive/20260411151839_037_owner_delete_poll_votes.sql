-- Allow trip owners to delete any vote on their trip's date windows
-- (needed for the "Reset votes" feature — regular RLS only lets users
--  delete their own rows, so the owner's client silently skipped others)
CREATE POLICY "trip_owner_can_delete_poll_votes"
  ON date_poll_votes
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM date_windows dw
      JOIN trip_members tm ON tm.trip_id = dw.trip_id
      WHERE dw.id = date_poll_votes.window_id
        AND tm.user_id = auth.uid()::text
        AND tm.role = 'Owner'
    )
  );
