import { researchProducts } from './product-intelligence.js';
import { searchWeb } from './web-search.js';
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

async function seedIfNeeded(env){
  // Intentionally no automatic schema mutation in production. Run schema.sql/seed.sql once in D1.
}

async function api(request, env){
  const url = new URL(request.url);
  const p=url.pathname;
  if(!env.DB) return bad('Database binding is not configured.',500);
  if(p==='/api/health') return json({ok:true,db:true});

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
  if(p==='/api/auth/logout' && request.method==='POST') return json({ok:true},{'Set-Cookie':'kp_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'});

  if(p==='/api/recipes' && request.method==='GET'){
    const q=(url.searchParams.get('q')||'').trim(); const diet=url.searchParams.get('diet')||''; const season=url.searchParams.get('season')||''; const meal=url.searchParams.get('meal')||''; const age=url.searchParams.get('age')||'';
    let sql=`SELECT r.*,m.url AS image_url FROM recipes r LEFT JOIN media_assets m ON m.id=r.image_media_id WHERE r.status='published'`; const args=[];
    if(q){sql+=` AND (lower(r.name) LIKE ? OR lower(r.description) LIKE ?)`; args.push('%'+q.toLowerCase()+'%','%'+q.toLowerCase()+'%');}
    if(diet && diet!=='All') {sql+=` AND r.diet=?`; args.push(diet);}
    if(season && season!=='All Seasons') {sql+=` AND (r.season=? OR r.season='All Seasons')`; args.push(season);}
    if(meal) {sql+=` AND r.meal_moment=?`; args.push(meal);}
    if(age){const a=parseFloat(age); if(Number.isFinite(a)){sql+=` AND r.age_min<=? AND r.age_max>=?`; args.push(a,a)}}
    sql+=` ORDER BY r.score DESC, r.name LIMIT 200`;
    const {results}=await env.DB.prepare(sql).bind(...args).all(); return json({recipes:results.map(recipeOut)});
  }
  const rm=p.match(/^\/api\/recipes\/([^/]+)$/);
  if(rm && request.method==='GET'){
    const r=await env.DB.prepare(`SELECT r.*,m.url AS image_url FROM recipes r LEFT JOIN media_assets m ON m.id=r.image_media_id WHERE r.id=? OR r.slug=? LIMIT 1`).bind(rm[1],rm[1]).first();
    if(!r)return bad('Recipe not found.',404); return json({recipe:recipeOut(r)});
  }
if(p==='/api/discovery/search' && request.method==='POST'){
  const u = await getSessionUser(request, env);
  if(!u) return bad('Please log in to use Discovery Search.', 401);

  const b = await request.json();
  const query = String(b.query || '').trim();

  if(!query){
    return bad('Search query is required.', 400);
  }

  try{
    const result = await searchWeb(env, query, {
      search_depth: b.search_depth || 'advanced',
      topic: b.topic || 'general',
      max_results: b.max_results ? Number(b.max_results) : 8
    });

    return json(result);
  }catch(e){
    return json({error:e.message}, 502);
  }
}
if(p==='/api/discovery/search' && request.method==='POST'){
  const u = await getSessionUser(request, env);
  if(!u) return bad('Please log in to use Discovery Search.', 401);

  const b = await request.json();
  const query = String(b.query || '').trim();

  if(!query){
    return bad('Search query is required.', 400);
  }

  try{
    const result = await searchWeb(env, query, {
      search_depth: b.search_depth || 'advanced',
      topic: b.topic || 'general',
      max_results: b.max_results ? Number(b.max_results) : 8
    });

    return json(result);
  }catch(e){
    return json({error:e.message}, 502);
  }
}
if(p==='/api/product-intelligence/research' && request.method==='POST'){
  const u=await getSessionUser(request,env);	
  if(!u)return bad('Please log in to use Product Intelligence.',401);
  const b=await request.json();
  try{
    const result=await researchProducts(env,b);
    await env.DB.prepare(`INSERT INTO product_research_runs(id,user_id,query_text,age,meal,season,preference,provider,model,result_count,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(uid('pirun'),u.id,String(b.query||''),b.age?Number(b.age):null,b.meal||null,b.season||null,b.preference||null,'gemini',result.model,result.products.length,'completed',now()).run();
    return json(result);
  }catch(e){
    return json({error:e.message},502);
  }
}
  if(p==='/api/products' && request.method==='GET'){
    const ingredient=(url.searchParams.get('ingredient')||'').trim(); let sql=`SELECT p.*,m.url AS image_url, GROUP_CONCAT(pb.retailer||'::'||pb.url,'|') AS buy_links FROM products p LEFT JOIN media_assets m ON m.id=p.image_media_id LEFT JOIN product_buy_links pb ON pb.product_id=p.id WHERE p.status='published'`; const args=[];
    if(ingredient){sql+=` AND lower(p.ingredient) LIKE ?`;args.push('%'+ingredient.toLowerCase()+'%');}
    sql+=` GROUP BY p.id ORDER BY p.score DESC LIMIT 50`; const {results}=await env.DB.prepare(sql).bind(...args).all();
    return json({products:results.map(p=>({...p,buyLinks:(p.buy_links||'').split('|').filter(Boolean).map(x=>{const [retailer,url]=x.split('::');return {retailer,url}})}))});
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
  return null;
}

export default {async fetch(request,env,ctx){const u=new URL(request.url); if(u.pathname.startsWith('/api/')){const r=await api(request,env); if(r)return r; return bad('API route not found.',404)} return env.ASSETS.fetch(request)}};
