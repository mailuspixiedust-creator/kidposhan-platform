-- Which website sent the visitor (only the site's name, like google.com: never the address of the page or any search words).
ALTER TABLE kp_pageviews ADD COLUMN ref TEXT;
