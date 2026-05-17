-- Fix broken image_url on the `cat-amelia-island` catalog row. The original
-- seed shipped with a malformed Unsplash photo ID (11-char hash instead of 12),
-- so the <img> 404s. Swap to a working Florida-coast Unsplash photo.
UPDATE catalog_ideas
SET image_url = 'https://images.unsplash.com/photo-1468413253725-0d5181091126?auto=format&fit=crop&w=800&q=80'
WHERE id = 'cat-amelia-island';
