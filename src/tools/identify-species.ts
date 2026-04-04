// Species identification using Google Gemini vision API
// Analyzes a photo and returns structured species identification data

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ImageQuality {
  overall: "excellent" | "good" | "fair" | "poor";
  sharpness: "sharp" | "slightly_blurry" | "blurry";
  distance: "close_up" | "medium" | "far" | "too_far";
  lighting: "good" | "acceptable" | "poor";
  keyFeaturesVisible: string[];
  keyFeaturesMissing: string[];
  suggestions: string[];
  suitableForPublication: boolean;
}

export interface SpeciesIdentification {
  commonName: string;
  scientificName: string;
  taxonomy: {
    kingdom: string;
    phylum: string;
    class: string;
    order: string;
    family: string;
    genus: string;
  };
  confidence: "high" | "medium" | "low";
  conservationStatus: string;
  nativeRegions: string[];
  habitat: string;
  description: string;
  ecologicalRole: string;
  possibleAlternatives: string[];
  organismGroup:
    | "plant"
    | "fungus"
    | "bird"
    | "mammal"
    | "insect"
    | "reptile"
    | "amphibian"
    | "marine"
    | "other";
  recommendedPhotos: string[];
  imageQuality: ImageQuality;
  isWildlife: boolean;
  nonWildlifeReason?: string;
}

export interface IdentificationError {
  error: string;
  suggestion?: string;
}

export type IdentificationResult = SpeciesIdentification | IdentificationError;

const DEFAULT_MODEL = "gemini-3.1-pro-preview";

const IDENTIFICATION_PROMPT = `You are an expert naturalist and biodiversity scientist. Analyze this photo and identify the organism shown.

Return a JSON object with the following structure (no markdown, just raw JSON):

{
  "commonName": "Common name of the species",
  "scientificName": "Genus species",
  "taxonomy": {
    "kingdom": "e.g. Plantae, Animalia, Fungi",
    "phylum": "e.g. Chordata, Tracheophyta",
    "class": "e.g. Aves, Mammalia, Insecta",
    "order": "e.g. Passeriformes",
    "family": "e.g. Fringillidae",
    "genus": "taxonomic genus (e.g. Dracaena, Panthera)"
  },
  "confidence": "high | medium | low",
  "conservationStatus": "e.g. Least Concern (IUCN), Endangered, Not Evaluated",
  "nativeRegions": ["list", "of", "native", "regions"],
  "habitat": "Brief description of typical habitat",
  "description": "2-3 sentence description of the organism",
  "ecologicalRole": "Brief description of ecological role",
  "possibleAlternatives": ["Alternative species 1", "Alternative species 2"],
  "organismGroup": "plant | fungus | bird | mammal | insect | reptile | amphibian | marine | other",
  "recommendedPhotos": ["List of recommended photo angles/features for better identification"],
  "isWildlife": true or false,
  "nonWildlifeReason": "Only set if isWildlife is false. Explain why (e.g., 'domestic cat', 'human', 'building', 'food', 'pet dog')",
  "imageQuality": {
    "overall": "excellent | good | fair | poor",
    "sharpness": "sharp | slightly_blurry | blurry",
    "distance": "close_up | medium | far | too_far",
    "lighting": "good | acceptable | poor",
    "keyFeaturesVisible": ["list of key features that ARE visible in this photo"],
    "keyFeaturesMissing": ["list of key features that are NOT visible but would help"],
    "suggestions": ["specific actionable suggestions to improve photo quality"],
    "suitableForPublication": true or false
  }
}

IMAGE QUALITY EVALUATION GUIDELINES by organism group:

PLANTS:
- Key features: leaf shape and venation, flowers or fruit, bark texture, whole plant habit
- Close-up of leaves (both sides) is most important
- Flowers/fruit are critical for species-level ID
- Bark pattern matters for trees
- Missing: if only showing one part (e.g., just leaves without flowers)

BIRDS:
- Key features: face and beak shape (MOST IMPORTANT), plumage pattern, overall body shape, leg color
- Face/beak close-up is the single most diagnostic feature
- Wing pattern visible in flight or spread wings
- Too far: if bird is smaller than 1/4 of frame, mark as too_far
- Missing: if beak not visible, if plumage details are washed out

INSECTS:
- Key features: dorsal view from above, wing pattern and venation, body segmentation, antennae shape
- Close-up is essential — insects are small
- Wing pattern is critical for butterflies/moths/dragonflies
- Dorsal view preferred over side view
- Missing: if wings folded and pattern not visible, if too small to see details

FUNGI (mushrooms):
- Key features: cap shape from above, underside showing gills/pores/teeth (CRITICAL), stem shape and color, substrate (what it's growing on)
- Underside of cap is the MOST CRITICAL feature for ID — without it, confidence is always low
- Substrate (wood, soil, dung) is very important
- Missing: if underside not shown, if substrate not visible

REPTILES AND AMPHIBIANS:
- Key features: head shape and scale pattern, body pattern and coloration, scale/skin texture, tail shape
- Head shape is most diagnostic
- Scale pattern on head is critical for snakes
- Skin texture distinguishes reptiles from amphibians
- Missing: if head not clearly visible, if scale detail is blurry

MARINE ORGANISMS (fish, shells, corals, etc.):
- Key features: overall body shape, fin placement and shape, coloration pattern, shell aperture/opening
- For shells: aperture (opening) shape is critical, overall form, something for scale
- For fish: lateral line, fin count and placement, color pattern
- Missing: if shell aperture not shown, if fins not visible

WILDLIFE CLASSIFICATION:
- isWildlife: Set to TRUE for wild organisms observed in nature (wild plants, wild animals, wild fungi, etc.)
- isWildlife: Set to FALSE for:
  - Domestic animals (dogs, cats, horses, cattle, chickens, pet birds, aquarium fish, etc.)
  - Humans or human body parts
  - Buildings, vehicles, infrastructure, or man-made objects
  - Food, cooked meals, or processed products
  - Cultivated ornamental plants in pots or gardens (but wild plants growing naturally ARE wildlife)
  - Stuffed animals, toys, or artwork depicting animals
- When isWildlife is false, set nonWildlifeReason to a brief explanation
- When in doubt (e.g., feral cat, naturalized garden plant), set isWildlife to true — err on the side of inclusion

GENERAL QUALITY TIPS:
- If organism is too far away, suggest cropping the photo on their phone
- Good lighting means natural daylight, no harsh shadows, no overexposure
- Sharp means the organism (not background) is in focus
- suitableForPublication: true if overall is "excellent" or "good", false if "poor", judgment call for "fair"`;

/**
 * Identify a species from a photo using Google Gemini vision API.
 *
 * @param imageData - Base64-encoded image data (without data URL prefix)
 * @param mimeType - MIME type of the image, e.g. "image/jpeg"
 * @param apiKey - Google Gemini API key
 * @param model - Gemini model ID (defaults to "gemini-2.5-flash")
 * @param userContext - Optional notes from user (location, habitat, behavior)
 * @returns Parsed SpeciesIdentification or IdentificationError
 */
export async function identifySpecies(
  imageData: string,
  mimeType: string,
  apiKey: string,
  model?: string,
  userContext?: string
): Promise<IdentificationResult> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelId = model ?? DEFAULT_MODEL;

    const generativeModel = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const promptParts = [
      {
        inlineData: {
          mimeType,
          data: imageData,
        },
      },
      {
        text:
          IDENTIFICATION_PROMPT +
          (userContext
            ? `\n\nAdditional context from the user: ${userContext}`
            : ""),
      },
    ];

    const result = await generativeModel.generateContent(promptParts);
    const response = result.response;
    const rawText = response.text();

    try {
      const parsed = JSON.parse(rawText) as SpeciesIdentification;
      return parsed;
    } catch {
      // JSON parse failed — return a partial result with defaults
      return {
        commonName: "Unknown",
        scientificName: "Unknown",
        taxonomy: {
          kingdom: "Unknown",
          phylum: "Unknown",
          class: "Unknown",
          order: "Unknown",
          family: "Unknown",
          genus: "Unknown",
        },
        confidence: "low",
        conservationStatus: "Not Evaluated",
        nativeRegions: [],
        habitat: "Unknown",
        description: rawText,
        ecologicalRole: "Unknown",
        possibleAlternatives: [],
        organismGroup: "other",
        recommendedPhotos: [],
        isWildlife: true,
        imageQuality: {
          overall: "poor",
          sharpness: "blurry",
          distance: "too_far",
          lighting: "poor",
          keyFeaturesVisible: [],
          keyFeaturesMissing: [],
          suggestions: ["Please try a clearer photo closer to the organism"],
          suitableForPublication: false,
        },
      };
    }
  } catch (err) {
    // API error
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Failed to analyze image: ${message}`,
      suggestion: "Try a clearer photo",
    };
  }
}
