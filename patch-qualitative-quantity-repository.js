/**
 * One-time deterministic patch for src/recipe-discovery.js
 *
 * Run from the KidPoshan project root:
 *   node patch-qualitative-quantity-repository.js
 *
 * It:
 * 1. imports the repository recorder,
 * 2. stops the old 3 g salt assumption in this discovery module,
 * 3. records qualitative quantity evidence after recipe extraction.
 *
 * It does not create numeric standards for ghee, oil, etc.
 */

import fs from "node:fs";

const file = "src/recipe-discovery.js";
let source = fs.readFileSync(file, "utf8");

const importLine = 'import { recordQualitativeQuantityEvidence } from "./qualitative-quantity-repository.js";';

if (!source.includes(importLine)) {
  const anchor = 'import { calculatePoshanScore } from "./poshan-score.js";';
  if (!source.includes(anchor)) {
    throw new Error("Could not find the Poshan score import.");
  }
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

// Remove the obsolete 3 g salt convention from the discovery parser.
// The repository/score integration will handle approved conventions separately.
source = source.replace(
`  // User-defined KidPoshan convention.
  if (/\\bto taste\\b/i.test(raw)) {
    return { raw, value: 3, unit: "g", quantitative: false, assumption: "to_taste_3g" };
  }

`,
`  // Qualitative quantities remain qualitative here.
  // Do not invent a numeric quantity from "to taste", "as required", etc.
`
);

source = source.replace(
`  // KidPoshan convention: "salt to taste" = 3 g salt.
  // 3 g salt ≈ 1,180 mg sodium (NaCl is ~39.3% sodium).
`,
`  // Qualitative quantity conventions are stored in D1.
  // This module does not hard-code a numeric assumption.
`
);

source = source.replace(
`    if (saltToTaste) sodiumValue += 3000 * 0.393;
`,
`    if (saltToTaste) {
      // Do not apply a numeric convention in discovery yet.
      // Approved repository standards will be applied by the scoring layer.
    }
`
);

const anchor = `          const mapped = mapRecipe(source, recipe, url);

          if (!mapped.name || !mapped.ingredients.length) continue;`;

const replacement = `          const mapped = mapRecipe(source, recipe, url);

          if (!mapped.name || !mapped.ingredients.length) continue;

          // Permanently record ambiguous quantity language as evidence.
          // No numeric value is invented here.
          await recordQualitativeQuantityEvidence(
            env,
            source,
            recipe,
            url
          );`;

if (!source.includes(anchor)) {
  throw new Error("Could not find recipe mapping anchor.");
}
if (!source.includes("recordQualitativeQuantityEvidence(\n            env")) {
  source = source.replace(anchor, replacement);
}

fs.writeFileSync(file, source, "utf8");
console.log("Patched src/recipe-discovery.js successfully.");
console.log("Next: run a syntax check before deploying.");
