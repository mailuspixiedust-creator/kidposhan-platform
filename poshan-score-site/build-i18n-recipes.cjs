// The recipe pages in Hindi, Bengali and Gujarati: the same page as the English one, with the words around the recipe translated.
// The recipe's name, ingredients and method stay in the language the creator wrote them in (marked lang="en" so a phone picks the right font).
const { TEXT } = require('./i18n.cjs');
const { REC } = require('./i18n-recipe.cjs');
const { alternates, switcher } = require('./build-i18n.cjs');

function recipePageLocal(d, slug, extra, code, ctx) {
  const { esc, withMeta, SITE, TIER_COLOR, RECIPE_CSS, AGE_LABEL, isoTime, recName, h1Of, showHow } = ctx;
  const R = REC[code], L = TEXT[code];
  const rel = `recipes/${slug}`, url = `${SITE}/${code}/${rel}`;
  const nm = recName(d.name), sc = d.score || {}, score = Math.round(sc.value ?? d.poshan_score);
  const credit = (d.source && d.source.name) || 'the recipe creator';
  const ageName = (k) => R.age[k] || k;
  const lblToKey = Object.fromEntries(Object.entries(AGE_LABEL).map(([k, v]) => [v, k]));
  const ageFor = sc.age_band_label && lblToKey[sc.age_band_label] ? ageName(lblToKey[sc.age_band_label]) : ageName('4-6y');
  const band = sc.capped ? R.capped : (L.tier[sc.band] || sc.band);
  const checks = sc.metrics || [];
  const passed = checks.filter((m) => m.score === 1).length;
  const failed = checks.filter((m) => m.score === 0).slice(0, 4).map((m) => R.chk[m.id] || m.name).join(', ');
  const ages = Object.entries(d.scores_by_age || {}).filter(([, v]) => v != null);
  const top = ages.length ? Math.max(...ages.map(([, v]) => v)) : null, low = ages.length ? Math.min(...ages.map(([, v]) => v)) : null;
  const topAges = ages.filter(([, v]) => v === top).map(([k]) => ageName(k)).slice(0, 3).join(', ');
  const lowAge = ages.length ? ageName((ages.find(([, v]) => v === low) || [''])[0]) : '';
  const val = (id) => { const m = checks.find((x) => x.id === id); return m && m.value != null ? Number(m.value) : null; };
  const nutr = { protein: val('protein'), fibre: val('fibre'), satfat: val('satfat'), sugar: val('sugar'), sodium: val('sodium') };
  const est = sc.kind !== 'exact';
  const diet = R.diet[d.diet] || '';
  const meals = (d.meals || []).map((o) => R.meal[o]).filter(Boolean);
  const servesTxt = d.servings ? String(d.servings).replace(/^\s*(makes|serves|yields?|servings?:?)\s+/i, '').replace(/(\d)\s*(?:to|-|–)\s*(\d)/i, '$1–$2') : '';
  const o = { nm, age: ageFor, score, band, passed, failed, top, low, topAges, lowAge, credit, diet };
  const title = R.title(o), desc = R.desc(o);
  const faq = [[R.q1(nm), R.a1(o)], ...(ages.length > 1 ? [[R.q2(nm), R.a2(o)]] : []), [R.q3, R.a3]];
  const nutrRows = [['protein', nutr.protein, 'g'], ['fibre', nutr.fibre, 'g'], ['satfat', nutr.satfat, 'g'], ['sugar', nutr.sugar, 'g'], ['sodium', nutr.sodium, 'mg']].filter((x) => x[1] != null);
  const perHtml = nutrRows.length ? `<h2>${esc(R.h.per)}</h2><table>${nutrRows.map(([k, v, u]) => `<tr><td>${esc(R.nut[k])}</td><td class="m">${Math.round(v * 10) / 10} ${u}</td></tr>`).join('')}</table><p class="fine">${esc(R.perNote(est ? R.estimated : R.fromPage, servesTxt))}</p>` : '';
  const byAge = ages.map(([k, v]) => `<tr><td>${esc(ageName(k))}</td><td class="m"><b>${v}</b>/100</td></tr>`).join('');
  const ings = (d.ingredients || []).map((i) => i.raw_text).filter((t) => t && !/^(null|undefined|\s)+$/i.test(String(t)));
  const steps = Array.isArray(d.method) ? d.method : [];
  let stepsHtml = '', n = 0;
  if (steps.length) {
    let open = false, cur = null;
    for (const st of steps) {
      n++;
      if (st.section !== cur) { if (open) stepsHtml += '</ol>'; cur = st.section; if (cur) stepsHtml += `<h3>${esc(cur)}</h3>`; stepsHtml += '<ol class="steps" lang="en">'; open = true; }
      stepsHtml += `<li id="step-${n}">${esc(st.text)}</li>`;
    }
    if (open) stepsHtml += '</ol>';
  }
  const howWhy = d.how_often_why ? String(d.how_often_why).split(', ').map((w) => R.why[w] || w).join(', ') : '';
  const howLine = showHow && d.how_often && R.how[d.how_often] ? `<p class="howline"><b>${esc(R.howLabel)}:</b> <span class="how how-${d.how_often}">${esc(R.how[d.how_often])}${howWhy ? ' · ' + esc(howWhy) : ''}</span> ${esc(R.howHelp[d.how_often])}${code === 'gu' ? '.' : '।'} ${esc(R.howNote)}</p>` : '';
  const facts = [d.total_minutes ? '⏱ ' + L.time(d.total_minutes) : '', servesTxt ? R.serves(servesTxt) : '', diet, ...meals, d.age_min_months ? R.from(d.age_min_months) : ''].filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'Recipe', name: nm, inLanguage: code, image: d.image_url ? [d.image_url] : undefined, author: { '@type': 'Person', name: credit }, description: desc, url,
    totalTime: d.total_minutes ? isoTime(d.total_minutes) : undefined, recipeYield: d.servings ? String(d.servings) : undefined, recipeCategory: meals[0] || undefined, recipeIngredient: ings.length ? ings : undefined,
    recipeInstructions: steps.length ? steps.map((st, i) => ({ '@type': 'HowToStep', text: st.text, url: `${url}#step-${i + 1}` })) : undefined, isBasedOn: (d.source && d.source.url) || undefined };
  const ldFaq = { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: code, mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  const css = RECIPE_CSS + `.bigscore{display:flex;align-items:center;gap:14px;margin:16px 0 6px}.bigscore b{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font-size:32px;color:#fff;background:${TIER_COLOR[sc.capped ? 'OK' : sc.band] || TIER_COLOR.OK}}.bigscore span{font-weight:600}.langs{margin:0 0 8px}body{line-height:1.7}`;
  const mc = extra.mealCrumb ? { slug: extra.mealCrumb.slug, h1: h1Of(extra.mealCrumb.slug, code) } : null;
  const nav = `<nav><a class="brand" href="/">Poshan Score <small>by KidPoshan</small></a><a href="/${code}/ideas">${esc(L.ideas)}</a><a href="/meal-ideas">${esc(L.plan)}</a></nav>`;
  const byLine = d.source && d.source.url ? `${esc(R.by(''))}<a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(credit)}</a>` : esc(R.by(credit));
  let html = `<!doctype html>
<html lang="${L.html}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${[ld, ldFaq].map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join('')}
${alternates(SITE, rel)}
<style>${css}</style></head><body>
${nav}
<main>
${switcher(rel, code)}
<p class="crumb"><a href="/">${esc(L.home)}</a> › <a href="/recipes">${esc(R.recipes)}</a> › ${mc ? `<a href="/${code}/ideas/${mc.slug}">${esc(mc.h1)}</a> › ` : ''}<span lang="en">${esc(nm)}</span></p>
<h1 lang="en">${esc(nm)}</h1>
<p class="fine">${byLine}</p>
${d.image_url ? `<div class="hero"><img src="${esc(d.image_url)}" alt="${esc(nm)}" width="760" height="340" loading="eager" fetchpriority="high" decoding="async" referrerpolicy="no-referrer"><span class="fine">${esc(R.photo(credit))}</span></div>` : ''}
<div class="facts">${facts}</div>
${howLine}
<div class="bigscore"><b>${score}</b><span>${esc(band)}</span></div>
<p>${esc(R.intro(o))}</p>
${d.kid_note ? `<p class="note" lang="en">${esc(d.kid_note)}</p>` : ''}
<h2>${esc(R.h.every)}</h2><table>${byAge || `<tr><td>${esc(R.openFor)}</td></tr>`}</table>
${perHtml}
${ings.length ? `<h2>${esc(R.h.ing)}</h2><ul class="ing" lang="en">${ings.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
${stepsHtml ? `<h2>${esc(R.h.method)}</h2>${stepsHtml}<p class="fine">${esc(R.methodBy(credit))}${d.source && d.source.url ? `. <a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(R.seeOrig)}</a>` : ''}.</p>` : (d.source && d.source.url ? `<p><a class="cta alt" href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(R.seeMethod(credit))}</a></p>` : '')}
<div class="faq"><h2>${esc(R.h.faq)}</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div>
${(extra.similar || []).length ? `<h2>${esc(R.h.like)}</h2><ul class="ing">${extra.similar.map((x) => `<li><a href="/${code}/recipes/${x.slug}" lang="en">${esc(x.name)}</a> <span class="fine">· ${x.score}/100${x.by ? ' · ' + esc(x.by) : ''}</span></li>`).join('')}</ul>` : ''}
${(extra.collections || []).length ? `<h2>${esc(R.h.ideas)}</h2><p>${extra.collections.map((c) => `<a href="/${code}/ideas/${c.slug}">${esc(h1Of(c.slug, code))}</a>`).join(' · ')}</p>` : ''}
<p style="margin-top:22px"><a class="cta" href="/meal-ideas#/r/${d.id}">${esc(R.cta)}</a><a class="cta alt" href="/recipes">${esc(R.ctaMore)}</a></p>
<p class="fine">${esc(L.fine)}</p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
  html = withMeta(html, { url, title, desc, type: 'article' });
  return { html, url, path: `${code}/${rel}.html` };
}

module.exports = { recipePageLocal };
