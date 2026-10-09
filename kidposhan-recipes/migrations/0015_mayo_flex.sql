-- KidPoshan: recipes that use mayonnaise as an ingredient can be made either way.
-- They keep their normal diet tag (veg / jain) and are shown in BOTH the Veg and the Non-veg search.
-- On the recipe page the mayonnaise reads "Eggless mayonnaise" when the parent chose Veg (or Jain) and "Mayonnaise" for Non-veg.
ALTER TABLE kp_recipes ADD COLUMN mayo_flex INTEGER NOT NULL DEFAULT 0;
