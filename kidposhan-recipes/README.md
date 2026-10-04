# KidPoshan recipe pipeline

Fixes the "50 sources, 0 usable recipes" failure and adds the search + recipe-detail APIs.

## What changed vs recipe-catalogue-v2

| Old | New |
| --- | --- |
| One hard-coded Tavily query | Each source's own collection page is crawled (+ pagination), and Tavily runs per source domain with queries generated per occasion |
| Extractor accepted only Recipe JSON-LD | JSON-LD -> microdata -> WP Recipe Maker / Tasty HTML -> heading heuristic. Non-JSON-LD pages are kept as `partial` + `needs_review`, never silently dropped |
| Instagram/YouTube treated like websites | Marked `crawl_mode='manual'` (12 of the 50); captured by hand |
| Recipes went live automatically | Every recipe waits for the owner's Publish tick |
| Filters returned whatever matched | Diet + age are hard filters; season, then occasion, are relaxed in tiers until 10+ results. Each result says how it matched |

robots.txt is obeyed and each site is paced (10 s minimum, or its Crawl-delay); see src/recipes/polite.js.

Wording rule is kept: ingredient lines and steps are stored verbatim. Only quantity/unit/key are normalized.
Rights rule is kept separate: `recipe_sources.rights_status = 'granted'` is required before the method text or photo is shown on KidPoshan. Otherwise the recipe page shows ingredients + shopping and links to the source for the method.

## How new recipes keep coming in (v2)

1. **Every parent search** returns published recipes instantly, then (in the background, at most once a day per
   filter combination) searches your registered sites and the open web for that exact need.
2. **Well-known sites not in the registry** are saved as *suggested* sites. Pinterest, YouTube, Instagram,
   marketplaces and store sites are never suggested.
3. **Every 30 minutes** the cron re-checks the two least-recently-checked registered sites for new posts,
   so the whole registry is re-checked roughly daily.
4. Everything found is extracted and waits in **`/admin/review.html`**. Nothing reaches parents until you tick **Publish**.
   You can correct food type, age range, meals and seasons before publishing; your edits survive later re-crawls.
5. In **New sites** you either add a site to the registry or block it (blocking rejects its waiting recipes and stops searching it).

Protect `/admin/*` with Cloudflare Access (free for small teams) in addition to the token.

## Install (does not replace src/index.js)

1. Copy `src/recipes/` and `src/commerce/` into the repo.
2. Apply migrations 0006, 0007, 0008 (see DEPLOY.md for exact commands)
   (if `rights_status` / `crawl_mode` already exist, delete those two ALTER lines first).
3. `wrangler d1 execute <db> --remote --file seeds/recipe_sources_v4_additions.sql`
4. Secrets: `wrangler secret put ADMIN_TOKEN`, `wrangler secret put TAVILY_API_KEY`.
5. Add the 4 lines shown at the top of `src/recipes/routes.js` to the existing `fetch` handler (pass `ctx`, it runs background discovery).
   Put `public/admin/review.html` wherever your static pages are served.
6. Optional cron in wrangler.toml: `[triggers] crons = ["*/30 * * * *"]`.

## Fill the catalogue

```bash
H="x-admin-token: $ADMIN_TOKEN"; W=https://kidposhan-platform.mailus-pixiedust.workers.dev
# discover, 3 sources per call (stays under subrequest limits); repeat with next_offset
curl -X POST -H "$H" "$W/api/kp/admin/recipes/discover?offset=0&count=3"
# extract, 10 candidates per call (or let the cron drain it)
curl -X POST -H "$H" "$W/api/kp/admin/recipes/extract?limit=10"
# see which filter cells are thin
curl -H "$H" "$W/api/kp/admin/recipes/coverage"
```

## Use

```
GET /api/kp/recipes?age_months=48&season=monsoon&occasion=lunchbox&pref=veg
GET /api/kp/recipes/123
```
occasion: breakfast | lunchbox | lunch | snack_4pm | dinner. season: summer | monsoon | winter | all. pref: veg | jain | nonveg.
Veg includes Jain. Non-Veg includes egg, veg and Jain.

`coverage_gap: true` means fewer than 10 safe matches exist. Log these queries; they are the sourcing to-do list.

## Buy links

`src/commerce/buylinks.js` is the only place Buy URLs are built. Today it returns search deeplinks for
Blinkit, Instamart, Zepto, BigBasket and Amazon. When `/api/live-commerce` works, pass its offers as `liveOffers`
and product URLs replace searches. When Cuelinks is wired, fill `resolveAffiliate()`; the frontend does not change.
Verify the retailer search URL formats once from a phone browser; retailers change them occasionally.

## Tests

`npm test` (Node 22+, uses node:sqlite as a D1 stand-in).

## Frontend: public/meal-ideas.html

One mobile-first page with two views: the menu (filters -> photo carousels by match type) and the recipe page
(ingredients with At home / To buy, step-by-step method with tap-to-complete, ready-to-buy packs carousel, shopping-list tray).

- On kidposhan.in / workers.dev it calls `GET /api/kp/recipes`, `GET /api/kp/recipes/:id` and the existing `GET /api/products?q=`.
  Anywhere else (or with `?demo`) it uses placeholder recipes.
- Photos show only when the source granted rights (`image_url` is null otherwise); a drawn dish illustration is used instead.
- Steps show word for word when `method` is returned; otherwise a button opens the creator's page.
- Packs: maps `/api/products` fields defensively (brand, product_name, pack_size, kidposhan_score, image_url, offers[]).
  Offers use `affiliate_url` first, then `product_url`. Adjust `packsFor()` if your response differs.
