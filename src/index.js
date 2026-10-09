import { researchProducts } from './product-intelligence.js';
import { researchIngredientOffers } from './ingredient-intelligence.js';
import { searchWeb } from './web-search.js';
import { runWebDiscovery } from './discovery.js';
import { buildRecipeCatalogue, rankCatalogue } from './recipe-catalogue-v2.js';
import { routeRecipes, scheduledRecipes } from './recipes/routes.js';
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8', ...headers}});
const bad = (msg, status=400) => json({error:msg}, status);
const now = () => Math.floor(Date.now()/1000);
const uid = (p='id') => p + '-' + crypto.randomUUID();

async function getSessionUser(request, env){
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/kp_session=([^;]+)/);
  if(!m || !env.DB) return null;
  return await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?`).bind(m[1], now()).first();
}
const esc = (v)=>v ?? '';
function parseJSON(v, fallback){ try{return v?JSON.parse(v):fallback}catch{return fallback} }
function recipeOut(r){return {...r,imageUrl:r.image_url,ingredients:parseJSON(r.ingredients_json,[]),method:parseJSON(r.method_json,[]),nutrition:parseJSON(r.nutrition_json,{}),benefits:parseJSON(r.benefits_json,[]),serveWith:parseJSON(r.serve_with_json,[]),tags:parseJSON(r.tags_json,[]),image_media_id:r.image_media_id};}


async function persistDiscoveredRecipe(env, candidate, filters = {}) {
  const ts = now();
  const sourceRecipeUrl = candidate.source_recipe_url || candidate.source_url || '';
  if (!candidate.name || !sourceRecipeUrl) return null;

  const slug = String(candidate.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `recipe-${crypto.randomUUID()}`;

  const id = uid('recipe');
  const ingredients = candidate.ingredients || [];
  const method = Array.isArray(candidate.raw_recipe?.recipeInstructions)
    ? candidate.raw_recipe.recipeInstructions.map(x =>
        typeof x === 'string' ? x : String(x?.text || '')
      ).filter(Boolean)
    : [];

  const diet = candidate.raw_recipe?.suitableForDiet
    ? (String(candidate.raw_recipe.suitableForDiet).toLowerCase().includes('vegetarian') ? 'Veg' : 'Non-Veg')
    : 'Veg';

  const score = Number.isFinite(Number(candidate.poshan_score))
    ? Number(candidate.poshan_score)
    : 0;

  const requestedAge = String(filters.age || '').match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  const ageMin = Number.isFinite(Number(candidate.age_min)) ? Number(candidate.age_min) : (requestedAge ? Number(requestedAge[1]) : null);
  const ageMax = Number.isFinite(Number(candidate.age_max)) ? Number(candidate.age_max) : (requestedAge ? Number(requestedAge[2]) : null);
  const mealMoment = candidate.meal_moment || candidate.meal_type || filters.meal || null;
  const seasonValue = candidate.season || filters.season || 'All Seasons';
  const dietValue = candidate.raw_recipe?.suitableForDiet
    ? (String(candidate.raw_recipe.suitableForDiet).toLowerCase().includes('vegetarian') ? 'Veg' : 'Non-Veg')
    : (candidate.diet || (filters.diet && filters.diet !== 'All' ? filters.diet : 'Veg'));

  // Avoid duplicate source recipes.
  const existing = await env.DB.prepare(`
    SELECT id FROM recipes
    WHERE source_url=? OR source_recipe_id=?
    LIMIT 1
  `).bind(sourceRecipeUrl, sourceRecipeUrl).first();

  if (existing?.id) {
    await env.DB.prepare(`
      UPDATE recipes
      SET age_min=?, age_max=?, meal_moment=?, season=?, diet=?, updated_at=?
      WHERE id=?
    `).bind(
      ageMin, ageMax, mealMoment, seasonValue, dietValue, ts, existing.id
    ).run();
    return existing.id;
  }

  await env.DB.prepare(`
    INSERT INTO recipes (
      id, slug, name, description, image_media_id, score,
      age_min, age_max, meal_moment, season, diet, prep_minutes,
      difficulty, ingredients_json, method_json, nutrition_json,
      benefits_json, serve_with_json, tags_json, status,
      created_at, updated_at, source_id, source_recipe_id,
      creator_name, creator_type, region, state_or_area, cuisine,
      source_url, attribution_text, rights_status
    )
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published',
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    slug,
    candidate.name,
    candidate.description || '',
    score,
    ageMin,
    ageMax,
    mealMoment,
    seasonValue,
    dietValue,
    candidate.prep_minutes || null,
    'Easy',
    JSON.stringify(ingredients),
    JSON.stringify(method),
    JSON.stringify(candidate.nutrition || {}),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    ts,
    ts,
    candidate.source_id || null,
    sourceRecipeUrl,
    candidate.raw_recipe?.author?.name || candidate.raw_recipe?.author || null,
    candidate.creator_type || null,
    candidate.region || 'Pan-India',
    candidate.state_or_area || null,
    candidate.raw_recipe?.recipeCuisine || null,
    sourceRecipeUrl,
    candidate.raw_recipe?.author?.name
      ? `Recipe by ${candidate.raw_recipe.author.name}`
      : null,
    'source_page'
  ).run();

  return id;
}

async function searchRecipesOnline(env, filters) {
  if (!env.TAVILY_API_KEY) {
    return {
      web_search_performed: false,
      reason: 'TAVILY_API_KEY is not configured.',
      recipes: []
    };
  }

  const catalogue = await buildRecipeCatalogue(env, {
    query: filters.q,
    age: filters.age,
    meal: filters.meal,
    season: filters.season,
    diet: filters.diet,
    region: filters.region,
    useSearchFallback: true,
    limitPerSource: 5
  });

  const ranked = rankCatalogue(
    catalogue.candidates || [],
    Math.min(Math.max(Number(filters.limit || 10), 1), 10)
  );

  const persisted = [];
  for (const candidate of ranked) {
    try {
      const id = await persistDiscoveredRecipe(env, candidate, filters);
      if (id) persisted.push(id);
    } catch {
      // One bad candidate must not break the entire search.
    }
  }

  return {
    web_search_performed: true,
    source_count: catalogue.source_count,
    sources_considered: catalogue.sources_considered,
    discovery_errors: catalogue.errors || [],
    recipes: ranked,
    persisted_recipe_ids: persisted
  };
}

async function seedIfNeeded(env){
  // Intentionally no automatic schema mutation in production. Run schema.sql/seed.sql once in D1.
}

async function api(request, env){
  const url = new URL(request.url);
  const p=url.pathname;
  if(!env.DB) return bad('Database binding is not configured.',500);
  if(p==='/api/health') return json({ok:true,db:true});

  // Recipe Extraction Companion test endpoint.
  // Accepts source text and uses Workers AI for structured extraction.
  // This endpoint does not write anything to D1.
  if(p==='/api/ai-test' && request.method==='POST'){
    const body=await request.json();

    const result=await env.AI.run('@cf/openai/gpt-oss-20b', {
      messages:[
        {
          role:'system',
          content:`Extract the recipe information from the supplied text.

Rules:
- Extract only information explicitly present in the source.
- Never invent quantities, nutrition, ages, ingredients or instructions.
- Preserve "to taste", "as needed", etc. exactly.
- Return only the requested JSON structure.`
        },
        {
          role:'user',
          content:String(body.text||'')
        }
      ],
      response_format:{
        type:'json_schema',
        json_schema:{
          name:'recipe_extraction',
          schema:{
            type:'object',
            additionalProperties:false,
            properties:{
              name:{type:'string'},
              ingredients:{
                type:'array',
                items:{
                  type:'object',
                  additionalProperties:false,
                  properties:{
                    name:{type:'string'},
                    quantity:{type:['string','null']},
                    unit:{type:['string','null']},
                    quantitative:{type:'boolean'}
                  },
                  required:['name','quantity','unit','quantitative']
                }
              },
              instructions:{
                type:'array',
                items:{type:'string'}
              },
              age_min:{type:['number','null']},
              age_max:{type:['number','null']},
              age_confidence:{type:'string'},
              nutrition:{type:'object'},
              missing_fields:{
                type:'array',
                items:{type:'string'}
              }
            },
            required:[
              'name',
              'ingredients',
              'instructions',
              'age_min',
              'age_max',
              'age_confidence',
              'nutrition',
              'missing_fields'
            ]
          }
        }
      },
      max_tokens:1000,
      temperature:0
    });

    return json({
      ok:true,
      result
    });
  }

  if(p==='/api/auth/login' && request.method==='POST'){
    const body=await request.json();
    const identifier=String(body.identifier||'').trim();
    const password=String(body.password||'');
    const user=await env.DB.prepare(`SELECT id,email,mobile,name,password_hash,password_salt,password_iterations,role FROM users WHERE lower(email)=lower(?) OR mobile=? LIMIT 1`).bind(identifier,identifier.replace(/\D/g,'')).first();
    if(!user) return bad('Account not found.',401);
    // Demo user has no password hash; real accounts are expected to use PBKDF2.
    if(user.password_hash && user.password_salt){
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
      const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(atob(user.password_salt),c=>c.charCodeAt(0)),iterations:user.password_iterations||100000,hash:'SHA-256'},key,256);
      const got=btoa(String.fromCharCode(...new Uint8Array(bits)));
      if(got!==user.password_hash) return bad('Email/mobile or password is incorrect.',401);
    }
    const sid=uid('sess'); await env.DB.prepare(`INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)`).bind(sid,user.id,now()+60*60*24*30).run();
    return json({user:{id:user.id,email:user.email,mobile:user.mobile,name:user.name,role:user.role}},200,{'Set-Cookie':`kp_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`});
  }
  if(p==='/api/auth/me'){
    const u=await getSessionUser(request,env); return json({user:u?{id:u.id,email:u.email,mobile:u.mobile,name:u.name,role:u.role}:null});
  }
  if(p==='/api/auth/logout' && request.method==='POST') return json({ok:true},200,{'Set-Cookie':'kp_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'});

  if(p==='/api/recipes' && request.method==='GET'){
    const q=(url.searchParams.get('q')||'').trim();
    const diet=url.searchParams.get('diet')||'';
    const season=url.searchParams.get('season')||'';
    const meal=url.searchParams.get('meal') || url.searchParams.get('meal_type') || '';
    const age=url.searchParams.get('age') || (url.searchParams.get('min_age') && url.searchParams.get('max_age') ? `${url.searchParams.get('min_age')}-${url.searchParams.get('max_age')}` : '');
    const region=url.searchParams.get('region')||'';
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||10),1),10);

    let sql=`SELECT r.*,m.url AS image_url
      FROM recipes r
      LEFT JOIN media_assets m ON m.id=r.image_media_id
      WHERE r.status='published'`;
    const args=[];

    if(q){
      sql+=` AND (lower(r.name) LIKE ? OR lower(r.description) LIKE ? OR lower(COALESCE(r.ingredients_json,'')) LIKE ?)`;
      const needle='%'+q.toLowerCase()+'%';
      args.push(needle,needle,needle);
    }
    if(diet && diet!=='All') {sql+=` AND r.diet=?`; args.push(diet);}
    if(season && season!=='All Seasons') {
      sql+=` AND (r.season=? OR r.season='All Seasons' OR r.season IS NULL)`;
      args.push(season);
    }
    if(meal) {sql+=` AND (r.meal_moment=? OR r.meal_moment IS NULL)`; args.push(meal);}
    if(age){
      const a=parseFloat(age);
      if(Number.isFinite(a)){
        sql+=` AND (r.age_min IS NULL OR r.age_min<=?) AND (r.age_max IS NULL OR r.age_max>=?)`;
        args.push(a,a);
      }
    }
    if(region){
      sql+=` AND (r.region=? OR r.region='Pan-India' OR r.region IS NULL)`;
      args.push(region);
    }

    sql+=` ORDER BY CASE WHEN r.score IS NULL THEN 1 ELSE 0 END, r.score DESC, r.name LIMIT ?`;
    args.push(limit);

    let {results}=await env.DB.prepare(sql).bind(...args).all();

    // If the D1 catalogue cannot satisfy the query, discover online across
    // all active registered recipe sources, then persist the discovered recipes.
    let webSearchPerformed=false;
    let discovery=null;

    const hasSearchFilters=Boolean(
      q ||
      (diet && diet!=='All') ||
      (season && season!=='All Seasons') ||
      meal ||
      age ||
      region
    );

    if(hasSearchFilters && results.length < limit && env.TAVILY_API_KEY){
      try{
        const onlineQuery = q || [
          'Indian kids recipes',
          diet && diet!=='All' ? diet : '',
          meal ? meal : '',
          season && season!=='All Seasons' ? season : '',
          age ? `for children age ${age}` : '',
          region ? region : '',
          'ingredients quantities'
        ].filter(Boolean).join(' ');

        discovery=await searchRecipesOnline(env,{
          q:onlineQuery,diet,season,meal,age,region,limit
        });
        webSearchPerformed=Boolean(discovery.web_search_performed);

        // Re-run D1 search so the response uses the same canonical recipe shape.
        ({results}=await env.DB.prepare(sql).bind(...args).all());
      }catch(e){
        discovery={web_search_performed:false,error:String(e?.message||e)};
      }
    }

    return json({
      recipes:results.slice(0,limit).map(recipeOut),
      search:{
        query:q||null,
        web_search_performed:webSearchPerformed,
        source_count:discovery?.source_count || null,
        sources_considered:discovery?.sources_considered || null,
        discovery_error:discovery?.error || null
      }
    });
  }

  const rm=p.match(/^\/api\/recipes\/([^/]+)$/);
  if(rm && request.method==='GET'){
    const r=await env.DB.prepare(`SELECT r.*,m.url AS image_url FROM recipes r LEFT JOIN media_assets m ON m.id=r.image_media_id WHERE r.id=? OR r.slug=? LIMIT 1`).bind(rm[1],rm[1]).first();
    if(!r)return bad('Recipe not found.',404); return json({recipe:recipeOut(r)});
  }
if(p==='/api/discovery/search' && request.method==='POST'){
  const u = await getSessionUser(request, env);
  if(!u) return bad('Please log in to use Discovery Search.',401);

  const b = await request.json();
  const query = String(b.query || '').trim();

  if(!query){
    return bad('Search query is required.',400);
  }

  try{
    const result = await runWebDiscovery(env, {
      user_id: u.id,
      query,
      discovery_type: b.discovery_type || 'product',
      age: b.age,
      meal: b.meal,
      season: b.season,
      preference: b.preference,
      search_depth: b.search_depth || 'advanced',
      topic: b.topic || 'general',
      max_results: b.max_results ? Number(b.max_results) : 8
    });

    return json(result);
  }catch(e){
    return json({error:e.message},502);
  }
}
if(p==='/api/ingredient-intelligence/research' && request.method==='POST'){
  const u=await getSessionUser(request,env);
  if(!u)return bad('Please log in to use Ingredient Intelligence.',401);

  const b=await request.json();

  try{
    const result=await researchIngredientOffers(env,{
      ingredient:b.ingredient,
      location:b.location || b.pincode
    });

    return json(result);
  }catch(e){
    return json({error:e.message},502);
  }
}
if(p==='/api/product-intelligence/research' && request.method==='POST'){
  const u=await getSessionUser(request,env);
  if(!u)return bad('Please log in to use Product Intelligence.',401);

  const b=await request.json();

  try{
    const result=await researchProducts(env,b);

    const runId=uid('discovery');
    const ts=now();

    // Record the research run
    await env.DB.prepare(`
      INSERT INTO discovery_runs
      (
        id,
        user_id,
        query_text,
        discovery_type,
        age,
        meal,
        season,
        preference,
        provider,
        status,
        result_count,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      runId,
      u.id,
      String(b.query||''),
      'product',
      b.age ? Number(b.age) : null,
      b.meal || null,
      b.season || null,
      b.preference || null,
      'tavily-page-extractor',
      'completed',
      result.products.length,
      ts
    ).run();

    // Save each researched product.
    // Product identity = Brand + SKU.
    // Manufacturing locations are deliberately NOT part of the identity.
    for(const p of result.products){

      const brand=String(p.brand||'').trim();
      const sku=String(p.sku||'').trim();
      const name=String(p.name||'').trim();

      // Product identity is strictly Brand + SKU.
      // Do not create a product identity from product name alone.
      if(!name || !brand || !sku) continue;

      const normalizedBrand=brand.toLowerCase().replace(/\s+/g,' ').trim();
      const normalizedSku=sku.toLowerCase().replace(/\s+/g,' ').trim();

      if(!normalizedBrand || !normalizedSku) continue;

      const productKey=`${normalizedBrand}|${normalizedSku}`;

      // Prevent the same Brand + SKU from being inserted twice.
      const existing=await env.DB.prepare(`
        SELECT id
        FROM discovered_products
        WHERE product_key=?
        LIMIT 1
      `).bind(productKey).first();

      let productId=existing?.id;

      if(!productId){
        productId=uid('product');

        await env.DB.prepare(`
          INSERT INTO discovered_products
(
  id,
  run_id,
  name,
  brand,
  sku,
  category,
  pack_size_value,
  pack_size_unit,
  manufacturer_url,
  product_url,
  image_url,
  ingredients_text,
  nutrition_json,
  product_facts_json,
  evidence_json,
  availability_json,
  buy_links_json,
  confidence,
  kidposhan_score,
  score_status,
  status,
  created_at,
  updated_at,
  product_key,
  variant,
  identity_status
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
  productId,
  runId,
  name,
  brand,
  sku,
  p.category || '',
  null,
  null,
  null,
  p.source_urls?.[0] || null,
  p.image_url || null,
  JSON.stringify(p.ingredients || []),
  JSON.stringify(p.nutrition || {}),
  JSON.stringify({
    pack_size: p.pack_size || '',
    verification_status: p.verification_status || ''
  }),
  JSON.stringify({
    source_urls: p.source_urls || [],
    source_notes: p.source_notes || []
  }),
  null,
  null,
  null,
  null,
  'not_scored',
  'candidate',
  ts,
  ts,
  productKey,
  null,
  p.verification_status || 'unverified'
).run();
      }

      // Save source/evidence records for this product.
      for(const sourceUrl of (p.source_urls || [])){
        if(!sourceUrl) continue;

        await env.DB.prepare(`
          INSERT INTO product_evidence
          (
            id,
            product_id,
            evidence_type,
            source_url,
            field_name,
            extracted_value,
            evidence_text,
            confidence,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          uid('evidence'),
          productId,
          'product_research',
          sourceUrl,
          null,
          null,
          null,
          null,
          ts
        ).run();
      }
    }

    // Keep the existing research-run history as well.
    await env.DB.prepare(`
      INSERT INTO product_research_runs
      (
        id,
        user_id,
        query_text,
        age,
        meal,
        season,
        preference,
        provider,
        model,
        result_count,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      uid('pirun'),
      u.id,
      String(b.query||''),
      b.age ? Number(b.age) : null,
      b.meal || null,
      b.season || null,
      b.preference || null,
      'tavily-page-extractor',
      result.model,
      result.products.length,
      'completed',
      ts
    ).run();

    return json({
      ...result,
      discovery_run_id:runId,
      persisted_products:result.products.length
    });

  }catch(e){
    return json({error:e.message},502);
  }
} if(p==='/api/products' && request.method==='GET'){
    const q=(url.searchParams.get('ingredient')||url.searchParams.get('q')||'').trim().toLowerCase();
    const location=(url.searchParams.get('location')||url.searchParams.get('pincode')||'').trim();
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||50),1),100);

    let sql=`
      SELECT
        p.id,
        p.name,
        p.brand,
        p.sku,
        p.category,
        p.pack_size_value,
        p.pack_size_unit,
        p.product_url,
        p.image_url,
        p.ingredients_text,
        p.nutrition_json,
        p.product_facts_json,
        p.kidposhan_score,
        p.score_status,
        p.status,
        p.product_key,
        p.identity_status
      FROM discovered_products p
      WHERE p.status IN ('candidate','published')
        AND p.brand IS NOT NULL AND trim(p.brand)<>''
        AND p.sku IS NOT NULL AND trim(p.sku)<>''
    `;
    const args=[];

    if(q){
      sql+=` AND (
        lower(p.name) LIKE ? OR
        lower(p.brand) LIKE ? OR
        lower(p.sku) LIKE ? OR
        lower(COALESCE(p.category,'')) LIKE ? OR
        lower(COALESCE(p.ingredients_text,'')) LIKE ?
      )`;
      const needle='%'+q+'%';
      args.push(needle,needle,needle,needle,needle);
    }

    sql+=` ORDER BY COALESCE(p.kidposhan_score,0) DESC, p.name LIMIT ?`;
    args.push(limit);

    const {results}=await env.DB.prepare(sql).bind(...args).all();

    const products=[];
    for(const pRow of results){
      let offerSql=`
        SELECT
          id,
          retailer_name,
          retailer_type,
          url,
          price,
          currency,
          pack_size_value,
          pack_size_unit,
          availability_status,
          location,
          affiliate_url,
          source_url,
          evidence_text,
          checked_at
        FROM product_offers
        WHERE product_id=?
      `;
      const offerArgs=[pRow.id];

      // Location is an exact-match filter. If no matching location is found,
      // do not fall back to another city/pincode and call it locally available.
      if(location){
        offerSql+=` AND lower(trim(COALESCE(location,'')))=lower(trim(?))`;
        offerArgs.push(location);
      }

      offerSql+=` ORDER BY CASE WHEN lower(COALESCE(availability_status,'')) IN ('available','in_stock','yes') THEN 0 ELSE 1 END, checked_at DESC`;
      const {results:offers}=await env.DB.prepare(offerSql).bind(...offerArgs).all();

      products.push({
        id:pRow.id,
        name:pRow.name,
        brand:pRow.brand,
        sku:pRow.sku,
        category:pRow.category,
        pack_size_value:pRow.pack_size_value,
        pack_size_unit:pRow.pack_size_unit,
        product_url:pRow.product_url,
        image_url:pRow.image_url,
        ingredients_text:pRow.ingredients_text,
        nutrition_json:pRow.nutrition_json,
        product_facts_json:pRow.product_facts_json,
        score:pRow.kidposhan_score,
        kidposhan_score:pRow.kidposhan_score,
        score_status:pRow.score_status,
        identity_status:pRow.identity_status,
        availability_verified:Boolean(location && offers.length),
        requested_location:location||null,
        offers:offers.map(o=>({
          id:o.id,
          retailer_name:o.retailer_name,
          retailer_type:o.retailer_type,
          url:o.url,
          price:o.price,
          currency:o.currency,
          pack_size_value:o.pack_size_value,
          pack_size_unit:o.pack_size_unit,
          availability_status:o.availability_status,
          location:o.location,
          affiliate_url:o.affiliate_url,
          source_url:o.source_url,
          evidence_text:o.evidence_text,
          checked_at:o.checked_at,
          buy_url:o.affiliate_url || o.url
        })),
        // Compatibility for the current recipe page while it is being migrated.
        buyLinks:offers.map(o=>({
          retailer:o.retailer_name,
          url:o.affiliate_url || o.url,
          affiliate_url:o.affiliate_url,
          availability_status:o.availability_status,
          location:o.location
        }))
      });
    }

    return json({products, location:location||null});
  }
  if(p==='/api/ingredient-offers' && request.method==='GET'){
    const raw=(url.searchParams.get('ingredient')||'').trim();
    const location=(url.searchParams.get('location')||url.searchParams.get('pincode')||'').trim();
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||30),1),100);
    if(!raw)return bad('Missing ingredient.');

    // Match the ingredient itself, not the recipe preparation text.
    const ingredientKey=raw
      .toLowerCase()
      .replace(/\([^)]*\)/g,' ')
      .replace(/\b(boiled|mashed|grated|chopped|finely|roughly|sliced|diced|crushed|peeled|washed)\b/g,' ')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();

    let sql=`
      SELECT
        id,
        ingredient_key,
        ingredient_name,
        product_name,
        retailer_name,
        retailer_type,
        url,
        affiliate_url,
        image_url,
        price,
        currency,
        unit_value,
        unit,
        unit_label,
        availability_status,
        location,
        source_url,
        evidence_text,
        checked_at
      FROM ingredient_offers
      WHERE (
        lower(ingredient_key)=? OR
        lower(ingredient_name)=? OR
        lower(ingredient_name) LIKE ?
      )
    `;
    const args=[ingredientKey,ingredientKey,'%'+ingredientKey+'%'];

    if(location){
      // Exact location match only. Never show another pincode as locally available.
      sql+=` AND lower(trim(COALESCE(location,'')))=lower(trim(?))`;
      args.push(location);
    }

    sql+=` ORDER BY
      CASE WHEN lower(COALESCE(availability_status,'')) IN ('available','in_stock','yes') THEN 0 ELSE 1 END,
      CASE WHEN price IS NULL THEN 1 ELSE 0 END,
      price ASC,
      checked_at DESC
      LIMIT ?`;
    args.push(limit);

    const {results}=await env.DB.prepare(sql).bind(...args).all();
    return json({
      ingredient:raw,
      ingredient_key:ingredientKey,
      location:location||null,
      offers:results.map(o=>({
        id:o.id,
        ingredient_name:o.ingredient_name,
        product_name:o.product_name,
        retailer_name:o.retailer_name,
        retailer_type:o.retailer_type,
        url:o.url,
        affiliate_url:o.affiliate_url,
        buy_url:o.affiliate_url || o.url,
        image_url:o.image_url,
        price:o.price,
        currency:o.currency,
        unit_value:o.unit_value,
        unit:o.unit,
        unit_label:o.unit_label,
        availability_status:o.availability_status,
        location:o.location,
        source_url:o.source_url,
        evidence_text:o.evidence_text,
        checked_at:o.checked_at
      }))
    });
  }
  if(p==='/api/ratings' && request.method==='GET'){
    const t=url.searchParams.get('target_type'), id=url.searchParams.get('target_id'); if(!t||!id)return bad('Missing target.');
    const row=await env.DB.prepare(`SELECT ROUND(AVG(rating),1) avg, COUNT(*) count FROM ratings WHERE target_type=? AND target_id=?`).bind(t,id).first(); return json({rating:{average:Number(row?.avg||0),count:Number(row?.count||0)}});
  }
  if(p==='/api/ratings' && request.method==='POST'){
    const u=await getSessionUser(request,env); if(!u)return bad('Please log in to rate.',401); const b=await request.json();
    await env.DB.prepare(`INSERT INTO ratings(id,user_id,target_type,target_id,rating,comment,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,target_type,target_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment`).bind(uid('rating'),u.id,b.target_type,b.target_id,Number(b.rating),String(b.comment||''),now()).run(); return json({ok:true});
  }
  if(p==='/api/planner' && request.method==='GET'){
    const u=await getSessionUser(request,env); if(!u)return bad('Please log in.',401);
    const {results}=await env.DB.prepare(`SELECT p.*,GROUP_CONCAT(c.child_id) child_ids FROM planner_items p LEFT JOIN planner_item_children c ON c.planner_item_id=p.id WHERE p.user_id=? GROUP BY p.id ORDER BY p.day_order,p.slot_order`).bind(u.id).all(); return json({items:results.map(x=>({...x,childIds:(x.child_ids||'').split(',').filter(Boolean)}))});
  }
  if(p==='/api/admin/overview' && request.method==='GET'){
    const u=await getSessionUser(request,env); if(!u||u.role!=='admin')return bad('Admin access required.',403);
    const [a,b,c]=await Promise.all([env.DB.prepare('SELECT COUNT(*) n FROM recipes').first(),env.DB.prepare('SELECT COUNT(*) n FROM products').first(),env.DB.prepare('SELECT COUNT(*) n FROM users').first()]);
    return json({recipes:a.n,products:b.n,users:c.n});
  }
  if(p==='/api/admin/recipes' && request.method==='POST'){
    const u=await getSessionUser(request,env); if(!u||u.role!=='admin')return bad('Admin access required.',403); const b=await request.json();
    const id=b.id||uid('recipe'), ts=now(); await env.DB.prepare(`INSERT INTO recipes(id,slug,name,description,image_media_id,score,age_min,age_max,meal_moment,season,diet,prep_minutes,difficulty,ingredients_json,method_json,nutrition_json,benefits_json,serve_with_json,tags_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,description=excluded.description,image_media_id=excluded.image_media_id,score=excluded.score,age_min=excluded.age_min,age_max=excluded.age_max,meal_moment=excluded.meal_moment,season=excluded.season,diet=excluded.diet,prep_minutes=excluded.prep_minutes,difficulty=excluded.difficulty,ingredients_json=excluded.ingredients_json,method_json=excluded.method_json,nutrition_json=excluded.nutrition_json,benefits_json=excluded.benefits_json,serve_with_json=excluded.serve_with_json,tags_json=excluded.tags_json,status=excluded.status,updated_at=excluded.updated_at`).bind(id,b.slug,b.name,b.description||'',b.image_media_id||null,Number(b.score||0),b.age_min||null,b.age_max||null,b.meal_moment||null,b.season||null,b.diet||'Veg',b.prep_minutes||null,b.difficulty||'Easy',JSON.stringify(b.ingredients||[]),JSON.stringify(b.method||[]),JSON.stringify(b.nutrition||{}),JSON.stringify(b.benefits||[]),JSON.stringify(b.serveWith||[]),JSON.stringify(b.tags||[]),b.status||'draft',ts,ts).run(); return json({ok:true,id});
  }
  if(p==='/api/payments/create-order' && request.method==='POST'){
    return bad('Payment gateway not configured yet. Connect Razorpay/Stripe credentials in Cloudflare Secrets before enabling paid features.',501);
  }
  if(p==='/api/live-commerce' && request.method==='GET'){
    const ingredient=(url.searchParams.get('ingredient')||'').trim();
    const pincode=(url.searchParams.get('pincode')||'').trim();

    if(!ingredient) return bad('Missing ingredient.',400);
    if(!env.QUICKCOMMERCE_API_KEY) return bad('QuickCommerce API key is not configured.',500);

    const lat='22.5726';
    const lon='88.3639';
    const platforms=['BlinkIt','Swiggy'];

    const results=await Promise.allSettled(
      platforms.map(async platform=>{
        const q=new URL('https://api.quickcommerceapi.com/v1/search');
        q.searchParams.set('q',ingredient);
        q.searchParams.set('lat',lat);
        q.searchParams.set('lon',lon);
        q.searchParams.set('platform',platform);

        const response=await fetch(q.toString(),{
          headers:{'X-API-Key':env.QUICKCOMMERCE_API_KEY}
        });

        if(!response.ok){
          throw new Error(`${platform} API returned ${response.status}`);
        }

        const data=await response.json();
        const products=data?.data?.products||data?.results||[];

        return {
          platform,
          products:products.slice(0,8).map(p=>({
            id:p.id||null,
            name:p.name||'',
            brand:p.brand||'',
            quantity:p.quantity||'',
            price:p.offer_price ?? null,
            mrp:p.mrp ?? null,
            available:Boolean(p.available),
            inventory:p.inventory ?? null,
            image_url:(p.images||[])[0]||null,
            buy_url:p.deeplink||null,
            rating:p.rating ?? null,
            rating_count:p.rating_count ?? null,
            sla:p.platform?.sla||null,
            store_id:p.platform?.store_id||null
          }))
        };
      })
    );

    const offers=[];
    const errors=[];

    results.forEach((r,i)=>{
      if(r.status==='fulfilled'){
        offers.push(...r.value.products.map(p=>({...p,retailer:r.value.platform})));
      }else{
        errors.push({platform:platforms[i],error:r.reason?.message||'Request failed'});
      }
    });

    return json({
      ok:true,
      ingredient,
      pincode:pincode||null,
      location:{lat,lon},
      offers,
      errors,
      checked_at:new Date().toISOString()
    });
  }

  return null;
}

export default {async scheduled(event,env,ctx){ctx.waitUntil(scheduledRecipes(env,event.cron));}, async fetch(request,env,ctx){const recipeRes=await routeRecipes(request,env,ctx); if(recipeRes)return recipeRes; const u=new URL(request.url); if(u.pathname.startsWith('/api/')){const r=await api(request,env); if(r)return r; return bad('API route not found.',404)} return env.ASSETS.fetch(request)}};
