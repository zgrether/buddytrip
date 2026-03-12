-- BuddyTrip Seed Data
-- All mock data from buddytrip-2.html translated to SQL
-- Wrapped in a transaction with deferred constraints for circular FKs

BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- ═══════════════════════════════════════════════════════════════
-- 1. USERS (23 users)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO users (id, name, nickname, email, created_at) VALUES
  ('brad',    'Brad Giesler',     'Brad',    'brad.giesler@gmail.com',     '2023-01-01T00:00:00Z'),
  ('zach',    'Zach Grether',     'Grether', 'zach.grether@gmail.com',     '2023-01-01T00:00:00Z'),
  ('jd',      'JD Shumpert',      'JD',      'jd.shumpert@gmail.com',      '2023-01-01T00:00:00Z'),
  ('rob',     'Rob Drupp',        'Rob',     'rob.drupp@gmail.com',        '2023-01-02T00:00:00Z'),
  ('charlie', 'Charlie Piper',    'Charlie', 'charlie.piper@gmail.com',    '2023-01-02T00:00:00Z'),
  ('tyler',   'Tyler Larson',     'Tyler',   'tyler.larson@gmail.com',     '2023-01-03T00:00:00Z'),
  ('ben',     'Ben Bartkus',      'Ben',     'ben.bartkus@gmail.com',      '2023-01-03T00:00:00Z'),
  ('bj',      'BJ Dames',         'BJ',      'bj.dames@gmail.com',         '2023-01-04T00:00:00Z'),
  ('merling', 'Jeremy Merling',   'Merling', 'jeremy.merling@gmail.com',   '2023-01-04T00:00:00Z'),
  ('steve',   'Steve Bartkus',    'Steve',   'steve.bartkus@gmail.com',    '2023-01-05T00:00:00Z'),
  ('fach',    'Matt Facchine',    'Fach',    'matt.facchine@gmail.com',    '2023-01-05T00:00:00Z'),
  ('llama',   'Llama Schumacher', 'Llama',   'llama.schumacher@gmail.com', '2023-01-06T00:00:00Z'),
  ('jrob',    'John Robinson',    'JRob',    'john.robinson@gmail.com',    '2023-01-06T00:00:00Z'),
  ('buddy',   'Buddy Banks',      'Buddy',   'buddy.banks@gmail.com',      '2023-01-07T00:00:00Z'),
  ('frank',   'Frank Damen',      'Frank',   'frank.damen@gmail.com',      '2023-01-07T00:00:00Z'),
  ('taj',     'Tajar Varghese',   'Taj',     'taj.varghese@gmail.com',     '2023-01-08T00:00:00Z'),
  -- 3-team event players
  ('r1',      'Ryan Red',         'Ryan',    'ryan.red@gmail.com',         '2024-01-01T00:00:00Z'),
  ('r2',      'Rick Red',         'Rick',    'rick.red@gmail.com',         '2024-01-01T00:00:00Z'),
  ('r3',      'Rory Red',         'Rory',    'rory.red@gmail.com',         '2024-01-01T00:00:00Z'),
  ('g1',      'Greg Green',       'Greg',    'greg.green@gmail.com',       '2024-01-02T00:00:00Z'),
  ('g2',      'Gary Green',       'Gary',    'gary.green@gmail.com',       '2024-01-02T00:00:00Z'),
  ('g3',      'Grant Green',      'Grant',   'grant.green@gmail.com',      '2024-01-02T00:00:00Z'),
  ('b1',      'Blake Blue',       'Blake',   'blake.blue@gmail.com',       '2024-01-03T00:00:00Z'),
  ('b2',      'Brett Blue',       'Brett',   'brett.blue@gmail.com',       '2024-01-03T00:00:00Z'),
  ('b3',      'Brian Blue',       'Brian',   'brian.blue@gmail.com',       '2024-01-03T00:00:00Z'),
  -- Non-player crew
  ('mike',    'Mike Donovan',     'Mike',    'mike.donovan@gmail.com',     '2024-06-01T00:00:00Z'),
  ('paul',    'Paul Schaefer',    'Paul',    'paul.s@outlook.com',         '2024-06-01T00:00:00Z'),
  ('lance',   'Lance Watts',      'Lance',   'lwatts@gmail.com',           '2024-06-01T00:00:00Z');

-- ═══════════════════════════════════════════════════════════════
-- 2. SERIES
-- ═══════════════════════════════════════════════════════════════

INSERT INTO series (id, name, full_name, years, trip_count, owner_id) VALUES
  ('series-bbmi',  'BBMI',           'Buddy Banks Memorial Invitational', '2024-2027', 4, 'brad'),
  ('series-ryder', 'Ryder Knockoff', 'Ryder Knockoff Cup',                '2023',      1, 'brad');

-- ═══════════════════════════════════════════════════════════════
-- 3. TRIPS (6 trips)
-- event_id FK deferred — events inserted next
-- ═══════════════════════════════════════════════════════════════

INSERT INTO trips (id, title, series_id, location, cost_tier, image_url, description, start_date, end_date, accommodation, notes, activities, golf_courses, comparison_mode, event_id, locked_destination_title, locked_destination_location, locked_destination_at, created_at, updated_at) VALUES
  (
    'trip-bbmi-live', 'BBMI 2025', 'series-bbmi', 'Bandon Dunes, OR', '$$$$',
    'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=800&q=80',
    'The Buddy Banks Memorial Invitational. 16 players, 4 days, Ryder Cup format. Day 3 underway — Sabotage round at Pacific Dunes.',
    '2025-03-11', '2025-03-14',
    'Bandon Dunes Lodge — Door code: 4892',
    'Caddies confirmed for all rounds. Walking only, no carts.',
    ARRAY['Golf', 'Hammerschlagen', 'Poker', 'Cards'],
    ARRAY['Bandon Dunes', 'Bandon Trails', 'Pacific Dunes', 'Old Macdonald'],
    false, 'bbmi-2025',
    'Bandon Dunes', 'Bandon Dunes, OR', '2024-08-20T11:00:00Z',
    '2024-10-15T00:00:00Z', '2024-10-15T00:00:00Z'
  ),
  (
    'trip-bbmi', 'BBMI 2026', 'series-bbmi', 'Scottsdale, AZ', '$$$',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
    'Annual BBMI. Destination still being voted on — Scottsdale vs Bandon return.',
    '2026-03-09', '2026-03-12',
    'TBD — voting on destination first',
    'Need 6 firm commitments before booking anything.',
    ARRAY['Golf', 'Poker', 'Hammerschlagen'],
    ARRAY[]::text[],
    true, NULL,
    NULL, NULL, NULL,
    '2025-10-01T00:00:00Z', '2025-10-01T00:00:00Z'
  ),
  (
    'trip-new-deciding', 'BBMI 2027', 'series-bbmi', NULL, NULL,
    NULL,
    'Just started planning. First idea on the table — waiting for more.',
    NULL, NULL, NULL, NULL,
    ARRAY[]::text[], ARRAY[]::text[],
    true, NULL,
    NULL, NULL, NULL,
    '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'
  ),
  (
    'trip-bbmi-2024', 'BBMI 2024', 'series-bbmi', 'Bandon Dunes, OR', '$$$$',
    'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=800&q=80',
    'The 3rd Annual Buddy Banks Memorial Invitational. 16 players, 4 days, Ryder Cup format. Team Hammer won the Cup 14–12 in a dramatic final-round comeback at Old Macdonald. JD Shumpert went 3-0 to earn MVP honors.',
    '2024-03-12', '2024-03-15',
    'Bandon Dunes Lodge',
    'Final: Team Hammer 14, Team Eagle 12. MVP: JD Shumpert (3-0). Walking only — no carts.',
    ARRAY['Golf', 'Hammerschlagen', 'Poker', 'Cards'],
    ARRAY['Bandon Dunes', 'Bandon Trails', 'Pacific Dunes', 'Old Macdonald'],
    false, NULL,
    'Bandon Dunes', 'Bandon Dunes, OR', '2023-08-15T10:00:00Z',
    '2023-10-01T00:00:00Z', '2023-10-01T00:00:00Z'
  ),
  (
    'trip-ryder-2023', 'Ryder Knockoff 2023', 'series-ryder', 'Pebble Beach, CA', '$$$$',
    'https://images.unsplash.com/photo-1592919505780-303950717480?w=800&q=80',
    'The inaugural Ryder Knockoff Cup. 12 players, 3 days, match play format. Team USA won 9–7.',
    '2023-08-10', '2023-08-12',
    'Pebble Beach Lodge',
    'Final: USA 9, Europe 7.',
    ARRAY['Golf', 'Poker'],
    ARRAY['Pebble Beach', 'Spyglass Hill', 'Monterey Peninsula'],
    false, NULL,
    'Pebble Beach', 'Pebble Beach, CA', '2023-03-01T00:00:00Z',
    '2023-04-01T00:00:00Z', '2023-04-01T00:00:00Z'
  ),
  (
    'trip-threesome', '3-Team Test', NULL, 'Pinehurst, NC', '$$$',
    'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=800&q=80',
    '3-team match play test event — 9 players, 3 threesomes.',
    '2025-04-05', '2025-04-07',
    'Pinehurst Resort',
    '3-team format test.',
    ARRAY['Golf'],
    ARRAY['Pinehurst No. 2'],
    false, 'threesome-test',
    'Pinehurst', 'Pinehurst, NC', '2025-01-15T00:00:00Z',
    '2025-01-15T00:00:00Z', '2025-01-15T00:00:00Z'
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. EVENTS (2 events)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO events (id, trip_id, title, subtitle, motto, location, dates, status, competition_type) VALUES
  ('bbmi-2025',      'trip-bbmi-live', 'BBMI 2025',        'Buddy Banks Memorial Invitational', E'If You''re Not First, You''re Last', 'Bandon Dunes, OR', 'March 11–14, 2025', 'active',    'RYDER_CUP'),
  ('threesome-test', 'trip-threesome', '3-Team Test Event', '3-Team Match Play',                 E'Three''s Company',                  'Pinehurst, NC',    'April 5–7, 2025',   'active',    'NORMAL');

-- ═══════════════════════════════════════════════════════════════
-- 5. TEAMS (5 teams across 2 events)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO teams (id, event_id, name, short_name, color, color_dim) VALUES
  -- BBMI 2025 teams
  ('team-a', 'bbmi-2025', 'Team Hammer', 'Hammer', '#00d4aa', '#0d2a22'),
  ('team-b', 'bbmi-2025', 'Team Anvil',  'Anvil',  '#f97316', '#2a1200'),
  -- 3-team event teams
  ('team-red',   'threesome-test', 'Red Team',   'Red',   '#ef4444', '#2a0a0a'),
  ('team-green', 'threesome-test', 'Green Team', 'Green', '#22c55e', '#0a2a0f'),
  ('team-blue',  'threesome-test', 'Blue Team',  'Blue',  '#3b82f6', '#0a1a2a');

-- ═══════════════════════════════════════════════════════════════
-- 6. PLAYERS (25 players across 2 events)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO players (id, event_id, user_id, name, nickname, handicap) VALUES
  -- BBMI 2025 players (16)
  ('player-brad-bbmi',    'bbmi-2025', 'brad',    'Brad Giesler',     'Brad',    8),
  ('player-zach-bbmi',    'bbmi-2025', 'zach',    'Zach Grether',     'Grether', 12),
  ('player-tyler-bbmi',   'bbmi-2025', 'tyler',   'Tyler Larson',     'Tyler',   14),
  ('player-ben-bbmi',     'bbmi-2025', 'ben',     'Ben Bartkus',      'Ben',     16),
  ('player-merling-bbmi', 'bbmi-2025', 'merling', 'Jeremy Merling',   'Merling', 10),
  ('player-steve-bbmi',   'bbmi-2025', 'steve',   'Steve Bartkus',    'Steve',   18),
  ('player-fach-bbmi',    'bbmi-2025', 'fach',    'Matt Facchine',    'Fach',    15),
  ('player-llama-bbmi',   'bbmi-2025', 'llama',   'Llama Schumacher', 'Llama',   20),
  ('player-jd-bbmi',      'bbmi-2025', 'jd',      'JD Shumpert',      'JD',      7),
  ('player-rob-bbmi',     'bbmi-2025', 'rob',     'Rob Drupp',        'Rob',     11),
  ('player-charlie-bbmi', 'bbmi-2025', 'charlie', 'Charlie Piper',    'Charlie', 13),
  ('player-bj-bbmi',      'bbmi-2025', 'bj',      'BJ Dames',         'BJ',      17),
  ('player-jrob-bbmi',    'bbmi-2025', 'jrob',    'John Robinson',    'JRob',    9),
  ('player-buddy-bbmi',   'bbmi-2025', 'buddy',   'Buddy Banks',      'Buddy',   19),
  ('player-frank-bbmi',   'bbmi-2025', 'frank',   'Frank Damen',      'Frank',   16),
  ('player-taj-bbmi',     'bbmi-2025', 'taj',     'Tajar Varghese',   'Taj',     22),
  -- 3-team event players (9)
  ('player-r1-3t', 'threesome-test', 'r1', 'Ryan Red',    'Ryan',  10),
  ('player-r2-3t', 'threesome-test', 'r2', 'Rick Red',    'Rick',  14),
  ('player-r3-3t', 'threesome-test', 'r3', 'Rory Red',    'Rory',  8),
  ('player-g1-3t', 'threesome-test', 'g1', 'Greg Green',  'Greg',  12),
  ('player-g2-3t', 'threesome-test', 'g2', 'Gary Green',  'Gary',  15),
  ('player-g3-3t', 'threesome-test', 'g3', 'Grant Green', 'Grant', 9),
  ('player-b1-3t', 'threesome-test', 'b1', 'Blake Blue',  'Blake', 11),
  ('player-b2-3t', 'threesome-test', 'b2', 'Brett Blue',  'Brett', 13),
  ('player-b3-3t', 'threesome-test', 'b3', 'Brian Blue',  'Brian', 16);

-- ═══════════════════════════════════════════════════════════════
-- 7. TEAM ASSIGNMENTS (25 rows)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO team_assignments (event_id, team_id, user_id) VALUES
  -- BBMI 2025: Team Hammer
  ('bbmi-2025', 'team-a', 'brad'),
  ('bbmi-2025', 'team-a', 'zach'),
  ('bbmi-2025', 'team-a', 'tyler'),
  ('bbmi-2025', 'team-a', 'ben'),
  ('bbmi-2025', 'team-a', 'merling'),
  ('bbmi-2025', 'team-a', 'steve'),
  ('bbmi-2025', 'team-a', 'fach'),
  ('bbmi-2025', 'team-a', 'llama'),
  -- BBMI 2025: Team Anvil
  ('bbmi-2025', 'team-b', 'jd'),
  ('bbmi-2025', 'team-b', 'rob'),
  ('bbmi-2025', 'team-b', 'charlie'),
  ('bbmi-2025', 'team-b', 'bj'),
  ('bbmi-2025', 'team-b', 'jrob'),
  ('bbmi-2025', 'team-b', 'buddy'),
  ('bbmi-2025', 'team-b', 'frank'),
  ('bbmi-2025', 'team-b', 'taj'),
  -- 3-Team: Red
  ('threesome-test', 'team-red',   'r1'),
  ('threesome-test', 'team-red',   'r2'),
  ('threesome-test', 'team-red',   'r3'),
  -- 3-Team: Green
  ('threesome-test', 'team-green', 'g1'),
  ('threesome-test', 'team-green', 'g2'),
  ('threesome-test', 'team-green', 'g3'),
  -- 3-Team: Blue
  ('threesome-test', 'team-blue',  'b1'),
  ('threesome-test', 'team-blue',  'b2'),
  ('threesome-test', 'team-blue',  'b3');

-- ═══════════════════════════════════════════════════════════════
-- 8. PLAY GROUPS (regular + scramble)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO play_groups (id, event_id, name, tee_time, player_ids) VALUES
  -- BBMI 2025 regular groups (4-player foursomes)
  ('g1', 'bbmi-2025', 'Group 1', '8:00 AM', ARRAY['brad','merling','jd','jrob']),
  ('g2', 'bbmi-2025', 'Group 2', '8:12 AM', ARRAY['zach','steve','rob','buddy']),
  ('g3', 'bbmi-2025', 'Group 3', '8:24 AM', ARRAY['tyler','fach','charlie','frank']),
  ('g4', 'bbmi-2025', 'Group 4', '8:36 AM', ARRAY['ben','llama','bj','taj']),
  -- BBMI 2025 scramble groups (full teams)
  ('sg-hammer', 'bbmi-2025', 'Team Hammer', '8:00 AM', ARRAY['brad','zach','tyler','ben','merling','steve','fach','llama']),
  ('sg-anvil',  'bbmi-2025', 'Team Anvil',  '8:24 AM', ARRAY['jd','rob','charlie','bj','jrob','buddy','frank','taj']),
  -- 3-Team event groups (threesomes)
  ('tg1', 'threesome-test', 'Group 1', '8:00 AM', ARRAY['r1','g1','b1']),
  ('tg2', 'threesome-test', 'Group 2', '8:12 AM', ARRAY['r2','g2','b2']),
  ('tg3', 'threesome-test', 'Group 3', '8:24 AM', ARRAY['r3','g3','b3']);

-- ═══════════════════════════════════════════════════════════════
-- 9. ROUNDS (5 rounds across 2 events)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO rounds (id, event_id, day, title, course, format, status, points_available, modifiers) VALUES
  ('r1', 'bbmi-2025', 1, 'Scramble',   'Bandon Dunes',  'scramble',   'closed',    4, NULL),
  ('r2', 'bbmi-2025', 2, 'Stableford', 'Bandon Trails', 'stableford', 'submitted', 4, NULL),
  ('r3', 'bbmi-2025', 3, 'Sabotage',   'Pacific Dunes', 'sabotage',   'active',    4, '{"carryOver": true}'::jsonb),
  ('r4', 'bbmi-2025', 4, 'Skins',      'Old Macdonald', 'skins',      'upcoming',  4, '{"movingTees": {"enabled": true, "startBox": "white", "eagleShift": -2, "birdieShift": -1, "parShift": 0, "bogeyShift": 1, "doublePlusShift": 1}}'::jsonb),
  ('tr1', 'threesome-test', 1, 'Match Play', 'Pinehurst No. 2', 'match_play', 'active', 3, NULL);

-- ═══════════════════════════════════════════════════════════════
-- 10. SIDE EVENTS (4 for BBMI)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO side_events (id, event_id, name, icon, points_available, status, result) VALUES
  ('s1', 'bbmi-2025', 'Pool',           '🎱', 5, 'complete', '{"team-a": 2, "team-b": 3}'::jsonb),
  ('s2', 'bbmi-2025', 'Hammerschlagen', '🔨', 5, 'complete', '{"team-a": 3, "team-b": 2}'::jsonb),
  ('s3', 'bbmi-2025', 'Pick-Em',        '🏈', 5, 'complete', '{"team-a": 1, "team-b": 4}'::jsonb),
  ('s4', 'bbmi-2025', 'Cornhole',       '🌽', 5, 'upcoming', '{"team-a": 0, "team-b": 0}'::jsonb);

-- ═══════════════════════════════════════════════════════════════
-- 11. GROUP RESULTS + SCORES
-- ═══════════════════════════════════════════════════════════════

-- group_results (header rows)
INSERT INTO group_results (round_id, group_id, submitted_by, created_at, updated_at) VALUES
  ('r1', 'g1', 'brad',  '2025-03-11T17:00:00Z', '2025-03-11T17:00:00Z'),
  ('r1', 'g2', 'zach',  '2025-03-11T17:30:00Z', '2025-03-11T17:30:00Z'),
  ('r1', 'g3', 'tyler', '2025-03-11T18:00:00Z', '2025-03-11T18:00:00Z'),
  ('r1', 'g4', 'ben',   '2025-03-11T18:30:00Z', '2025-03-11T18:30:00Z'),
  ('r2', 'g1', 'jd',    '2025-03-12T16:30:00Z', '2025-03-12T16:30:00Z'),
  ('r2', 'g2', 'zach',  '2025-03-12T17:00:00Z', '2025-03-12T17:00:00Z'),
  ('r2', 'g3', 'tyler', '2025-03-12T17:30:00Z', '2025-03-12T17:30:00Z'),
  ('r2', 'g4', 'ben',   '2025-03-12T17:45:00Z', '2025-03-12T17:45:00Z');

-- group_result_scores (team points per group)
INSERT INTO group_result_scores (round_id, group_id, team_id, points) VALUES
  -- Round 1
  ('r1', 'g1', 'team-a', 1),   ('r1', 'g1', 'team-b', 0),
  ('r1', 'g2', 'team-a', 0.5), ('r1', 'g2', 'team-b', 0.5),
  ('r1', 'g3', 'team-a', 1),   ('r1', 'g3', 'team-b', 0),
  ('r1', 'g4', 'team-a', 0),   ('r1', 'g4', 'team-b', 1),
  -- Round 2
  ('r2', 'g1', 'team-a', 0),   ('r2', 'g1', 'team-b', 1),
  ('r2', 'g2', 'team-a', 0.5), ('r2', 'g2', 'team-b', 0.5),
  ('r2', 'g3', 'team-a', 1),   ('r2', 'g3', 'team-b', 0),
  ('r2', 'g4', 'team-a', 0),   ('r2', 'g4', 'team-b', 1);

-- ═══════════════════════════════════════════════════════════════
-- 12. PLAYER HOLE SCORES (18 holes × 4 players × 2 groups)
-- ═══════════════════════════════════════════════════════════════

-- Round 1, Group 1 (brad, merling, jd, jrob)
INSERT INTO player_hole_scores (round_id, group_id, hole_number, player_id, strokes) VALUES
  ('r1','g1',1,'brad',4),  ('r1','g1',1,'merling',5), ('r1','g1',1,'jd',4),  ('r1','g1',1,'jrob',4),
  ('r1','g1',2,'brad',5),  ('r1','g1',2,'merling',4), ('r1','g1',2,'jd',5),  ('r1','g1',2,'jrob',3),
  ('r1','g1',3,'brad',3),  ('r1','g1',3,'merling',3), ('r1','g1',3,'jd',4),  ('r1','g1',3,'jrob',3),
  ('r1','g1',4,'brad',4),  ('r1','g1',4,'merling',6), ('r1','g1',4,'jd',4),  ('r1','g1',4,'jrob',5),
  ('r1','g1',5,'brad',5),  ('r1','g1',5,'merling',5), ('r1','g1',5,'jd',6),  ('r1','g1',5,'jrob',4),
  ('r1','g1',6,'brad',3),  ('r1','g1',6,'merling',4), ('r1','g1',6,'jd',3),  ('r1','g1',6,'jrob',3),
  ('r1','g1',7,'brad',5),  ('r1','g1',7,'merling',4), ('r1','g1',7,'jd',4),  ('r1','g1',7,'jrob',5),
  ('r1','g1',8,'brad',4),  ('r1','g1',8,'merling',5), ('r1','g1',8,'jd',5),  ('r1','g1',8,'jrob',6),
  ('r1','g1',9,'brad',4),  ('r1','g1',9,'merling',5), ('r1','g1',9,'jd',3),  ('r1','g1',9,'jrob',4),
  ('r1','g1',10,'brad',5), ('r1','g1',10,'merling',4),('r1','g1',10,'jd',4), ('r1','g1',10,'jrob',5),
  ('r1','g1',11,'brad',2), ('r1','g1',11,'merling',3),('r1','g1',11,'jd',4), ('r1','g1',11,'jrob',3),
  ('r1','g1',12,'brad',5), ('r1','g1',12,'merling',6),('r1','g1',12,'jd',5), ('r1','g1',12,'jrob',5),
  ('r1','g1',13,'brad',4), ('r1','g1',13,'merling',4),('r1','g1',13,'jd',5), ('r1','g1',13,'jrob',4),
  ('r1','g1',14,'brad',6), ('r1','g1',14,'merling',5),('r1','g1',14,'jd',4), ('r1','g1',14,'jrob',4),
  ('r1','g1',15,'brad',3), ('r1','g1',15,'merling',3),('r1','g1',15,'jd',3), ('r1','g1',15,'jrob',4),
  ('r1','g1',16,'brad',5), ('r1','g1',16,'merling',4),('r1','g1',16,'jd',5), ('r1','g1',16,'jrob',5),
  ('r1','g1',17,'brad',4), ('r1','g1',17,'merling',5),('r1','g1',17,'jd',4), ('r1','g1',17,'jrob',3),
  ('r1','g1',18,'brad',5), ('r1','g1',18,'merling',4),('r1','g1',18,'jd',5), ('r1','g1',18,'jrob',4);

-- Round 2, Group 2 (zach, steve, rob, buddy)
INSERT INTO player_hole_scores (round_id, group_id, hole_number, player_id, strokes) VALUES
  ('r2','g2',1,'zach',4),  ('r2','g2',1,'steve',5), ('r2','g2',1,'rob',4),  ('r2','g2',1,'buddy',5),
  ('r2','g2',2,'zach',3),  ('r2','g2',2,'steve',4), ('r2','g2',2,'rob',5),  ('r2','g2',2,'buddy',4),
  ('r2','g2',3,'zach',3),  ('r2','g2',3,'steve',3), ('r2','g2',3,'rob',3),  ('r2','g2',3,'buddy',4),
  ('r2','g2',4,'zach',5),  ('r2','g2',4,'steve',4), ('r2','g2',4,'rob',4),  ('r2','g2',4,'buddy',6),
  ('r2','g2',5,'zach',5),  ('r2','g2',5,'steve',6), ('r2','g2',5,'rob',5),  ('r2','g2',5,'buddy',5),
  ('r2','g2',6,'zach',4),  ('r2','g2',6,'steve',3), ('r2','g2',6,'rob',3),  ('r2','g2',6,'buddy',3),
  ('r2','g2',7,'zach',4),  ('r2','g2',7,'steve',5), ('r2','g2',7,'rob',4),  ('r2','g2',7,'buddy',4),
  ('r2','g2',8,'zach',5),  ('r2','g2',8,'steve',5), ('r2','g2',8,'rob',6),  ('r2','g2',8,'buddy',5),
  ('r2','g2',9,'zach',4),  ('r2','g2',9,'steve',4), ('r2','g2',9,'rob',5),  ('r2','g2',9,'buddy',3),
  ('r2','g2',10,'zach',5), ('r2','g2',10,'steve',4),('r2','g2',10,'rob',4), ('r2','g2',10,'buddy',5),
  ('r2','g2',11,'zach',3), ('r2','g2',11,'steve',4),('r2','g2',11,'rob',3), ('r2','g2',11,'buddy',3),
  ('r2','g2',12,'zach',6), ('r2','g2',12,'steve',5),('r2','g2',12,'rob',5), ('r2','g2',12,'buddy',6),
  ('r2','g2',13,'zach',4), ('r2','g2',13,'steve',4),('r2','g2',13,'rob',4), ('r2','g2',13,'buddy',5),
  ('r2','g2',14,'zach',3), ('r2','g2',14,'steve',5),('r2','g2',14,'rob',4), ('r2','g2',14,'buddy',4),
  ('r2','g2',15,'zach',3), ('r2','g2',15,'steve',3),('r2','g2',15,'rob',4), ('r2','g2',15,'buddy',3),
  ('r2','g2',16,'zach',5), ('r2','g2',16,'steve',5),('r2','g2',16,'rob',5), ('r2','g2',16,'buddy',4),
  ('r2','g2',17,'zach',4), ('r2','g2',17,'steve',4),('r2','g2',17,'rob',5), ('r2','g2',17,'buddy',4),
  ('r2','g2',18,'zach',5), ('r2','g2',18,'steve',4),('r2','g2',18,'rob',4), ('r2','g2',18,'buddy',5);

-- ═══════════════════════════════════════════════════════════════
-- 13. TRIP MEMBERS
-- ═══════════════════════════════════════════════════════════════

INSERT INTO trip_members (trip_id, user_id, role, status, joined_at) VALUES
  -- trip-bbmi-live (16 players, all 'in')
  ('trip-bbmi-live', 'brad',    'Owner',   'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'zach',    'Planner', 'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'tyler',   'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'ben',     'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'merling', 'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'steve',   'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'fach',    'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'llama',   'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'jd',      'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'rob',     'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'charlie', 'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'bj',      'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'jrob',    'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'buddy',   'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'frank',   'Member',  'in', '2024-10-15T00:00:00Z'),
  ('trip-bbmi-live', 'taj',     'Member',  'in', '2024-10-15T00:00:00Z'),
  -- trip-bbmi (8 planning members, mixed statuses)
  ('trip-bbmi', 'brad',    'Owner',   'in',     '2025-10-01T00:00:00Z'),
  ('trip-bbmi', 'zach',    'Planner', 'in',     '2025-10-01T00:00:00Z'),
  ('trip-bbmi', 'jd',      'Planner', 'in',     '2025-10-03T00:00:00Z'),
  ('trip-bbmi', 'rob',     'Member',  'in',     '2025-10-10T00:00:00Z'),
  ('trip-bbmi', 'charlie', 'Member',  'likely', '2025-10-14T00:00:00Z'),
  ('trip-bbmi', 'tyler',   'Member',  'in',     '2025-10-10T00:00:00Z'),
  ('trip-bbmi', 'ben',     'Member',  'maybe',  '2025-11-05T00:00:00Z'),
  ('trip-bbmi', 'bj',      'Member',  'in',     '2025-10-12T00:00:00Z'),
  -- trip-new-deciding (3 planners)
  ('trip-new-deciding', 'brad', 'Owner',   'in', '2026-02-01T00:00:00Z'),
  ('trip-new-deciding', 'zach', 'Planner', 'in', '2026-02-01T00:00:00Z'),
  ('trip-new-deciding', 'jd',   'Planner', 'in', '2026-02-03T00:00:00Z'),
  -- trip-bbmi-2024 (8 members, completed trip)
  ('trip-bbmi-2024', 'brad',    'Owner',   'in', '2023-10-01T00:00:00Z'),
  ('trip-bbmi-2024', 'zach',    'Planner', 'in', '2023-10-01T00:00:00Z'),
  ('trip-bbmi-2024', 'jd',      'Planner', 'in', '2023-10-03T00:00:00Z'),
  ('trip-bbmi-2024', 'rob',     'Member',  'in', '2023-10-10T00:00:00Z'),
  ('trip-bbmi-2024', 'charlie', 'Member',  'in', '2023-10-14T00:00:00Z'),
  ('trip-bbmi-2024', 'tyler',   'Member',  'in', '2023-10-10T00:00:00Z'),
  ('trip-bbmi-2024', 'ben',     'Member',  'in', '2023-11-05T00:00:00Z'),
  ('trip-bbmi-2024', 'bj',      'Member',  'in', '2023-10-12T00:00:00Z'),
  -- trip-ryder-2023 (3 members, completed)
  ('trip-ryder-2023', 'brad', 'Owner',  'in', '2023-04-01T00:00:00Z'),
  ('trip-ryder-2023', 'rob',  'Member', 'in', '2023-04-05T00:00:00Z'),
  ('trip-ryder-2023', 'bj',   'Member', 'in', '2023-04-06T00:00:00Z'),
  -- trip-threesome (9 players)
  ('trip-threesome', 'r1', 'Owner',  'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'r2', 'Member', 'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'r3', 'Member', 'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'g1', 'Member', 'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'g2', 'Member', 'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'g3', 'Member', 'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'b1', 'Member', 'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'b2', 'Member', 'in', '2025-01-15T00:00:00Z'),
  ('trip-threesome', 'b3', 'Member', 'in', '2025-01-15T00:00:00Z');

-- ═══════════════════════════════════════════════════════════════
-- 14. IDEAS (3 ideas across 2 trips)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO ideas (id, trip_id, title, location, description, golf_courses, activities, cost_tier, pros, cons, image_url, accommodation, notes, archived, proposed_dates, created_at) VALUES
  (
    'idea-scottsdale', 'trip-bbmi',
    'Scottsdale Desert Escape', 'Scottsdale, AZ',
    '300 days of sunshine, saguaro cacti framing every shot, legendary nightlife.',
    ARRAY['TPC Scottsdale', 'We-Ko-Pa (Saguaro)', 'Troon North (Monument)'],
    ARRAY['Golf', 'Pool time', 'Old Town Scottsdale'],
    '$$$',
    ARRAY['300 days sun', 'World-class courses', 'Great nightlife'],
    ARRAY['Expensive', 'Long flights for east-coasters'],
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80',
    'Luxury rental home in North Scottsdale',
    'March is prime season.',
    false,
    '[{"start": "2026-03-09", "end": "2026-03-12"}]'::jsonb,
    '2025-12-01T00:00:00Z'
  ),
  (
    'idea-bandon', 'trip-bbmi',
    'Bandon Dunes Return', 'Bandon, OR',
    'The best golf in the US. Links-style, no carts, pure game.',
    ARRAY['Bandon Dunes', 'Pacific Dunes', 'Bandon Trails', 'Old Macdonald'],
    ARRAY['Golf', 'Whiskey tasting', 'Cards'],
    '$$$$',
    ARRAY['Best golf in USA', 'Legendary setting', 'Only thing to do is golf'],
    ARRAY['Very expensive', 'Remote', 'Weather unpredictable'],
    'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=600&q=80',
    'Lodge on-site',
    'Book 12+ months out.',
    false,
    '[{"start": "2026-03-09", "end": "2026-03-12"}]'::jsonb,
    '2025-12-05T00:00:00Z'
  ),
  (
    'idea-scottsdale-2027', 'trip-new-deciding',
    'Scottsdale Desert Escape', 'Scottsdale, AZ',
    '300 days of sunshine, world-class courses.',
    ARRAY['TPC Scottsdale', 'Troon North'],
    ARRAY['Golf', 'Pool'],
    '$$$',
    ARRAY['300 days sun', 'World-class courses'],
    ARRAY['Expensive', 'Long flights for east-coasters'],
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80',
    NULL, NULL, false, '[]'::jsonb,
    '2026-02-10T00:00:00Z'
  );

-- ═══════════════════════════════════════════════════════════════
-- 15. IDEA VOTES (6 votes)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO idea_votes (trip_id, idea_id, user_id, created_at) VALUES
  ('trip-bbmi', 'idea-scottsdale', 'brad',    '2026-01-20T09:15:00Z'),
  ('trip-bbmi', 'idea-scottsdale', 'zach',    '2026-01-22T14:30:00Z'),
  ('trip-bbmi', 'idea-bandon',     'jd',      '2026-01-21T11:00:00Z'),
  ('trip-bbmi', 'idea-bandon',     'rob',     '2026-01-25T18:45:00Z'),
  ('trip-bbmi', 'idea-scottsdale', 'tyler',   '2026-01-23T08:20:00Z'),
  ('trip-bbmi', 'idea-bandon',     'charlie', '2026-01-24T20:05:00Z');

-- ═══════════════════════════════════════════════════════════════
-- 16. IDEA COMMENTS (4 comments)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO idea_comments (id, trip_id, idea_id, user_id, text, created_at) VALUES
  ('ic-1', 'trip-bbmi', 'idea-scottsdale', 'brad',  'TPC Scottsdale is bucket list. We do this.',                        '2025-02-02T00:00:00Z'),
  ('ic-2', 'trip-bbmi', 'idea-scottsdale', 'tyler', 'We-Ko-Pa Saguaro is world class. +1 Scottsdale.',                   '2025-02-04T00:00:00Z'),
  ('ic-3', 'trip-bbmi', 'idea-bandon',     'jd',    E'We literally said we''d go back. Nothing compares.',               '2025-02-03T00:00:00Z'),
  ('ic-4', 'trip-bbmi', 'idea-bandon',     'rob',   E'Old Macdonald for the final round. That''s the one.',              '2025-02-05T00:00:00Z');

-- ═══════════════════════════════════════════════════════════════
-- 17. DATE POLLS + WINDOWS (trip-bbmi only)
-- locked_window_id FK deferred
-- ═══════════════════════════════════════════════════════════════

INSERT INTO date_polls (trip_id, open, locked_window_id) VALUES
  ('trip-bbmi',         false, 'dw-oct-2026'),
  ('trip-new-deciding', false, NULL);

INSERT INTO date_windows (id, trip_id, start_date, end_date) VALUES
  ('dw-mar-2026', 'trip-bbmi', '2026-03-09', '2026-03-12'),
  ('dw-oct-2026', 'trip-bbmi', '2026-10-05', '2026-10-08');

-- ═══════════════════════════════════════════════════════════════
-- 18. DATE POLL VOTES
-- Using datePoll.votes data (schema only supports 'yes'/'no')
-- ═══════════════════════════════════════════════════════════════

INSERT INTO date_poll_votes (window_id, user_id, answer, created_at) VALUES
  ('dw-mar-2026', 'brad',    'yes', '2026-02-05T10:00:00Z'),
  ('dw-mar-2026', 'zach',    'yes', '2026-02-06T09:30:00Z'),
  ('dw-mar-2026', 'jd',      'no',  '2026-02-07T14:15:00Z'),
  ('dw-mar-2026', 'tyler',   'yes', '2026-02-06T17:20:00Z'),
  ('dw-oct-2026', 'brad',    'yes', '2026-02-05T10:02:00Z'),
  ('dw-oct-2026', 'zach',    'yes', '2026-02-06T09:32:00Z'),
  ('dw-oct-2026', 'jd',      'yes', '2026-02-07T14:18:00Z'),
  ('dw-oct-2026', 'rob',     'yes', '2026-02-10T19:45:00Z'),
  ('dw-oct-2026', 'charlie', 'yes', '2026-02-11T08:55:00Z'),
  ('dw-oct-2026', 'tyler',   'yes', '2026-02-06T17:22:00Z');

-- ═══════════════════════════════════════════════════════════════
-- 19. RESERVATIONS (5 for trip-bbmi-live)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO reservations (id, trip_id, type, title, date, start_time, confirmation_number, cost, notes, created_at, updated_at) VALUES
  ('res-1', 'trip-bbmi-live', 'accommodation', 'Bandon Dunes Lodge',                '2025-03-11', '3:00 PM',  'BD-8821', 6400, '4 nights, 8 rooms.',              '2024-11-05T09:00:00Z', '2024-11-05T09:00:00Z'),
  ('res-2', 'trip-bbmi-live', 'tee-time',      'Bandon Dunes — Round 1 Scramble',   '2025-03-11', '8:00 AM',  'TT-1101', 1800, '4 groups of 4. Caddies included.', '2024-11-06T10:30:00Z', '2024-11-06T10:30:00Z'),
  ('res-3', 'trip-bbmi-live', 'tee-time',      'Bandon Trails — Round 2 Stableford','2025-03-12', '8:00 AM',  'TT-1102', 1800, '',                                 '2024-11-06T10:35:00Z', '2024-11-06T10:35:00Z'),
  ('res-4', 'trip-bbmi-live', 'tee-time',      'Pacific Dunes — Round 3 Sabotage',  '2025-03-13', '8:00 AM',  'TT-1103', 1800, 'Best course on property.',          '2024-11-06T10:40:00Z', '2024-11-06T10:40:00Z'),
  ('res-5', 'trip-bbmi-live', 'tee-time',      'Old Macdonald — Round 4 Skins',     '2025-03-14', '8:00 AM',  'TT-1104', 1600, 'Final round.',                      '2024-11-06T10:45:00Z', '2024-11-06T10:45:00Z');

-- ═══════════════════════════════════════════════════════════════
-- 20. EXPENSES + SPLITS
-- Each expense split equally among all 16 BBMI players
-- ═══════════════════════════════════════════════════════════════

INSERT INTO expenses (id, trip_id, title, amount, paid_by_user_id, created_at, updated_at) VALUES
  ('exp-1', 'trip-bbmi-live', 'Lodge & Rooms',        6400, 'brad', '2025-03-11T14:00:00Z', '2025-03-11T14:00:00Z'),
  ('exp-2', 'trip-bbmi-live', 'Round 1 Greens Fees',  1800, 'brad', '2025-03-11T19:30:00Z', '2025-03-11T19:30:00Z'),
  ('exp-3', 'trip-bbmi-live', 'Round 2 Greens Fees',  1800, 'jd',   '2025-03-12T20:00:00Z', '2025-03-12T20:00:00Z'),
  ('exp-4', 'trip-bbmi-live', 'Van Rental (airport)',   420, 'zach', '2025-03-11T10:15:00Z', '2025-03-11T10:15:00Z'),
  ('exp-5', 'trip-bbmi-live', 'Night 2 Bar Tab',        680, 'zach', '2025-03-12T23:45:00Z', '2025-03-12T23:45:00Z');

-- expense_splits: each expense split among all 16 players (amount NULL = equal split)
INSERT INTO expense_splits (expense_id, user_id) VALUES
  ('exp-1','brad'),('exp-1','zach'),('exp-1','tyler'),('exp-1','ben'),('exp-1','merling'),('exp-1','steve'),('exp-1','fach'),('exp-1','llama'),('exp-1','jd'),('exp-1','rob'),('exp-1','charlie'),('exp-1','bj'),('exp-1','jrob'),('exp-1','buddy'),('exp-1','frank'),('exp-1','taj'),
  ('exp-2','brad'),('exp-2','zach'),('exp-2','tyler'),('exp-2','ben'),('exp-2','merling'),('exp-2','steve'),('exp-2','fach'),('exp-2','llama'),('exp-2','jd'),('exp-2','rob'),('exp-2','charlie'),('exp-2','bj'),('exp-2','jrob'),('exp-2','buddy'),('exp-2','frank'),('exp-2','taj'),
  ('exp-3','brad'),('exp-3','zach'),('exp-3','tyler'),('exp-3','ben'),('exp-3','merling'),('exp-3','steve'),('exp-3','fach'),('exp-3','llama'),('exp-3','jd'),('exp-3','rob'),('exp-3','charlie'),('exp-3','bj'),('exp-3','jrob'),('exp-3','buddy'),('exp-3','frank'),('exp-3','taj'),
  ('exp-4','brad'),('exp-4','zach'),('exp-4','tyler'),('exp-4','ben'),('exp-4','merling'),('exp-4','steve'),('exp-4','fach'),('exp-4','llama'),('exp-4','jd'),('exp-4','rob'),('exp-4','charlie'),('exp-4','bj'),('exp-4','jrob'),('exp-4','buddy'),('exp-4','frank'),('exp-4','taj'),
  ('exp-5','brad'),('exp-5','zach'),('exp-5','tyler'),('exp-5','ben'),('exp-5','merling'),('exp-5','steve'),('exp-5','fach'),('exp-5','llama'),('exp-5','jd'),('exp-5','rob'),('exp-5','charlie'),('exp-5','bj'),('exp-5','jrob'),('exp-5','buddy'),('exp-5','frank'),('exp-5','taj');

-- ═══════════════════════════════════════════════════════════════
-- 21. MESSAGES
-- Trip channel messages + team channel messages
-- ═══════════════════════════════════════════════════════════════

INSERT INTO messages (id, trip_id, user_id, channel, team_id, text, created_at) VALUES
  -- trip-bbmi trip channel (BBMI 2026 planning)
  ('msg-1', 'trip-bbmi', 'brad',  'trip', NULL, E'Reminder \\u2014 everyone needs to book flights by end of month if we want reasonable prices.', '2026-01-15T10:23:00Z'),
  ('msg-2', 'trip-bbmi', 'jd',    'trip', NULL, 'Already on it. Found a decent deal out of Midway.', '2026-01-15T11:04:00Z'),
  ('msg-3', 'trip-bbmi', 'zach',  'trip', NULL, E'Who wants to share a rental car? I''ll organize if there''s interest.', '2026-01-16T08:45:00Z'),
  ('msg-4', 'trip-bbmi', 'tyler', 'trip', NULL, E'I''m in on the car. Arriving Thursday afternoon.', '2026-01-16T09:12:00Z'),
  -- trip-bbmi-live team-a (Hammer) channel
  ('tm-1', 'trip-bbmi-live', 'zach',  'team', 'team-a', E'Don''t tell Brad but I think we take them on Day 1 if we get the scramble format.', '2026-01-17T20:11:00Z'),
  ('tm-2', 'trip-bbmi-live', 'tyler', 'team', 'team-a', 'Agreed. Their team always falls apart on the back nine.', '2026-01-17T20:34:00Z'),
  ('tm-3', 'trip-bbmi-live', 'ben',   'team', 'team-a', E'I''m bringing my A game this year. No excuses.', '2026-01-18T07:02:00Z'),
  -- trip-bbmi-live team-b (Anvil) channel
  ('tm-4', 'trip-bbmi-live', 'jd',      'team', 'team-b', E'Hammer time. These guys have no idea what''s coming.', '2026-01-17T21:05:00Z'),
  ('tm-5', 'trip-bbmi-live', 'rob',     'team', 'team-b', E'JD you still owe me from last year. Let''s make it right on Day 1.', '2026-01-17T21:22:00Z'),
  ('tm-6', 'trip-bbmi-live', 'charlie', 'team', 'team-b', E'I watched film. Team Eagle has one weakness \\u2014 late-round pressure. We exploit that.', '2026-01-18T09:15:00Z'),
  -- trip-bbmi-2024 trip channel
  ('msg-2024-1', 'trip-bbmi-2024', 'brad', 'trip', NULL, E'That''s a wrap on BBMI 2024. Hammer wins. See everyone next year!', '2024-03-15T21:10:00Z'),
  ('msg-2024-2', 'trip-bbmi-2024', 'jd',   'trip', NULL, E'Couldn''t have scripted a better comeback. Old Mac delivered.', '2024-03-15T21:35:00Z'),
  ('msg-2024-3', 'trip-bbmi-2024', 'zach', 'trip', NULL, 'Next year we get you back. Mark it down.', '2024-03-15T22:01:00Z');

-- ═══════════════════════════════════════════════════════════════
-- 22. NOTIFICATION EVENTS + READS
-- ═══════════════════════════════════════════════════════════════

INSERT INTO notification_events (id, type, trip_id, actor_id, payload, created_at) VALUES
  ('notif-1', 'destination_locked', 'trip-bbmi-live', 'brad', '{"destination": "Bandon Dunes"}'::jsonb,                    '2024-08-20T11:00:00Z'),
  ('notif-2', 'score_submitted',    'trip-bbmi-live', 'brad', '{"roundTitle": "Day 1 – Four-Ball"}'::jsonb,                '2025-03-11T18:30:00Z'),
  ('notif-3', 'score_submitted',    'trip-bbmi-live', 'jd',   '{"roundTitle": "Day 2 – Alternate Shot"}'::jsonb,           '2025-03-12T17:45:00Z'),
  ('notif-4', 'dates_locked',       'trip-bbmi',      'brad', '{"dateRange": "Oct 5 – Oct 8, 2026"}'::jsonb,               '2026-02-20T14:00:00Z'),
  ('notif-5', 'chat_message',       'trip-bbmi',      'brad', '{"preview": "Reminder — everyone needs to book flights..."}'::jsonb, '2026-01-15T10:23:00Z');

-- notification_reads (some read, some not)
INSERT INTO notification_reads (notification_id, user_id, read_at) VALUES
  ('notif-1', 'zach', '2024-08-20T12:00:00Z'),
  ('notif-2', 'zach', '2025-03-11T19:00:00Z'),
  ('notif-3', 'zach', '2025-03-12T18:00:00Z');

COMMIT;
