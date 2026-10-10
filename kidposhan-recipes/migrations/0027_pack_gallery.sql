-- The product page's photo gallery, kept so the Products page can show the front of the pack and flip to the back (nutrition and ingredients).
ALTER TABLE kp_ready_products ADD COLUMN gallery_json TEXT;
