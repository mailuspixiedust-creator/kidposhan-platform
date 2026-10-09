# KidPoshan recipe system: step-by-step go-live

Replace `<DB>` with the D1 database name in your `wrangler.toml` (the `database_name` under `[[d1_databases]]`).
Run commands from your repo folder.

## Part A. Prepare (about 15 min)

1. **Back up.** Commit the current working `src/index.js` to GitHub on a new branch, e.g. `git checkout -b recipes`.
   Export the database: `npx wrangler d1 export <DB> --remote --output backup-before-recipes.sql`
2. **Check the source table's columns:**
   `npx wrangler d1 execute <DB> --remote --command "PRAGMA table_info(recipe_sources)"`
   The code expects `id, name, platform, region, area, url, notes, active`. If a name differs (e.g. `source_url`), tell me and I'll adjust, or rename in the SQL files.
   If `rights_status` or `crawl_mode` already exist, delete those two `ALTER` lines from `0006_recipes.sql`.
3. **Get a Tavily API key** at tavily.com (Settings > API keys). Check the plan's monthly search allowance.
4. **Pick an admin token**, a long random password, e.g. from a password manager. You'll type it into the review screen.

## Part B. Database (5 min)

5. Run the files in this order:
   ```
   npx wrangler d1 execute <DB> --remote --file migrations/0006_recipes.sql
   npx wrangler d1 execute <DB> --remote --file migrations/0007_review_and_live_discovery.sql
   npx wrangler d1 execute <DB> --remote --file migrations/0008_polite_crawling.sql
   npx wrangler d1 execute <DB> --remote --file migrations/0009_site_management.sql
   npx wrangler d1 execute <DB> --remote --file seeds/recipe_sources_v4_additions.sql
   ```
   (If you use `wrangler d1 migrations apply` instead, copy the four migration files into your migrations folder and renumber them after your existing ones.)

## Part C. Code (15 min)

6. Copy `src/recipes/` and `src/commerce/` into your repo's `src/`.
7. Open your working `src/index.js` and add, without changing anything else:
   ```js
   import { routeRecipes, scheduledRecipes } from './recipes/routes.js';
   ```
   At the very top of your existing `fetch(request, env, ctx)` handler:
   ```js
   const recipeRes = await routeRecipes(request, env, ctx);
   if (recipeRes) return recipeRes;
   ```
   And next to `fetch`, inside `export default { ... }`:
   ```js
   async scheduled(event, env, ctx) { ctx.waitUntil(scheduledRecipes(env)); },
   ```
   If your handler is named differently or doesn't receive `ctx`, add `ctx` as the third parameter.
8. In `wrangler.toml` add the 30-minute job:
   ```toml
   [triggers]
   crons = ["*/30 * * * *"]
   ```
9. Add the secrets (each command asks you to paste the value):
   ```
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put TAVILY_API_KEY
   ```
10. Put the three pages where your site's static pages live:
    `public/meal-ideas.html`, `public/admin/review.html`, `public/bot.html` (must open at **kidposhan.in/bot**, the crawler's ID points there).
    In `bot.html`, replace `hello@kidposhan.in` with your real contact address.

## Part D. Deploy safely (10 min)

11. **Dry run first** (catches the "Unexpected export" kind of error before Cloudflare sees it):
    `npx wrangler deploy --dry-run --outdir dist`
12. If it builds cleanly: `npx wrangler deploy`
13. **Protect the review screen:** Cloudflare dashboard > Zero Trust > Access > Applications > Add > Self-hosted,
    domain `kidposhan.in`, path `admin/*`, policy "Emails: your address". (Free for small teams.) The token stays as a second lock.

## Part E. First run, by hand (20 min)

14. Set two shell variables:
    ```
    W=https://kidposhan-platform.mailus-pixiedust.workers.dev
    H="x-admin-token: <your ADMIN_TOKEN>"
    ```
15. Find recipe pages from one source (no Tavily, to keep it cheap):
    `curl -X POST -H "$H" "$W/api/kp/admin/recipes/discover?source_id=1&tavily=0"`
    You should see `"found": <number>`. If you see `robots.txt disallows`, that site doesn't allow readers; try another id.
16. Read 10 of them: `curl -X POST -H "$H" "$W/api/kp/admin/recipes/extract?limit=10"`
    Statuses: `extracted` (good), `partial` (read without a recipe card), `later` (pacing, will run next time), `robots_blocked`, `not_recipe`, `error`.
17. Open `kidposhan.in/admin/review.html`, enter the token, and check the recipes. Fix tags where needed and **Publish** 3 or 4.
18. Open `kidposhan.in/meal-ideas.html` on your phone, search a matching filter, and open a published recipe.
19. Repeat 15 and 16 for a few more sources (`offset=0&count=3`, then the `next_offset` it returns), or simply let the 30-minute job work through them.

## Part F. Ongoing (weekly, 20-30 min)

20. Clear the **Waiting** tab. Searches from parents pull in new finds there every day.
21. Open the **Sites** tab. Under **New**, add good sites to the registry or block poor ones. Pause any site whose finds you keep rejecting.
22. Look at `curl -H "$H" "$W/api/kp/admin/recipes/coverage"`: `thin_searches` lists filter combinations with few published recipes; prioritise those when reviewing.
23. **Permissions:** email creators whose recipes you publish often and set their site to **Asked** in the Sites tab, with a note.
    When one agrees, set it to **Granted**. From then on their steps and photos appear on KidPoshan; until then parents get a link to their page.

## If something goes wrong

- Deploy fails: `git checkout main && npx wrangler deploy` restores the previous Worker; the new tables don't affect it.
- Bad data: restore with `npx wrangler d1 execute <DB> --remote --file backup-before-recipes.sql` (on a fresh database) or delete rows from the new tables only.
- Nothing extracted: check `candidates` counts in the coverage output; many `robots_blocked` or `error` from one site means it blocks readers, so block that site in the review screen.
