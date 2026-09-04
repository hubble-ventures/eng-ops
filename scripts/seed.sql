-- Demo schema for eng-ops. Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed.sql
-- The schema (search_path) is selected by the caller; default below uses "demo".

DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS membership_notes CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS post_tags CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id         serial PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  name       text NOT NULL,
  role       text NOT NULL DEFAULT 'member',
  -- Self-reference: merging along it can leave a row as its own manager, which
  -- the merge engine refuses rather than quietly creating.
  manager_id integer REFERENCES users(id) ON DELETE SET NULL,
  -- Soft delete: the merge engine stamps this instead of deleting the row it
  -- merges away. Tables without such a column get a hard delete.
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id         serial PRIMARY KEY,
  author_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  published  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comments (
  id         serial PRIMARY KEY,
  post_id    integer NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  integer REFERENCES users(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tags exist to exercise a merge on a table with *no* soft-delete column (the
-- row is deleted outright) whose join table has a composite primary key.
CREATE TABLE tags (
  id    serial PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  label text NOT NULL
);

CREATE TABLE post_tags (
  post_id integer NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  integer NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE teams (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

-- One membership per user per team: the unique scope in which a keeper and a
-- loser can each hold a row, and only one may survive.
CREATE TABLE memberships (
  id         serial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, team_id)
);

-- Hangs off a membership with ON DELETE CASCADE. Dropping a membership that
-- looks like a redundant duplicate would silently take these with it, which is
-- why a duplicate with dependents is a conflict rather than a duplicate.
CREATE TABLE membership_notes (
  id            serial PRIMARY KEY,
  membership_id integer NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  note          text NOT NULL
);

CREATE TABLE api_keys (
  id      serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label   text NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

-- Partial unique index: only *live* keys share a label scope. Revoked rows sit
-- outside the rule and must not be treated as colliding.
CREATE UNIQUE INDEX api_keys_live_label ON api_keys (user_id, label)
  WHERE NOT revoked;

-- Polymorphic owner: owner_id holds a user id or a team id depending on
-- owner_type, so a foreign key cannot exist and pg_catalog cannot see the edge.
-- Declare it in engops.config.json to have the merge cover it:
--   "tables": { "public.users": { "merge": { "extraEdges": [
--     { "table": "public.audit_log", "column": "owner_id",
--       "guard": "owner_type = 'user'" } ] } } }
CREATE TABLE audit_log (
  id         serial PRIMARY KEY,
  owner_type text NOT NULL,
  owner_id   integer NOT NULL,
  action     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Data. Users 4-7 exist to exercise the merge engine; see the map at the end.
-- ---------------------------------------------------------------------------

INSERT INTO users (id, email, name, role) VALUES
  (1, 'ada@example.com',       'Ada Lovelace',        'admin'),
  (2, 'alan@example.com',      'Alan Turing',         'member'),
  (3, 'grace@example.com',     'Grace Hopper',        'member'),
  (4, 'ada.old@example.com',   'Ada Lovelace (old)',  'member'),
  (5, 'kay@example.com',       'Kay McNulty',         'member'),
  (6, 'betty@example.com',     'Betty Holberton',     'member'),
  (7, 'g.hopper@example.com',  'G. Hopper (old)',     'member');
SELECT setval('users_id_seq', 7);

-- Grace's manager is her own older duplicate: merging 7 into 3 would leave
-- Grace managed by herself, so the engine blocks it.
UPDATE users SET manager_id = 7 WHERE id = 3;

INSERT INTO posts (id, author_id, title, body, published) VALUES
  (1, 1, 'Notes on the Analytical Engine', 'It weaves algebraic patterns…', true),
  (2, 1, 'Draft: On computable numbers',   'Work in progress.',             false),
  (3, 2, 'Compilers and courage',          'The most dangerous phrase…',    true),
  (4, 4, 'Bernoulli numbers, revisited',   'From the older account.',       true);
SELECT setval('posts_id_seq', 4);

INSERT INTO comments (id, post_id, author_id, body) VALUES
  (1, 1, 2, 'Brilliant as always.'),
  (2, 1, 3, 'Looking forward to the next chapter.'),
  (3, 2, 1, 'Thanks for the feedback!'),
  (4, 3, 1, 'This changed how I think about code.'),
  (5, 3, 2, 'Glad it resonated.'),
  (6, 4, 4, 'Posted from the older account.');
SELECT setval('comments_id_seq', 6);

INSERT INTO tags (id, slug, label) VALUES
  (1, 'history',      'History'),
  (2, 'compilers',    'Compilers'),
  (3, 'history-dupe', 'History');
SELECT setval('tags_id_seq', 3);

-- Tag 3 duplicates tag 1 on post 1 (identical by construction — every column of
-- post_tags is part of its primary key) and adds post 4 on its own.
INSERT INTO post_tags (post_id, tag_id) VALUES (1, 1), (3, 2), (1, 3), (4, 3);

INSERT INTO teams (id, name) VALUES
  (1, 'Platform'), (2, 'Design'), (3, 'Research');
SELECT setval('teams_id_seq', 3);

INSERT INTO memberships (id, user_id, team_id, role) VALUES
  -- 4 → 1: same fact stated twice. The loser's copy is dropped, not blocked.
  (1, 1, 1, 'member'),
  (2, 4, 1, 'member'),
  -- 5 → 2: same scope, different role. A genuine conflict; blocks the merge.
  (3, 2, 2, 'member'),
  (4, 5, 2, 'lead'),
  -- 6 → 3: identical rows, but the loser's copy is load-bearing (below).
  (5, 3, 3, 'member'),
  (6, 6, 3, 'member');
SELECT setval('memberships_id_seq', 6);

-- Attached to membership 6 — Betty's Research row. Deleting that row as a
-- "duplicate" would cascade this away without a word, so the merge refuses.
INSERT INTO membership_notes (membership_id, note) VALUES
  (6, 'Chairs the Tuesday review. Do not lose this.');

INSERT INTO api_keys (id, user_id, label, revoked) VALUES
  -- Live 'ci' on both sides of the 4 → 1 merge: a duplicate under the partial
  -- unique index.
  (1, 1, 'ci',      false),
  (2, 4, 'ci',      false),
  -- Revoked, so outside the index's predicate: it moves rather than colliding.
  (3, 4, 'ci',      true),
  (4, 2, 'laptop',  false);
SELECT setval('api_keys_id_seq', 4);

INSERT INTO audit_log (owner_type, owner_id, action) VALUES
  ('user', 4, 'signed in'),
  ('user', 4, 'rotated api key'),
  ('user', 1, 'signed in'),
  -- Same id, different owner kind: the guard must keep this one put.
  ('team', 4, 'renamed');

-- ---------------------------------------------------------------------------
-- Merge fixtures, by scenario:
--
--   4 → 1  succeeds. Drops an identical memberships row and an identical live
--          api_keys row (partial index), moves posts, comments, the revoked
--          key, and — only if the extra edge is declared in config — the two
--          'user'-owned audit_log rows. Retires user 4 by stamping deleted_at.
--   5 → 2  blocks: both hold a Design membership and disagree on `role`.
--   6 → 3  blocks: both hold an identical Research membership, but the loser's
--          copy still has a membership_notes row that dropping it would cascade
--          away.
--   7 → 3  blocks: user 3's manager_id is 7, so the merge would leave Grace
--          managing herself.
--   3 → 1  (tags) deletes outright — tags has no soft-delete column — after
--          dropping the duplicate post_tags row for post 1 and moving post 4's.
-- ---------------------------------------------------------------------------
