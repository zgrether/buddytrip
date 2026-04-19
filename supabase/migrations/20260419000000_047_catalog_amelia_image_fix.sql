-- Fix broken image_url on the `cat-amelia-island` catalog row. The original
-- seed shipped with a malformed Unsplash photo ID (11-char hash instead of 12),
-- so the <img> 404s. Swap to a working Florida-coast Unsplash photo.
UPDATE catalog_ideas
SET image_url = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80'
WHERE id = 'cat-amelia-island';
