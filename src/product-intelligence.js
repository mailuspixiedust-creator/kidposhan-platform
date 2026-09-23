const GEMINI_DEFAULT_MODEL = "gemini-3.6-flash";

function clean(v) { return typeof v === "string" ? v.trim() : ""; }
function arr(v) { return Array.isArray(v) ? v : []; }

const PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    products: { type: "array", items: { type: "object", properties: {
      name:{type:"string"}, brand:{type:"string"}, sku:{type:"string"}, pack_size:{type:"string"}, category:{type:"string"},
      ingredients:{type:"array",items:{type:"string"}},
      nutrition:{type:"object",properties:{serving_size:{type:"string"},energy_kcal:{type:"string"},protein_g:{type:"string"},carbohydrate_g:{type:"string"},sugars_g:{type:"string"},added_sugars_g:{type:"string"},fat_g:{type:"string"},saturated_fat_g:{type:"string"},fibre_g:{type:"string"},sodium_mg:{type:"string"}},required:["serving_size","energy_kcal","protein_g","carbohydrate_g","sugars_g","added_sugars_g","fat_g","saturated_fat_g","fibre_g","sodium_mg"]},
      source_urls:{type:"array",items:{type:"string"}}, source_notes:{type:"array",items:{type:"string"}}, verification_status:{type:"string"}
    },required:["name","brand","sku","pack_size","category","ingredients","nutrition","source_urls","source_notes","verification_status"]}},
    research_notes:{type:"array",items:{type:"string"}}
  }, required:["products","research_notes"]
};

function extractText(data) {
  const chunks=[];
  for(const step of arr(data?.steps)) { if(step?.type!=="model_output") continue; for(const block of arr(step.content)) if(typeof block?.text==="string") chunks.push(block.text); }
  if(chunks.length) return chunks.join("\n");
  if(typeof data?.output_text==="string") return data.output_text;
  return "";
}
function parseJson(text) {
  let s=clean(text); if(!s) throw new Error("Gemini returned an empty response.");
  s=s.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();
  try{return JSON.parse(s);}catch(_){ }
  const a=s.indexOf("{"),b=s.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch(_){}}
  throw new Error("Gemini returned text that could not be parsed as JSON.");
}
function citationsFrom(data) {
  const out=[];
  for(const step of arr(data?.steps)) for(const block of arr(step?.content)) for(const a of arr(block?.annotations)) { const url=clean(a?.url||a?.uri); if(url) out.push({url,title:clean(a?.title)}); }
  const seen=new Set(); return out.filter(x=>!seen.has(x.url)&&seen.add(x.url));
}
async function callGeminiResearch(env,prompt) {
  const key=clean(env?.GEMINI_API_KEY); if(!key) throw new Error("SECRET_MISSING: GEMINI_API_KEY is not reaching the active Worker runtime.");
  const model=clean(env?.GEMINI_MODEL)||GEMINI_DEFAULT_MODEL;
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{method:"POST",headers:{"x-goog-api-key":key,"content-type":"application/json"},body:JSON.stringify({model,input:prompt,tools:[{type:"google_search"},{type:"url_context"}],response_format:{type:"text",mime_type:"application/json",schema:PRODUCT_SCHEMA}})});
  const raw=await response.text(); let data={}; try{data=JSON.parse(raw);}catch(_){ }
  if(!response.ok){if(response.status===429) throw new Error("GEMINI_RATE_LIMITED: Gemini rate/quota limit was reached. Please try again later."); throw new Error(`GEMINI_API_ERROR: HTTP ${response.status}. ${clean(data?.error?.message)||raw.slice(0,500)}`);}
  return {model,data,text:extractText(data),citations:citationsFrom(data)};
}
function promptFor(input){return `
You are the product-research layer for KidPoshan, a children's food discovery platform in India.

USER REQUEST
Query: ${clean(input?.query)||"packaged food for children"}
Child age: ${clean(input?.age)||"not specified"}
Part of day: ${clean(input?.meal)||"not specified"}
Season: ${clean(input?.season)||"not specified"}
Food preference: ${clean(input?.preference)||"not specified"}

Research current packaged or ready-to-eat products in India matching the request.
Use Google Search to discover products and authoritative pages. Use URL Context when a public product page is available.

SOURCE PRIORITY
1. Manufacturer/brand official product page or official product document.
2. GS1/DataKart or regulatory/authoritative product information.
3. Established retailer product page.
4. Other reputable sources only for discovery/cross-checking.

VERIFICATION RULES
- Identify an exact product/SKU, not merely a brand.
- Never invent ingredients, nutrition values, pack sizes, or URLs.
- If a fact is not supported, leave it as an empty string.
- Keep source URLs that directly support the facts.
- Prefer products currently sold in India.
- Prefer products suitable for the stated age and meal context.
- Return up to 8 useful candidates.
- Do not duplicate the same product.
- DO NOT calculate or invent a KidPoshan Score.
- Do not let price compensate for nutrition quality.
- Do not treat marketing claims as nutrition facts.

NUTRITION
Capture label values only when found. Preserve units as stated.
Use an empty string when a nutrient is not published.

Return JSON matching the supplied schema exactly and no prose outside the JSON.
verification_status must be "verified", "partially_verified", or "insufficient".
`;}
function normalize(p,citations){const n=p?.nutrition||{},own=arr(p?.source_urls).map(clean).filter(Boolean),urls=[...new Set([...own,...citations.map(x=>x.url)])].slice(0,8);return {name:clean(p?.name),brand:clean(p?.brand),sku:clean(p?.sku),pack_size:clean(p?.pack_size),category:clean(p?.category),ingredients:arr(p?.ingredients).map(clean).filter(Boolean),nutrition:{serving_size:clean(n.serving_size),energy_kcal:clean(n.energy_kcal),protein_g:clean(n.protein_g),carbohydrate_g:clean(n.carbohydrate_g),sugars_g:clean(n.sugars_g),added_sugars_g:clean(n.added_sugars_g),fat_g:clean(n.fat_g),saturated_fat_g:clean(n.saturated_fat_g),fibre_g:clean(n.fibre_g),sodium_mg:clean(n.sodium_mg)},source_urls:urls,source_notes:arr(p?.source_notes).map(clean).filter(Boolean),verification_status:clean(p?.verification_status)||"partially_verified",kidposhan_score:null};}
export async function researchProducts(env,input={}){const result=await callGeminiResearch(env,promptFor(input));let parsed;try{parsed=parseJson(result.text);}catch(e){throw new Error(`GEMINI_RESPONSE_PARSE_ERROR: ${e.message}`);}const products=arr(parsed?.products).map(p=>normalize(p,result.citations)).filter(p=>p.name);return {ok:true,provider:"gemini",model:result.model,query:clean(input?.query),research_notes:arr(parsed?.research_notes).map(clean).filter(Boolean),products,citations:result.citations,score_status:"not_scored",score_message:"Verified product facts are returned without inventing a KidPoshan Score. The existing deterministic score engine will calculate the score in the next layer."};}
export function geminiRuntimeStatus(env){return {provider:"gemini",model:clean(env?.GEMINI_MODEL)||GEMINI_DEFAULT_MODEL,secret_present:typeof env?.GEMINI_API_KEY==="string"&&env.GEMINI_API_KEY.trim().length>0};}
