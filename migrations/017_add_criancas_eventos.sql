-- Add children count to eventos
-- Required for PER_CHILD staff calculation

ALTER TABLE eventos
ADD COLUMN criancas INTEGER DEFAULT 0;
