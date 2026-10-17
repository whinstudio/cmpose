CREATE TABLE users (id UUID PRIMARY KEY);

-- cmpose:sharing
CREATE TABLE placeholder (id UUID PRIMARY KEY);
-- /cmpose:sharing

CREATE TABLE items (
    id UUID PRIMARY KEY,
    -- cmpose:sharing-off: owner_id UUID NOT NULL REFERENCES users (id)
    space_id UUID NOT NULL
);
