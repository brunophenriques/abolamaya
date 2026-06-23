-- A Bola Maya - World Cup 2026 Predictions
-- Run this entire file in the Supabase SQL Editor

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  display_name TEXT,
  is_admin    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.matches (
  id          INTEGER PRIMARY KEY,
  group_id    TEXT NOT NULL CHECK (group_id IN ('A','B','C','D','E','F','G','H','I','J','K','L')),
  home_team   TEXT NOT NULL,
  away_team   TEXT NOT NULL,
  home_flag   TEXT NOT NULL,
  away_flag   TEXT NOT NULL,
  match_date  DATE NOT NULL,
  venue       TEXT NOT NULL,
  home_score  INTEGER,
  away_score  INTEGER,
  status      TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','finished'))
);

CREATE TABLE IF NOT EXISTS public.match_predictions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  match_id     INTEGER REFERENCES public.matches(id) ON DELETE CASCADE NOT NULL,
  home_score   INTEGER NOT NULL CHECK (home_score >= 0),
  away_score   INTEGER NOT NULL CHECK (away_score >= 0),
  points_earned INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, match_id)
);

-- Stores calculated group points after all group matches finish
CREATE TABLE IF NOT EXISTS public.group_points (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  group_id         TEXT NOT NULL,
  predicted_order  TEXT[] NOT NULL,  -- ['Team1','Team2','Team3','Team4']
  actual_order     TEXT[],
  points_earned    INTEGER DEFAULT 0,
  calculated_at    TIMESTAMPTZ,
  UNIQUE(user_id, group_id)
);

CREATE TABLE IF NOT EXISTS public.lobbies (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lobby_members (
  lobby_id  UUID REFERENCES public.lobbies(id) ON DELETE CASCADE NOT NULL,
  user_id   UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lobby_id, user_id)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_points    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobbies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lobby_members   ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "profiles_select"  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert"  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update"  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Matches (public read, admin write via RPC)
CREATE POLICY "matches_select" ON public.matches FOR SELECT USING (true);
CREATE POLICY "matches_update" ON public.matches FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Match predictions
CREATE POLICY "mp_select" ON public.match_predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "mp_insert" ON public.match_predictions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "mp_update" ON public.match_predictions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "mp_delete" ON public.match_predictions FOR DELETE USING (auth.uid() = user_id);

-- Group points (admin managed)
CREATE POLICY "gp_select" ON public.group_points FOR SELECT TO authenticated USING (true);
CREATE POLICY "gp_all"    ON public.group_points FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Lobbies
CREATE POLICY "lobbies_select" ON public.lobbies FOR SELECT TO authenticated USING (
  id IN (SELECT lobby_id FROM public.lobby_members WHERE user_id = auth.uid())
  OR created_by = auth.uid()
);
CREATE POLICY "lobbies_insert" ON public.lobbies FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "lobbies_update" ON public.lobbies FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "lobbies_delete" ON public.lobbies FOR DELETE USING (auth.uid() = created_by);

-- Lobby members
CREATE POLICY "lm_select" ON public.lobby_members FOR SELECT TO authenticated USING (
  lobby_id IN (SELECT lobby_id FROM public.lobby_members lm2 WHERE lm2.user_id = auth.uid())
);
CREATE POLICY "lm_insert" ON public.lobby_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lm_delete" ON public.lobby_members FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1))
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Calculate match points for all predictions when a match is marked finished
CREATE OR REPLACE FUNCTION public.calculate_match_points(p_match_id INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_home INTEGER; v_away INTEGER; v_result INTEGER; v_rows INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT home_score, away_score INTO v_home, v_away
  FROM public.matches WHERE id = p_match_id AND status = 'finished';
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not finished'; END IF;
  v_result := SIGN(v_home - v_away);
  UPDATE public.match_predictions
  SET points_earned = CASE
    WHEN home_score = v_home AND away_score = v_away THEN 3
    WHEN SIGN(home_score - away_score) = v_result THEN 1
    ELSE 0
  END, updated_at = NOW()
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- Set match result (admin only)
CREATE OR REPLACE FUNCTION public.set_match_result(p_id INTEGER, p_home INTEGER, p_away INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.matches SET home_score = p_home, away_score = p_away, status = 'finished'
  WHERE id = p_id;
END;
$$;

-- Save group points for one user (admin only, called from JS after standings calc)
CREATE OR REPLACE FUNCTION public.save_group_points(
  p_user_id UUID, p_group TEXT,
  p_predicted TEXT[], p_actual TEXT[], p_points INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO public.group_points (user_id, group_id, predicted_order, actual_order, points_earned, calculated_at)
  VALUES (p_user_id, p_group, p_predicted, p_actual, p_points, NOW())
  ON CONFLICT (user_id, group_id) DO UPDATE
  SET predicted_order = p_predicted, actual_order = p_actual,
      points_earned = p_points, calculated_at = NOW();
END;
$$;

-- Join lobby by invite code
CREATE OR REPLACE FUNCTION public.join_lobby(p_code TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.lobbies WHERE invite_code = UPPER(p_code);
  IF NOT FOUND THEN RAISE EXCEPTION 'Código inválido'; END IF;
  INSERT INTO public.lobby_members (lobby_id, user_id)
  VALUES (v_id, auth.uid()) ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;

-- ============================================================
-- LEADERBOARD VIEW
-- ============================================================

CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  p.id, p.username, p.display_name,
  COALESCE(mp.pts, 0)  AS match_points,
  COALESCE(gp.pts, 0)  AS group_points,
  COALESCE(mp.pts, 0) + COALESCE(gp.pts, 0) AS total_points,
  COALESCE(mp.cnt, 0)  AS predictions_made
FROM public.profiles p
LEFT JOIN (
  SELECT user_id, SUM(COALESCE(points_earned, 0)) AS pts, COUNT(*) AS cnt
  FROM public.match_predictions GROUP BY user_id
) mp ON mp.user_id = p.id
LEFT JOIN (
  SELECT user_id, SUM(COALESCE(points_earned, 0)) AS pts
  FROM public.group_points GROUP BY user_id
) gp ON gp.user_id = p.id
ORDER BY total_points DESC, match_points DESC, p.username;

-- ============================================================
-- FIXTURES  (72 group stage matches)
-- ============================================================

INSERT INTO public.matches (id, group_id, home_team, away_team, home_flag, away_flag, match_date, venue) VALUES
-- GROUP A
(1,  'A', 'Mexico',         'South Africa',           '🇲🇽','🇿🇦','2026-06-11','Estadio Azteca, Mexico City'),
(2,  'A', 'Korea Republic', 'Czechia',                '🇰🇷','🇨🇿','2026-06-11','Estadio Akron, Guadalajara'),
(3,  'A', 'Czechia',        'South Africa',           '🇨🇿','🇿🇦','2026-06-18','Mercedes-Benz Stadium, Atlanta'),
(4,  'A', 'Mexico',         'Korea Republic',         '🇲🇽','🇰🇷','2026-06-18','Estadio Akron, Guadalajara'),
(5,  'A', 'Czechia',        'Mexico',                 '🇨🇿','🇲🇽','2026-06-24','Estadio Azteca, Mexico City'),
(6,  'A', 'South Africa',   'Korea Republic',         '🇿🇦','🇰🇷','2026-06-24','Estadio BBVA, Monterrey'),
-- GROUP B
(7,  'B', 'Canada',                 'Bosnia and Herzegovina','🇨🇦','🇧🇦','2026-06-12','BMO Field, Toronto'),
(8,  'B', 'Qatar',                  'Switzerland',          '🇶🇦','🇨🇭','2026-06-13','Levi''s Stadium, San Francisco'),
(9,  'B', 'Switzerland',            'Bosnia and Herzegovina','🇨🇭','🇧🇦','2026-06-18','SoFi Stadium, Los Angeles'),
(10, 'B', 'Canada',                 'Qatar',                '🇨🇦','🇶🇦','2026-06-18','BC Place, Vancouver'),
(11, 'B', 'Switzerland',            'Canada',               '🇨🇭','🇨🇦','2026-06-24','BC Place, Vancouver'),
(12, 'B', 'Bosnia and Herzegovina', 'Qatar',                '🇧🇦','🇶🇦','2026-06-24','Lumen Field, Seattle'),
-- GROUP C
(13, 'C', 'Haiti',   'Scotland','🇭🇹','🏴󠁧󠁢󠁳󠁣󠁴󠁿','2026-06-13','Gillette Stadium, Boston'),
(14, 'C', 'Brazil',  'Morocco', '🇧🇷','🇲🇦','2026-06-13','MetLife Stadium, New York/New Jersey'),
(15, 'C', 'Brazil',  'Haiti',   '🇧🇷','🇭🇹','2026-06-19','Lincoln Financial Field, Philadelphia'),
(16, 'C', 'Scotland','Morocco', '🏴󠁧󠁢󠁳󠁣󠁴󠁿','🇲🇦','2026-06-19','Gillette Stadium, Boston'),
(17, 'C', 'Scotland','Brazil',  '🏴󠁧󠁢󠁳󠁣󠁴󠁿','🇧🇷','2026-06-24','Hard Rock Stadium, Miami'),
(18, 'C', 'Morocco', 'Haiti',   '🇲🇦','🇭🇹','2026-06-24','Mercedes-Benz Stadium, Atlanta'),
-- GROUP D
(19, 'D', 'USA',      'Paraguay', '🇺🇸','🇵🇾','2026-06-12','SoFi Stadium, Los Angeles'),
(20, 'D', 'Australia','Türkiye',  '🇦🇺','🇹🇷','2026-06-13','BC Place, Vancouver'),
(21, 'D', 'Türkiye',  'Paraguay', '🇹🇷','🇵🇾','2026-06-19','Levi''s Stadium, San Francisco'),
(22, 'D', 'USA',      'Australia','🇺🇸','🇦🇺','2026-06-19','Lumen Field, Seattle'),
(23, 'D', 'Türkiye',  'USA',      '🇹🇷','🇺🇸','2026-06-25','SoFi Stadium, Los Angeles'),
(24, 'D', 'Paraguay', 'Australia','🇵🇾','🇦🇺','2026-06-25','Levi''s Stadium, San Francisco'),
-- GROUP E
(25, 'E', 'Côte d''Ivoire','Ecuador',        '🇨🇮','🇪🇨','2026-06-14','Lincoln Financial Field, Philadelphia'),
(26, 'E', 'Germany',       'Curaçao',        '🇩🇪','🇨🇼','2026-06-14','NRG Stadium, Houston'),
(27, 'E', 'Germany',       'Côte d''Ivoire', '🇩🇪','🇨🇮','2026-06-20','BMO Field, Toronto'),
(28, 'E', 'Ecuador',       'Curaçao',        '🇪🇨','🇨🇼','2026-06-20','Arrowhead Stadium, Kansas City'),
(29, 'E', 'Curaçao',       'Côte d''Ivoire', '🇨🇼','🇨🇮','2026-06-25','Lincoln Financial Field, Philadelphia'),
(30, 'E', 'Ecuador',       'Germany',        '🇪🇨','🇩🇪','2026-06-25','MetLife Stadium, New York/New Jersey'),
-- GROUP F
(31, 'F', 'Netherlands','Japan',       '🇳🇱','🇯🇵','2026-06-14','AT&T Stadium, Dallas'),
(32, 'F', 'Sweden',     'Tunisia',     '🇸🇪','🇹🇳','2026-06-14','Estadio BBVA, Monterrey'),
(33, 'F', 'Netherlands','Sweden',      '🇳🇱','🇸🇪','2026-06-20','NRG Stadium, Houston'),
(34, 'F', 'Tunisia',    'Japan',       '🇹🇳','🇯🇵','2026-06-20','Estadio BBVA, Monterrey'),
(35, 'F', 'Japan',      'Sweden',      '🇯🇵','🇸🇪','2026-06-25','AT&T Stadium, Dallas'),
(36, 'F', 'Tunisia',    'Netherlands', '🇹🇳','🇳🇱','2026-06-25','Arrowhead Stadium, Kansas City'),
-- GROUP G
(37, 'G', 'IR Iran',    'New Zealand','🇮🇷','🇳🇿','2026-06-15','SoFi Stadium, Los Angeles'),
(38, 'G', 'Belgium',    'Egypt',      '🇧🇪','🇪🇬','2026-06-15','Lumen Field, Seattle'),
(39, 'G', 'Belgium',    'IR Iran',    '🇧🇪','🇮🇷','2026-06-21','SoFi Stadium, Los Angeles'),
(40, 'G', 'New Zealand','Egypt',      '🇳🇿','🇪🇬','2026-06-21','BC Place, Vancouver'),
(41, 'G', 'Egypt',      'IR Iran',    '🇪🇬','🇮🇷','2026-06-26','Lumen Field, Seattle'),
(42, 'G', 'New Zealand','Belgium',    '🇳🇿','🇧🇪','2026-06-26','BC Place, Vancouver'),
-- GROUP H
(43, 'H', 'Saudi Arabia','Uruguay',    '🇸🇦','🇺🇾','2026-06-15','Hard Rock Stadium, Miami'),
(44, 'H', 'Spain',       'Cabo Verde', '🇪🇸','🇨🇻','2026-06-15','Mercedes-Benz Stadium, Atlanta'),
(45, 'H', 'Uruguay',     'Cabo Verde', '🇺🇾','🇨🇻','2026-06-21','Hard Rock Stadium, Miami'),
(46, 'H', 'Spain',       'Saudi Arabia','🇪🇸','🇸🇦','2026-06-21','Mercedes-Benz Stadium, Atlanta'),
(47, 'H', 'Cabo Verde',  'Saudi Arabia','🇨🇻','🇸🇦','2026-06-26','NRG Stadium, Houston'),
(48, 'H', 'Uruguay',     'Spain',      '🇺🇾','🇪🇸','2026-06-26','Estadio Akron, Guadalajara'),
-- GROUP I
(49, 'I', 'France', 'Senegal','🇫🇷','🇸🇳','2026-06-16','MetLife Stadium, New York/New Jersey'),
(50, 'I', 'Iraq',   'Norway', '🇮🇶','🇳🇴','2026-06-16','Gillette Stadium, Boston'),
(51, 'I', 'Norway', 'Senegal','🇳🇴','🇸🇳','2026-06-22','MetLife Stadium, New York/New Jersey'),
(52, 'I', 'France', 'Iraq',   '🇫🇷','🇮🇶','2026-06-22','Lincoln Financial Field, Philadelphia'),
(53, 'I', 'Norway', 'France', '🇳🇴','🇫🇷','2026-06-26','Gillette Stadium, Boston'),
(54, 'I', 'Senegal','Iraq',   '🇸🇳','🇮🇶','2026-06-26','BMO Field, Toronto'),
-- GROUP J
(55, 'J', 'Argentina','Algeria', '🇦🇷','🇩🇿','2026-06-16','Arrowhead Stadium, Kansas City'),
(56, 'J', 'Austria',  'Jordan',  '🇦🇹','🇯🇴','2026-06-16','Levi''s Stadium, San Francisco'),
(57, 'J', 'Argentina','Austria', '🇦🇷','🇦🇹','2026-06-22','AT&T Stadium, Dallas'),
(58, 'J', 'Jordan',   'Algeria', '🇯🇴','🇩🇿','2026-06-22','Levi''s Stadium, San Francisco'),
(59, 'J', 'Algeria',  'Austria', '🇩🇿','🇦🇹','2026-06-27','Arrowhead Stadium, Kansas City'),
(60, 'J', 'Jordan',   'Argentina','🇯🇴','🇦🇷','2026-06-27','AT&T Stadium, Dallas'),
-- GROUP K
(61, 'K', 'Portugal',  'Congo DR',  '🇵🇹','🇨🇩','2026-06-17','NRG Stadium, Houston'),
(62, 'K', 'Uzbekistan','Colombia',  '🇺🇿','🇨🇴','2026-06-17','Estadio Azteca, Mexico City'),
(63, 'K', 'Portugal',  'Uzbekistan','🇵🇹','🇺🇿','2026-06-23','NRG Stadium, Houston'),
(64, 'K', 'Colombia',  'Congo DR',  '🇨🇴','🇨🇩','2026-06-23','Estadio Akron, Guadalajara'),
(65, 'K', 'Colombia',  'Portugal',  '🇨🇴','🇵🇹','2026-06-27','Hard Rock Stadium, Miami'),
(66, 'K', 'Congo DR',  'Uzbekistan','🇨🇩','🇺🇿','2026-06-27','Mercedes-Benz Stadium, Atlanta'),
-- GROUP L
(67, 'L', 'Ghana',  'Panama', '🇬🇭','🇵🇦','2026-06-17','BMO Field, Toronto'),
(68, 'L', 'England','Croatia','🏴󠁧󠁢󠁥󠁮󠁧󠁿','🇭🇷','2026-06-17','AT&T Stadium, Dallas'),
(69, 'L', 'England','Ghana',  '🏴󠁧󠁢󠁥󠁮󠁧󠁿','🇬🇭','2026-06-23','Gillette Stadium, Boston'),
(70, 'L', 'Panama', 'Croatia','🇵🇦','🇭🇷','2026-06-23','BMO Field, Toronto'),
(71, 'L', 'Panama', 'England','🇵🇦','🏴󠁧󠁢󠁥󠁮󠁧󠁿','2026-06-27','MetLife Stadium, New York/New Jersey'),
(72, 'L', 'Croatia','Ghana',  '🇭🇷','🇬🇭','2026-06-27','Lincoln Financial Field, Philadelphia')
ON CONFLICT (id) DO NOTHING;
