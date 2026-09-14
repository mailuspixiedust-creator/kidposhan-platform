# KidPoshan Platform — Clean Build

This is the clean-slate KidPoshan program based on the approved UI direction:

- Home
- Meal Ideas decision engine
- Recipes catalogue
- Recipe detail
- Family Planner
- Learn
- Admin foundation
- D1 content model
- R2 media binding placeholder
- Payment gateway integration point

## Important architecture

Parent-facing HTML is presentation only. Recipes, ingredients, product records, scores, ratings, media references and planner data are returned by `/api/*` from D1. Recipe photos in the prototype are seed media files referenced by the database; production photos should be moved to R2 through Admin.

## New environment

This project intentionally uses a new Worker name (`kidposhan-platform`) and expects a new D1 database (`kidposhan-platform-db`) and R2 bucket (`kidposhan-platform-media`). Do not point it at the existing production `poshan-score` service.

## Step-by-step deployment

1. Create a new **private** GitHub repository, e.g. `kidposhan-platform`.
2. Put the contents of this folder into that repository and push to `main`.
3. In Cloudflare, create a new Worker named `kidposhan-platform` and connect it to the GitHub repository.
4. Create a new D1 database named `kidposhan-platform-db`; copy its database ID into `wrangler.toml`.
5. Create a new R2 bucket named `kidposhan-platform-media`.
6. Bind D1 as `DB`, R2 as `MEDIA`, and Static Assets as `ASSETS`.
7. Run `database/schema.sql` in the new D1 console.
8. Run `database/seed.sql` in the new D1 console.
9. Deploy and open the Worker `*.workers.dev` URL.
10. Test `/`, `/meal-ideas.html`, `/recipes.html?`, `/recipe.html?slug=aloo-tikki`, `/planner.html`, `/learn.html`.
11. Test `/admin.html` after creating a real admin account. The seed admin has no password and is only a placeholder for the database shape; do not use it in production.

## Payments

`/api/payments/create-order` is the integration point. For Razorpay/Stripe, store gateway secrets in Cloudflare Secrets, create orders server-side, verify webhook signatures in the Worker, and store only provider/payment IDs and status in D1. Do not store card numbers/CVV.
