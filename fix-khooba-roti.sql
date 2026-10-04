UPDATE recipes
SET
  slug = 'rajasthani-khooba-roti-recipe',
  description = 'Whole wheat thick flatbread pinched artistically while on tawa',
  score = 0,
  age_min = NULL,
  age_max = NULL,
  meal_moment = NULL,
  season = NULL,
  diet = 'Veg',
  prep_minutes = 20,
  difficulty = NULL,
  ingredients_json = '[{"source_text": "1 cup Whole Wheat Flour ", "name": "Whole Wheat Flour", "quantity": 1, "unit": "cup", "quantitative": true}, {"source_text": " Salt to taste", "name": "Salt", "quantity": null, "unit": null, "quantitative": false}, {"source_text": " Water as required", "name": "Water", "quantity": null, "unit": null, "quantitative": false}, {"source_text": " Ghee as required", "name": "Ghee", "quantity": null, "unit": null, "quantitative": false}]',
  method_json = '[{"title": "Step 1", "text": "To begin with, Rajasthani Khooba Roti first, in a large mixing bowl, add flour, salt, and water, Mix together with your hands to form crumbs."}, {"title": "Step 2", "text": "Add water to combine it well and make a smooth and yet stiff dough."}, {"title": "Step 3", "text": "Leave the dough aside for 15 minutes so it rests."}, {"title": "Step 4", "text": "Pinch a large lemon sized ball from the dough and roll it to make a ball. Dust the counter well and roll out the dough ball to make a thick round roti."}, {"title": "Step 5", "text": "Spread a little ghee on one side of the roti and place that side on the tawa. After 20 seconds, flip the roti and start pinching on the top of the roti."}, {"title": "Step 6", "text": "Keep pinching till the full roti is covered. Flip the roti and again roast from the patterned side."}, {"title": "Step 7", "text": "Once both sides are lightly browned hold the roti with a tong, remove it fromtawaand place it directly on flames."}, {"title": "Step 8", "text": "Flip and roast from both the sides till its evenly cooked from both the sides."}, {"title": "Step 9", "text": "Once done, switch off the stove and pour ghee on the roti and serve."}, {"title": "Step 10", "text": "Your Rajasthani Khooba Roti is ready to be served with Makai Wali Bhindi or Pyaz ki sabzi.."}]',
  nutrition_json = '{}',
  benefits_json = '[]',
  serve_with_json = '[]',
  tags_json = '["Vegetarian Recipes", "Indian Lunch Recipes", "Office Lunch Box Recipes", "Weekend Dinner Ideas", "Rajasthani Recipes"]',
  status = 'published',
  updated_at = CAST(strftime('%s','now') AS INTEGER)
WHERE id = 'archana-rajasthani-khooba-roti';

SELECT id,name,meal_moment,season,diet,prep_minutes,difficulty,score
FROM recipes
WHERE id = 'archana-rajasthani-khooba-roti';
