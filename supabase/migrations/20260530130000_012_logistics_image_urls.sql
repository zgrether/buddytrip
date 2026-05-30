-- Multiple lodging photos.
--
-- AddPropertySheet now offers three square photo slots so a property can
-- carry a couple of images. They live in image_urls (an ordered jsonb
-- array of public Storage URLs); image_url stays in sync with the first
-- element as the "cover" the LodgingCard renders, so existing consumers
-- keep working without change.

alter table public.logistics_items
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

-- Backfill: existing single image_url becomes the first element.
update public.logistics_items
   set image_urls = jsonb_build_array(image_url)
 where image_url is not null
   and (image_urls is null or jsonb_array_length(image_urls) = 0);
