-- Demo schema for pg-admin. Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed.sql
-- The schema (search_path) is selected by the caller; default below uses "demo".

DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id         serial PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  name       text NOT NULL,
  role       text NOT NULL DEFAULT 'member',
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

INSERT INTO users (email, name, role) VALUES
  ('ada@example.com',   'Ada Lovelace', 'admin'),
  ('alan@example.com',  'Alan Turing',  'member'),
  ('grace@example.com', 'Grace Hopper', 'member');

INSERT INTO posts (author_id, title, body, published) VALUES
  (1, 'Notes on the Analytical Engine', 'It weaves algebraic patterns…', true),
  (1, 'Draft: On computable numbers',   'Work in progress.',             false),
  (2, 'Compilers and courage',          'The most dangerous phrase…',    true);

INSERT INTO comments (post_id, author_id, body) VALUES
  (1, 2, 'Brilliant as always.'),
  (1, 3, 'Looking forward to the next chapter.'),
  (2, 1, 'Thanks for the feedback!'),
  (3, 1, 'This changed how I think about code.'),
  (3, 2, 'Glad it resonated.');
