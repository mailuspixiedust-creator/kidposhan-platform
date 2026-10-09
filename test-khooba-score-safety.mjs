
import fs from "node:fs/promises";

const source = await fs.readFile("./src/recipe-catalogue-v2.js", "utf8");

// Expose only the internal functions needed for this read-only diagnostic.
// The production file itself is not modified.
const instrumented = source
  .replace("function nutritionInputs(", "export function nutritionInputs(")
  .replace("async function loadApprovedQuantityStandards(", "export async function loadApprovedQuantityStandards(");

const moduleUrl = "data:text/javascript;base64," +
  Buffer.from(instrumented).toString("base64");

const mod = await import(moduleUrl);

const standards = [{
  ingredient_key: "salt",
  phrase: "to taste",
  min_quantity: 1,
  max_quantity: 1,
  unit: "g",
  approved: 1
}];

const env = {
  DB: {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: standards };
        }
      };
    }
  }
};

const approved = await mod.loadApprovedQuantityStandards(env);

const recipe = {
  nutrition: {},
  recipeCategory: "Roti Recipes"
};

const ingredients = [
  {
    source_text: "1 cup Whole Wheat Flour",
    name: "Whole Wheat Flour",
    key: "whole wheat flour",
    quantity: {
      quantitative: true,
      quantity: 1,
      unit: "cup",
      qualitative_phrase: null
    }
  },
  {
    source_text: "Salt to taste",
    name: "Salt",
    key: "salt",
    quantity: {
      quantitative: false,
      quantity: null,
      unit: null,
      qualitative_phrase: "to taste"
    }
  },
  {
    source_text: "Water as required",
    name: "Water",
    key: "water",
    quantity: {
      quantitative: false,
      quantity: null,
      unit: null,
      qualitative_phrase: "as required"
    }
  },
  {
    source_text: "Ghee as required",
    name: "Ghee",
    key: "ghee",
    quantity: {
      quantitative: false,
      quantity: null,
      unit: null,
      qualitative_phrase: "as required"
    }
  }
];

const result = mod.nutritionInputs(recipe, ingredients, approved);

console.log(JSON.stringify({
  approved_salt_standard: approved.get("salt|to taste"),
  score_status: result.score_status,
  sodium: result.sodium,
  approved_quantity_applications: result.approved_quantity_applications,
  missing_inputs: result.missing_inputs,
  unresolved_qualitative_ingredients: result.unresolved_qualitative_ingredients
}, null, 2));
