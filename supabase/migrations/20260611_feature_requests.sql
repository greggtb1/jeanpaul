-- Boîte à idées : demandes de features + votes

CREATE TABLE IF NOT EXISTS feature_requests (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  message     text NOT NULL CHECK (char_length(message) BETWEEN 5 AND 500),
  votes       int  NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_votes (
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  request_id  uuid REFERENCES feature_requests(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_votes    ENABLE ROW LEVEL SECURITY;

-- Lecture publique (tous les users connectés voient tout)
CREATE POLICY "fr_read"  ON feature_requests FOR SELECT USING (true);
CREATE POLICY "fv_read"  ON feature_votes    FOR SELECT USING (true);

-- Création : son propre message uniquement
CREATE POLICY "fr_insert" ON feature_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Vote : un user peut voter
CREATE POLICY "fv_insert" ON feature_votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Annuler son propre vote
CREATE POLICY "fv_delete" ON feature_votes
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger : incrémente / décrémente le compteur votes
CREATE OR REPLACE FUNCTION feature_votes_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feature_requests SET votes = votes + 1 WHERE id = NEW.request_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feature_requests SET votes = votes - 1 WHERE id = OLD.request_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER feature_votes_after
  AFTER INSERT OR DELETE ON feature_votes
  FOR EACH ROW EXECUTE FUNCTION feature_votes_sync();

-- Permettre à la fonction trigger de toucher feature_requests depuis feature_votes
CREATE POLICY "fr_update_votes" ON feature_requests
  FOR UPDATE USING (true);
