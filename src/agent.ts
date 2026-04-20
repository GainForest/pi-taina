// Pi agent integration layer for Pi-Tainá
// Manages per-user agent sessions and registers Tainá's custom tools with the Pi SDK.

import { Type } from "@sinclair/typebox";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { loadEnvConfig, type EnvConfig } from "./env.js";
import type { IncomingMessage } from "./telegram.js";
import { identifySpecies } from "./tools/identify-species.js";
import { publishOccurrence, type TelegramUser } from "./tools/publish-occurrence.js";
import { publishMeasurement } from "./tools/publish-measurement.js";
import { geocodeLocation } from "./tools/geocode-location.js";
import { createGeostore, getTreeCoverExtent, getTreeCoverLoss, getFireAlerts, getDeforestationAlerts, reverseGeocodeAdmin } from "./tools/gfw-api.js";
import { generateTreeCoverLossChart, buildGfwMapUrl } from "./tools/gfw-chart.js";
import { transcribeVoice } from "./tools/transcribe-voice.js";
import { queryHyperindex } from "./tools/query-hyperindex.js";
import { createHypercert } from "./tools/create-hypercert.js";
import { createOrganization } from "./tools/create-organization.js";
import { buildPolygonWebAppUrl } from "./tools/build-polygon-webapp-url.js";
import { attachObservations } from "./tools/attach-observations.js";
import { getWeather } from "./tools/weather.js";
import { getSpeciesNearLocation } from './tools/inaturalist-api.js';
import { detectAudioMothSDCards } from './tools/detect-audiomoth-sd.js';
import { uploadAudioMothSD } from './tools/ingest-audiomoth-sd.js';
import {
  parsePolygonWebAppPayload,
  isLikelyPolygonPayloadText,
  type ParsePolygonWebAppPayloadError,
  type PolygonPoint,
} from "./tools/parse-polygon-webapp-payload.js";
import { ensurePreferredLanguage, getPreferredLanguage, setPreferredLanguage } from "./user-language.js";

// ─── Per-session state ────────────────────────────────────────────────────────

interface SessionState {
  session: AgentSession;
  photos: Array<{ data: Buffer; mimeType: string }>;
  currentUser?: TelegramUser;
  pendingChart?: Buffer;
  pendingAudio?: { data: Buffer; filename: string; caption: string };
  pendingPolygonWebApp?: {
    launchMessageText: string;
    buttonLabel: string;
    webAppUrl: string;
  };
  organizationPolygonPoints?: PolygonPoint[];
  currentTurnId?: number;
  currentTurnHasPhoto?: boolean;
  currentTurnHasUserContext?: boolean;
  latestIdentificationTurnId?: number;
  latestIdentificationAgreementTurnId?: number;
  latestPublishConfirmationTurnId?: number;
  latestPublishedOccurrence?: {
    uri: string;
    occurrenceID: string;
    scientificName: string;
    kingdom?: string;
  };
}

// ─── Module-level singletons ──────────────────────────────────────────────────

// Sessions keyed by Telegram user ID
const sessions = new Map<number, SessionState>();

// Lazily initialized config, authStorage, modelRegistry
let _config: EnvConfig | null = null;
let _authStorage: AuthStorage | null = null;
let _modelRegistry: ModelRegistry | null = null;

function getConfig(): EnvConfig {
  if (!_config) {
    _config = loadEnvConfig();
  }
  return _config;
}

function getAuthStorage(): AuthStorage {
  if (!_authStorage) {
    const config = getConfig();
    _authStorage = AuthStorage.create();
    // Set Google Gemini as the default provider (required)
    _authStorage.setRuntimeApiKey("google", config.geminiApiKey);
    // Set optional providers if configured
    if (config.anthropicApiKey) {
      _authStorage.setRuntimeApiKey("anthropic", config.anthropicApiKey);
    }
    if (config.openaiApiKey) {
      _authStorage.setRuntimeApiKey("openai", config.openaiApiKey);
    }
  }
  return _authStorage;
}

function getModelRegistry(): ModelRegistry {
  if (!_modelRegistry) {
    _modelRegistry = new ModelRegistry(getAuthStorage());
  }
  return _modelRegistry;
}

export type TelegramPolygonWebAppDataSuccess = {
  ok: true;
  points: PolygonPoint[];
};

export type TelegramPolygonWebAppDataFailure = {
  ok: false;
  error: ParsePolygonWebAppPayloadError;
  rawPayload: string;
};

export type TelegramPolygonWebAppDataResult =
  | TelegramPolygonWebAppDataSuccess
  | TelegramPolygonWebAppDataFailure;

export function parseTelegramPolygonWebAppData(rawPayload: string): TelegramPolygonWebAppDataResult {
  const parsed = parsePolygonWebAppPayload(rawPayload);

  if (parsed.ok) {
    return {
      ok: true,
      points: parsed.points.map((point) => ({
        lng: point.lng,
        lat: point.lat,
      })),
    };
  }

  return {
    ok: false,
    error: parsed.error,
    rawPayload,
  };
}

export function setValidatedOrganizationPolygonPoints(
  userId: number,
  polygonPoints: PolygonPoint[] | undefined,
): void {
  const state = sessions.get(userId);
  if (!state) {
    return;
  }

  state.organizationPolygonPoints = polygonPoints?.map((point) => ({
    lng: point.lng,
    lat: point.lat,
  }));
}

export function processTelegramPolygonWebAppData(
  userId: number,
  rawPayload: string,
): TelegramPolygonWebAppDataResult {
  const parsed = parseTelegramPolygonWebAppData(rawPayload);

  if (parsed.ok) {
    setValidatedOrganizationPolygonPoints(userId, parsed.points);
  }

  return parsed;
}

export function getOrganizationPolygonPoints(userId: number): PolygonPoint[] | undefined {
  return sessions.get(userId)?.organizationPolygonPoints;
}

export function resolveOrganizationPolygonPoints(
  userId: number,
  explicitPolygonPoints?: PolygonPoint[],
): PolygonPoint[] | undefined {
  return explicitPolygonPoints ?? getOrganizationPolygonPoints(userId);
}

export function clearOrganizationPolygonPoints(userId: number): void {
  const state = sessions.get(userId);
  if (state) {
    state.organizationPolygonPoints = undefined;
  }
}

function isExplicitPublishConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return false;
  }

  if (/^(yes|yeah|yep|sure|ok|okay|please|go ahead|do it)$/i.test(normalized)) {
    return true;
  }

  return /\b(publish|record|save)( this| it| the observation| the record)?\b/i.test(normalized) ||
    /\bgo ahead\b/i.test(normalized);
}

function isExplicitIdentificationAgreement(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return false;
  }

  return /\b(sounds? right|looks? right|seems? right|that'?s right|that'?s it|correct|exactly|yep|yeah|yes)\b/i.test(normalized) ||
    /\b(it'?s|it is) (right|correct|good)\b/i.test(normalized);
}

function hasMeaningfulUserContext(text?: string): boolean {
  return Boolean(text && text.trim().length > 0);
}

function detectExplicitLanguagePreference(text: string): string | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }

  const switchers = [
    { language: "en", patterns: [/\b(speak|reply|respond|talk|write) in english\b/, /\bswitch to english\b/, /\benglish please\b/] },
    { language: "es", patterns: [/\b(speak|reply|respond|talk|write) in spanish\b/, /\bhabla en espa(?:ñ|n)ol\b/, /\bresponde en espa(?:ñ|n)ol\b/, /\bcambia a espa(?:ñ|n)ol\b/, /\bespanol por favor\b/] },
    { language: "pt", patterns: [/\b(speak|reply|respond|talk|write) in portuguese\b/, /\bfale em portugu(?:ê|e)s\b/, /\bresponda em portugu(?:ê|e)s\b/, /\bmude para portugu(?:ê|e)s\b/] },
  ] as const;

  for (const candidate of switchers) {
    if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
      return candidate.language;
    }
  }

  return undefined;
}

function buildPolygonWebAppRecoveryMessage(error: ParsePolygonWebAppPayloadError): string {
  return `I couldn't recover that boundary yet. ${error.message} If the Web App didn't hand it back automatically, paste the fallback boundary data into chat and I'll try again.`;
}

// ─── Custom tool definitions ──────────────────────────────────────────────────

// Schema definitions for custom tools
const identifySpeciesSchema = Type.Object({
  userContext: Type.Optional(
    Type.String({
      description: "Optional additional context from the user (location, habitat, behavior, etc.)",
    })
  ),
});

const publishOccurrenceSchema = Type.Object({
  scientificName: Type.String({ description: "Scientific name of the species" }),
  vernacularName: Type.Optional(Type.String({ description: "Common/vernacular name" })),
  decimalLatitude: Type.Optional(Type.Number({ description: "GPS latitude" })),
  decimalLongitude: Type.Optional(Type.Number({ description: "GPS longitude" })),
  locality: Type.Optional(Type.String({ description: "Text description of the location" })),
  country: Type.Optional(Type.String({ description: "Country name" })),
  countryCode: Type.Optional(Type.String({ description: "ISO 3166-1 alpha-2 country code" })),
  habitat: Type.Optional(Type.String({ description: "Habitat description" })),
  behavior: Type.Optional(Type.String({ description: "Observed behavior" })),
  individualCount: Type.Optional(Type.Number({ description: "Number of individuals observed" })),
  occurrenceRemarks: Type.Optional(Type.String({ description: "Additional remarks about the occurrence" })),
  eventDate: Type.Optional(Type.String({ description: "Date of observation in ISO 8601 format" })),
  // Taxonomy (all optional strings)
  kingdom: Type.Optional(Type.String({ description: 'Taxonomic kingdom (e.g. Animalia, Plantae, Fungi)' })),
  phylum: Type.Optional(Type.String({ description: 'Taxonomic phylum (e.g. Chordata, Tracheophyta)' })),
  class_: Type.Optional(Type.String({ description: 'Taxonomic class (e.g. Aves, Mammalia). Named class_ to avoid JS reserved word.' })),
  order: Type.Optional(Type.String({ description: 'Taxonomic order (e.g. Passeriformes)' })),
  family: Type.Optional(Type.String({ description: 'Taxonomic family (e.g. Fringillidae)' })),
  genus: Type.Optional(Type.String({ description: 'Taxonomic genus' })),
  specificEpithet: Type.Optional(Type.String({ description: 'Species epithet (second part of binomial name)' })),
  taxonRank: Type.Optional(Type.String({ description: 'Taxonomic rank: species, genus, family, etc.' })),
  // Extended location
  stateProvince: Type.Optional(Type.String({ description: 'State or province name' })),
  municipality: Type.Optional(Type.String({ description: 'Municipality name' })),
});

const measurementEntrySchema = Type.Object({
  measurementType: Type.String({ description: "The nature of the measurement (e.g. 'soil pH', 'canopy cover')" }),
  measurementValue: Type.String({ description: "The value (e.g. '6.5', 'present')" }),
  measurementUnit: Type.Optional(Type.String({ description: "Unit (e.g. 'cm', 'm', 'kg', '%')" })),
  measurementMethod: Type.Optional(Type.String({ description: "Method or instrument used" })),
  measurementRemarks: Type.Optional(Type.String({ description: "Notes about this measurement" })),
});

const publishMeasurementSchema = Type.Object({
  measurementType: Type.Union([
    Type.Literal('flora'),
    Type.Literal('fauna'),
    Type.Literal('generic'),
  ], { description: "Organism type: 'flora' for plants/trees/corals, 'fauna' for animals, 'generic' for flexible key-value measurements" }),

  // ── Flora fields (use when measurementType='flora') ──────────────────────
  dbh: Type.Optional(Type.String({ description: "[flora] Diameter at breast height in centimeters" })),
  girth: Type.Optional(Type.String({ description: "[flora] Trunk circumference at breast height in centimeters" })),
  basalDiameter: Type.Optional(Type.String({ description: "[flora] Diameter at ground level in centimeters (shrubs)" })),
  stemCount: Type.Optional(Type.Number({ description: "[flora] Number of stems for multi-stemmed individuals" })),
  totalHeight: Type.Optional(Type.String({ description: "[flora] Total height in meters" })),
  heightToFirstBranch: Type.Optional(Type.String({ description: "[flora] Height to first major branch (bole length) in meters" })),
  crownDiameter: Type.Optional(Type.String({ description: "[flora] Average crown diameter in meters" })),
  crownPosition: Type.Optional(Type.String({ description: "[flora] Canopy position: dominant, codominant, intermediate, suppressed, emergent" })),
  abovegroundBiomass: Type.Optional(Type.String({ description: "[flora] Aboveground biomass in kilograms (from allometric equations)" })),
  carbonContent: Type.Optional(Type.String({ description: "[flora] Carbon stored in kilograms of carbon" })),
  woodDensity: Type.Optional(Type.String({ description: "[flora] Specific gravity in g/cm³" })),
  biomassAllometricEquation: Type.Optional(Type.String({ description: "[flora] Allometric equation used (e.g. 'Chave et al. 2014')" })),
  vitalityStatus: Type.Optional(Type.String({ description: "[flora] alive, dead-standing, dead-fallen, moribund, missing, unknown" })),
  growthForm: Type.Optional(Type.String({ description: "[flora] tree, shrub, liana, palm, tree-fern, herb, grass, bamboo, epiphyte, other" })),
  floweringStatus: Type.Optional(Type.String({ description: "[flora] none, budding, flowering, fruiting, senescing" })),
  phenology: Type.Optional(Type.String({ description: "[flora] leafless, flush, full-leaf, senescing, dormant" })),
  damageType: Type.Optional(Type.String({ description: "[flora] Type of damage observed (e.g. 'broken crown', 'uprooted')" })),
  damageCause: Type.Optional(Type.String({ description: "[flora] wind, lightning, fire, drought, flood, animal, human, disease, pest, unknown" })),

  // ── Fauna fields (use when measurementType='fauna') ───────────────────────
  bodyMass: Type.Optional(Type.String({ description: "[fauna] Body mass in grams" })),
  totalLength: Type.Optional(Type.String({ description: "[fauna] Total body length tip-to-tail in millimeters" })),
  headBodyLength: Type.Optional(Type.String({ description: "[fauna] Head-body length excluding tail in millimeters" })),
  tailLength: Type.Optional(Type.String({ description: "[fauna] Tail length in millimeters" })),
  wingLength: Type.Optional(Type.String({ description: "[fauna/birds] Flattened wing chord in millimeters" })),
  wingspan: Type.Optional(Type.String({ description: "[fauna/birds,bats] Full wingspan tip-to-tip in millimeters" })),
  billLength: Type.Optional(Type.String({ description: "[fauna/birds] Culmen length in millimeters" })),
  tarsusLength: Type.Optional(Type.String({ description: "[fauna/birds] Tarsometatarsus length in millimeters" })),
  fatScore: Type.Optional(Type.String({ description: "[fauna/birds] Subcutaneous fat score 0-8" })),
  forearmLength: Type.Optional(Type.String({ description: "[fauna/bats] Forearm length in millimeters" })),
  snoutVentLength: Type.Optional(Type.String({ description: "[fauna/reptiles,amphibians] Snout-vent length in millimeters" })),
  carapaceLength: Type.Optional(Type.String({ description: "[fauna/turtles] Straight carapace length in millimeters" })),
  groupSize: Type.Optional(Type.Number({ description: "[fauna] Total size of social group observed" })),
  clutchSize: Type.Optional(Type.Number({ description: "[fauna/birds,reptiles] Number of eggs in nest" })),
  litterSize: Type.Optional(Type.Number({ description: "[fauna/mammals] Number of offspring in litter" })),
  bodyConditionScore: Type.Optional(Type.String({ description: "[fauna] Body condition score (scale varies by taxon)" })),
  injuryPresent: Type.Optional(Type.Boolean({ description: "[fauna] Whether visible injuries exist" })),
  injuryDescription: Type.Optional(Type.String({ description: "[fauna] Description of injuries" })),
  tagId: Type.Optional(Type.String({ description: "[fauna] Ear/flipper/wing tag identifier" })),
  tagType: Type.Optional(Type.String({ description: "[fauna] ear-tag, flipper-tag, wing-tag, leg-band, gps-collar, pit-tag, other" })),
  bandNumber: Type.Optional(Type.String({ description: "[fauna/birds] Metal or color band/ring number" })),
  recaptureStatus: Type.Optional(Type.String({ description: "[fauna] new, recapture, unknown" })),

  // ── Generic measurements (use when measurementType='generic') ─────────────
  genericMeasurements: Type.Optional(Type.Array(measurementEntrySchema, {
    description: "[generic] Array of key-value measurement entries. Required when measurementType='generic'.",
  })),

  // ── Common optional metadata ───────────────────────────────────────────────
  measurementMethod: Type.Optional(Type.String({ description: "General protocol used (e.g. 'ForestGEO standard protocol')" })),
  measurementDate: Type.Optional(Type.String({ description: "Date measurements were taken (ISO 8601)" })),
  measurementRemarks: Type.Optional(Type.String({ description: "Notes about the measurement session" })),
});

const geocodeLocationSchema = Type.Object({
  query: Type.String({ description: "Location name or description to geocode" }),
  countryCode: Type.Optional(
    Type.String({ description: "ISO 3166-1 alpha-2 country code to narrow results" })
  ),
});

const clearPhotosSchema = Type.Object({});

const forestReportSchema = Type.Object({
  latitude: Type.Number({ description: "GPS latitude of the location to analyze" }),
  longitude: Type.Number({ description: "GPS longitude of the location to analyze" }),
  radiusKm: Type.Optional(Type.Number({ description: "Fallback radius in km if admin boundary lookup fails. Default 10. Usually not needed — the tool automatically uses the municipality boundary." })),
  chartTitle: Type.Optional(Type.String({ description: "Chart title in the user's language. E.g. 'Texcoco — Pérdida de Bosque' for Spanish. If not provided, defaults to '<area> — Tree Cover Loss'." })),
  chartAxisY: Type.Optional(Type.String({ description: "Y-axis label for the chart in the user's language. E.g. 'Hectáreas' for Spanish, 'Hectares' for English/Portuguese." })),
  chartAxisX: Type.Optional(Type.String({ description: "X-axis label for the chart in the user's language. E.g. 'Año' for Spanish, 'Year' for English, 'Ano' for Portuguese." })),
});

const queryHyperindexSchema = Type.Object({
  type: Type.Union([
    Type.Literal('occurrences'),
    Type.Literal('hypercerts'),
    Type.Literal('search'),
  ], { description: 'What to query: occurrences (biodiversity records), hypercerts (impact certificates), or search (free-text across all)' }),
  searchQuery: Type.Optional(Type.String({ description: 'Free-text search query (required for type=search)' })),
  did: Type.Optional(Type.String({ description: 'Filter by community DID (ATProto decentralized identifier). ONLY use the community DID here — never invent DIDs like did:telegram:xxx. To find a specific user\'s records, query with the community DID and filter results by the recordedBy field which contains the Telegram user name and ID.' })),
  recordedByContains: Type.Optional(Type.String({ description: 'Filter occurrences by who recorded them. Use the Telegram ID pattern "tg:<telegram_user_id>" to find a specific user\'s records. The recordedBy field contains text like "Diego Rivera (@username, tg:123456)", so passing "tg:123456" will match. This is a server-side contains filter — much faster than client-side filtering.' })),
  limit: Type.Optional(Type.Number({ description: 'Max results to return (default 10, max 20)' })),
});

const createHypercertSchema = Type.Object({
  title: Type.String({ description: 'Title of the impact claim (e.g. "Community Reforestation Project")' }),
  shortDescription: Type.String({ description: 'Brief description of the impact work (max 300 chars)' }),
  description: Type.Optional(Type.String({ description: 'Longer description of the work and its impact (max 3000 chars)' })),
  startDate: Type.Optional(Type.String({ description: 'When the work started (ISO 8601 date)' })),
  endDate: Type.Optional(Type.String({ description: 'When the work ended or will end (ISO 8601 date)' })),
  workScope: Type.Optional(Type.String({ description: 'Comma-separated work scope tags (e.g. "reforestation, community building, carbon sequestration")' })),
  latitude: Type.Optional(Type.Number({ description: 'GPS latitude of the project location' })),
  longitude: Type.Optional(Type.Number({ description: 'GPS longitude of the project location' })),
  locationName: Type.Optional(Type.String({ description: 'Name of the project location' })),
});

const createOrganizationSchema = Type.Object({
  handle: Type.String({ description: "Desired handle for the org (without .climateai.org). E.g. \"cabarete-sostenible\"" }),
  displayName: Type.String({ description: "Organization display name" }),
  description: Type.String({ description: "About the organization (a few sentences)" }),
  organizationType: Type.Array(Type.String(), { description: "Organization types: nonprofit, business, government, academic, conservation, community, indigenous, other" }),
  website: Type.Optional(Type.String({ description: "Organization website URL" })),
  foundedDate: Type.Optional(Type.String({ description: "Year or date founded (ISO 8601)" })),
  country: Type.Optional(Type.String({ description: "Country where the org is based" })),
  urls: Type.Optional(Type.Array(Type.Object({
    url: Type.String({ description: "URL" }),
    label: Type.Optional(Type.String({ description: "Label for the URL" })),
  }), { description: "Social media and other URLs" })),
  objectives: Type.Optional(Type.Array(Type.String(), { description: "Main goals/objectives" })),
  latitude: Type.Optional(Type.Number({ description: "GPS latitude of org location" })),
  longitude: Type.Optional(Type.Number({ description: "GPS longitude of org location" })),
  locationName: Type.Optional(Type.String({ description: "Name of the org location" })),
  polygonPoints: Type.Optional(Type.Array(
    Type.Object({
      lng: Type.Number({ description: "Longitude" }),
      lat: Type.Number({ description: "Latitude" }),
    }),
    { description: "Polygon points for the organization boundary" },
  )),
  memberName: Type.Optional(Type.String({ description: "Name of the first member (person creating the org)" })),
  memberRole: Type.Optional(Type.String({ description: "Role of the first member (e.g. Director, Coordinator)" })),
  memberEmail: Type.Optional(Type.String({ description: "Email of the first member" })),
  memberLanguages: Type.Optional(Type.Array(Type.String(), { description: "Languages the first member speaks" })),
  memberExpertise: Type.Optional(Type.Array(Type.String(), { description: "Areas of expertise of the first member" })),
});

const attachObservationsSchema = Type.Object({
  hypercertUri: Type.String({ description: 'AT URI of the hypercert to attach observations to (from create_hypercert result)' }),
  hypercertCid: Type.String({ description: 'CID of the hypercert record (from create_hypercert result)' }),
  sinceDate: Type.Optional(Type.String({ description: 'Only include observations recorded after this date (ISO 8601)' })),
  limit: Type.Optional(Type.Number({ description: 'Max observations to attach (default 100, max 200)' })),
});

const generateChimeSchema = Type.Object({
  latitude: Type.Number({ description: 'GPS latitude for the AudioMoth deployment' }),
  longitude: Type.Number({ description: 'GPS longitude for the AudioMoth deployment' }),
  deploymentId: Type.Optional(Type.String({ description: '16-character hex deployment ID. Random if omitted.' })),
});

const weatherReportSchema = Type.Object({
  latitude: Type.Number({ description: 'GPS latitude of the location to check weather for' }),
  longitude: Type.Number({ description: 'GPS longitude of the location to check weather for' }),
});

const nearbySpeciesSchema = Type.Object({
  latitude: Type.Number({ description: 'GPS latitude of the location to search around' }),
  longitude: Type.Number({ description: 'GPS longitude of the location to search around' }),
  radiusKm: Type.Optional(Type.Number({ description: 'Search radius in km (default 50, max 500)' })),
  limit: Type.Optional(Type.Number({ description: 'Max species to return (default 20, max 50)' })),
});

const detectAudioMothSDSchema = Type.Object({});

const uploadAudioMothSDSchema = Type.Object({
  folder: Type.String({ description: "Absolute path to the SD card folder to ingest (from detect_audiomoth_sd result)" }),
  deploymentUri: Type.Optional(Type.String({ description: "AT-URI of the deployment to associate recordings with. Only provide when the user has explicitly chosen from a list returned by a previous call." })),
});

const requestPolygonWebAppSchema = Type.Object({
  buttonLabel: Type.Optional(Type.String({ description: 'Optional label for the Telegram Web App button' })),
  message: Type.Optional(Type.String({ description: 'Optional launch message to send with the Web App button' })),
  polygonPoints: Type.Optional(Type.Array(
    Type.Object({
      lng: Type.Number({ description: 'Longitude' }),
      lat: Type.Number({ description: 'Latitude' }),
    }),
    { description: 'Optional polygon points to preload into the Web App' },
  )),
});

/**
 * Build the three custom tools for a given session state reference.
 * The state reference is a mutable object so tools always see the latest photo/user.
 */
function buildCustomTools(stateRef: { state: SessionState }): ToolDefinition[] {
  const config = getConfig();

  const identifySpeciesTool: ToolDefinition<typeof identifySpeciesSchema> = {
    name: "identify_species",
    label: "Identify Species",
    description:
      "Identify a species from a photo that the user sent. Call this when the user sends a photo of a plant, animal, fungus, or other organism.",
    parameters: identifySpeciesSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const photos = stateRef.state.photos;
      const photo = photos.length > 0 ? photos[photos.length - 1] : undefined;
      if (!photo) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No photo available",
                suggestion: "Ask the user to send a photo first",
              }),
            },
          ],
          details: {},
        };
      }

      const isFreshPhotoOnlyMessage =
        stateRef.state.currentTurnHasPhoto === true && stateRef.state.currentTurnHasUserContext !== true;

      if (isFreshPhotoOnlyMessage) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Community context required before identification",
                code: "identify_context_required",
                suggestion:
                  "Ask the user what they already know, what they noticed, or any story/context about the organism, or ask permission to try the ID next.",
              }),
            },
          ],
          details: {},
        };
      }

      const imageData = photo.data.toString("base64");
      const result = await identifySpecies(
        imageData,
        photo.mimeType,
        config.geminiApiKey,
        config.speciesIdModel,
        params.userContext
      );

      stateRef.state.latestIdentificationTurnId = stateRef.state.currentTurnId;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  };

  const publishOccurrenceTool: ToolDefinition<typeof publishOccurrenceSchema> = {
    name: "publish_occurrence",
    label: "Publish Occurrence",
    description:
      "Publish a biodiversity occurrence record to the community ATProto PDS. Use after identifying a species when the user confirms they want to publish.",
    parameters: publishOccurrenceSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const photos = stateRef.state.photos;
      const user = stateRef.state.currentUser;

      if (!user) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No user context available" }),
            },
          ],
          details: {},
        };
      }

      const latestIdentificationTurnId = stateRef.state.latestIdentificationTurnId ?? 0;
      const latestIdentificationAgreementTurnId = stateRef.state.latestIdentificationAgreementTurnId ?? 0;
      const latestConfirmationTurnId = stateRef.state.latestPublishConfirmationTurnId ?? 0;

      if (!latestIdentificationTurnId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Identification required before publishing",
                code: "identification_required",
                suggestion: "Identify the species first, then ask whether it sounds right before publishing.",
              }),
            },
          ],
          details: {},
        };
      }

      if (!latestIdentificationAgreementTurnId || latestIdentificationAgreementTurnId <= latestIdentificationTurnId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Identification agreement required",
                code: "identification_agreement_required",
                suggestion: "Ask whether the identification sounds right before publishing.",
              }),
            },
          ],
          details: {},
        };
      }

      if (!latestConfirmationTurnId || latestConfirmationTurnId <= latestIdentificationAgreementTurnId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Publish confirmation required",
                code: "publish_confirmation_required",
                suggestion: "Ask whether the user wants to publish the record in a later turn before calling publish_occurrence.",
              }),
            },
          ],
          details: {},
        };
      }

      const result = await publishOccurrence({
        scientificName: params.scientificName,
        vernacularName: params.vernacularName,
        decimalLatitude: params.decimalLatitude,
        decimalLongitude: params.decimalLongitude,
        locality: params.locality,
        country: params.country,
        countryCode: params.countryCode,
        habitat: params.habitat,
        behavior: params.behavior,
        individualCount: params.individualCount,
        occurrenceRemarks: params.occurrenceRemarks,
        eventDate: params.eventDate,
        kingdom: params.kingdom,
        phylum: params.phylum,
        class_: params.class_,
        order: params.order,
        family: params.family,
        genus: params.genus,
        specificEpithet: params.specificEpithet,
        taxonRank: params.taxonRank,
        stateProvince: params.stateProvince,
        municipality: params.municipality,
        images: photos.length > 0 ? photos : undefined,
        submittedBy: user,
      });

      // Clear photos and store occurrence ref after a successful publish
      if (result.success) {
        stateRef.state.photos = [];
        stateRef.state.latestPublishedOccurrence = {
          uri: result.uri,
          occurrenceID: result.occurrenceID,
          scientificName: result.scientificName,
          kingdom: params.kingdom,
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...result,
            ...(result.success ? {
              suggestMeasurements: true,
              measurementHint: "Ask the user if they want to add field measurements for this organism (e.g. height, trunk diameter, biomass for plants; body mass, wing length, health score for animals). Call publish_measurement if they say yes.",
            } : {}),
          }),
        }],
        details: {},
      };
    },
  };

  const publishMeasurementTool: ToolDefinition<typeof publishMeasurementSchema> = {
    name: "publish_measurement",
    label: "Publish Measurement",
    description:
      "Publish field measurements for the most recently recorded occurrence in this session (app.gainforest.dwc.measurement). " +
      "Call after publish_occurrence when the user wants to add quantitative data: morphometrics, biomass, health scores, individual marks, etc. " +
      "Use measurementType='flora' for plants/trees/corals, 'fauna' for animals, 'generic' for anything else. " +
      "Only pass the fields that are actually known — omit the rest.",
    parameters: publishMeasurementSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const user = stateRef.state.currentUser;
      const lastOccurrence = stateRef.state.latestPublishedOccurrence;

      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "No user context available" }) }],
          details: {},
        };
      }

      if (!lastOccurrence) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: "No occurrence published yet in this session",
              code: "occurrence_required",
              suggestion: "Publish an occurrence first with publish_occurrence, then call publish_measurement.",
            }),
          }],
          details: {},
        };
      }

      // Build the typed result object from flat schema params
      let result: Parameters<typeof publishMeasurement>[0]['result'];

      if (params.measurementType === 'flora') {
        result = {
          type: 'flora',
          data: {
            dbh: params.dbh,
            girth: params.girth,
            basalDiameter: params.basalDiameter,
            stemCount: params.stemCount,
            totalHeight: params.totalHeight,
            heightToFirstBranch: params.heightToFirstBranch,
            crownDiameter: params.crownDiameter,
            crownPosition: params.crownPosition,
            abovegroundBiomass: params.abovegroundBiomass,
            carbonContent: params.carbonContent,
            woodDensity: params.woodDensity,
            biomassAllometricEquation: params.biomassAllometricEquation,
            vitalityStatus: params.vitalityStatus,
            growthForm: params.growthForm,
            floweringStatus: params.floweringStatus,
            phenology: params.phenology,
            damageType: params.damageType,
            damageCause: params.damageCause,
          },
        };
      } else if (params.measurementType === 'fauna') {
        result = {
          type: 'fauna',
          data: {
            bodyMass: params.bodyMass,
            totalLength: params.totalLength,
            headBodyLength: params.headBodyLength,
            tailLength: params.tailLength,
            wingLength: params.wingLength,
            wingspan: params.wingspan,
            billLength: params.billLength,
            tarsusLength: params.tarsusLength,
            fatScore: params.fatScore,
            forearmLength: params.forearmLength,
            snoutVentLength: params.snoutVentLength,
            carapaceLength: params.carapaceLength,
            groupSize: params.groupSize,
            clutchSize: params.clutchSize,
            litterSize: params.litterSize,
            bodyConditionScore: params.bodyConditionScore,
            injuryPresent: params.injuryPresent,
            injuryDescription: params.injuryDescription,
            tagId: params.tagId,
            tagType: params.tagType,
            bandNumber: params.bandNumber,
            recaptureStatus: params.recaptureStatus,
          },
        };
      } else {
        result = {
          type: 'generic',
          measurements: params.genericMeasurements ?? [],
        };
      }

      const response = await publishMeasurement({
        occurrenceRef: lastOccurrence.uri,
        occurrenceID: lastOccurrence.occurrenceID,
        result,
        measurementDate: params.measurementDate,
        measurementMethod: params.measurementMethod,
        measurementRemarks: params.measurementRemarks,
        submittedBy: user,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response) }],
        details: {},
      };
    },
  };

  const geocodeLocationTool: ToolDefinition<typeof geocodeLocationSchema> = {
    name: "geocode_location",
    label: "Geocode Location",
    description:
      "Convert a text location description to GPS coordinates. Use when the user provides a place name instead of GPS coordinates.",
    parameters: geocodeLocationSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = await geocodeLocation(params.query, params.countryCode);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  };

  const clearPhotosTool: ToolDefinition<typeof clearPhotosSchema> = {
    name: "clear_photos",
    label: "Clear Photos",
    description:
      "Clear all accumulated photos for the current observation. Use when the user wants to start over or discard photos.",
    parameters: clearPhotosSchema,
    execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
      const count = stateRef.state.photos.length;
      stateRef.state.photos = [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Cleared ${count} photo(s). Ready for a new observation.`,
            }),
          },
        ],
        details: {},
      };
    },
  };

  const forestReportTool: ToolDefinition<typeof forestReportSchema> = {
    name: "forest_report",
    label: "Forest Report",
    description:
      "Get a forest health report for a location: tree cover extent, historical loss/gain, and recent deforestation and fire alerts. Use when the user asks about forest health, deforestation, tree cover, or fires near a location.",
    parameters: forestReportSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      if (!config.gfwDataApiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "GFW not configured" }),
            },
          ],
          details: {},
        };
      }

      // Step 1: Reverse geocode to admin boundaries
      const adminResult = await reverseGeocodeAdmin(config.gfwDataApiKey, params.latitude, params.longitude);

      let geostoreId: string;
      let geostoreOrigin: string;
      let areaName: string;
      let areaHa: number;
      let treeCoverExtent: Awaited<ReturnType<typeof getTreeCoverExtent>> | undefined;

      if (!("error" in adminResult) && adminResult.boundaries.length > 0) {
        // Use municipality if available, else state, else country
        const boundary = adminResult.municipality || adminResult.state || adminResult.country!;
        geostoreId = boundary.geostoreId;
        geostoreOrigin = "gfw";
        areaName = boundary.municipality
          ? `${boundary.municipality}, ${boundary.state || boundary.country}`
          : boundary.state
          ? `${boundary.state}, ${boundary.country}`
          : boundary.country;
        areaHa = boundary.areaHa;
        // Skip getTreeCoverExtent for gfw geostores (only works with RW geostores)
        treeCoverExtent = undefined;
      } else {
        // Fallback: radius-based bounding box
        const geostore = await createGeostore(params.latitude, params.longitude, params.radiusKm ?? 10);
        if ("error" in geostore) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(geostore) }],
            details: {},
          };
        }
        geostoreId = geostore.hash;
        geostoreOrigin = "rw";
        areaName = `${params.radiusKm ?? 10}km radius`;
        areaHa = geostore.areaHa;
        treeCoverExtent = await getTreeCoverExtent(geostoreId);
      }

      // Step 2: Query in parallel
      const [treeCoverLoss, fireAlerts, deforestationAlerts] = await Promise.all([
        getTreeCoverLoss(config.gfwDataApiKey, geostoreId, geostoreOrigin),
        getFireAlerts(config.gfwDataApiKey, geostoreId, 7, geostoreOrigin),
        getDeforestationAlerts(config.gfwDataApiKey, geostoreId, 30, geostoreOrigin),
      ]);

      // Step 3: Build GFW map URL
      const mapUrl = buildGfwMapUrl(params.latitude, params.longitude);

      // Generate chart image (best-effort, non-blocking)
      let chartImage: Buffer | null = null;
      if ("years" in treeCoverLoss && treeCoverLoss.years) {
        const chartTitleText = params.chartTitle || `${areaName} — Tree Cover Loss`;
        chartImage = await generateTreeCoverLossChart(
          treeCoverLoss.years,
          chartTitleText,
          params.chartAxisY,
          params.chartAxisX,
        );
      }

      // Store chart for Telegram layer to send as photo
      if (chartImage) {
        stateRef.state.pendingChart = chartImage;
      }

      const result = {
        areaName,
        areaHa,
        adminBoundaries: !("error" in adminResult) ? adminResult : undefined,
        treeCoverExtent,
        treeCoverLoss,
        fireAlerts,
        deforestationAlerts,
        mapUrl,
        hasChart: chartImage !== null,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  };

  const queryHyperindexTool: ToolDefinition<typeof queryHyperindexSchema> = {
    name: 'query_hyperindex',
    label: 'Query Hyperindex',
    description: 'Search and browse biodiversity records and hypercerts on the Hypersphere network. Use to find species observations, impact certificates, or search across all records.',
    parameters: queryHyperindexSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = await queryHyperindex({
        type: params.type,
        searchQuery: params.searchQuery,
        did: params.did,
        recordedByContains: params.recordedByContains,
        limit: params.limit,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} };
    },
  };

  const createHypercertTool: ToolDefinition<typeof createHypercertSchema> = {
    name: 'create_hypercert',
    label: 'Create Hypercert',
    description: 'Create a hypercert (impact certificate) to record conservation or community work. Use when the user wants to document a project, initiative, or impact claim — not a species observation.',
    parameters: createHypercertSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const user = stateRef.state.currentUser;
      if (!user) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'No user context' }) }], details: {} };
      }
      const photos = stateRef.state.photos;
      const result = await createHypercert({
        title: params.title,
        shortDescription: params.shortDescription,
        description: params.description,
        startDate: params.startDate,
        endDate: params.endDate,
        workScope: params.workScope,
        decimalLatitude: params.latitude,
        decimalLongitude: params.longitude,
        locationName: params.locationName,
        image: photos.length > 0 ? photos[photos.length - 1] : undefined,
        submittedBy: user,
      });
      if (result.success) stateRef.state.photos = [];
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} };
    },
  };

  const createOrganizationTool: ToolDefinition<typeof createOrganizationSchema> = {
    name: 'create_organization',
    label: 'Create Organization',
    description: 'Create a new organization on the climateai.org network. Creates an account and sets up the organization profile, metadata, and optionally the first member. Call this only after collecting all required info from the user and showing them a confirmation summary.',
    parameters: createOrganizationSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const user = stateRef.state.currentUser;
      if (!user) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'No user context' }) }], details: {} };
      }
      const photos = stateRef.state.photos;
      const polygonPoints = resolveOrganizationPolygonPoints(user.id, params.polygonPoints);
      const shouldConsumePolygonPoints = Array.isArray(polygonPoints) && polygonPoints.length >= 3;
      const result = await createOrganization({
        handle: params.handle,
        displayName: params.displayName,
        description: params.description,
        organizationType: params.organizationType,
        website: params.website,
        foundedDate: params.foundedDate,
        country: params.country,
        urls: params.urls,
        objectives: params.objectives,
        decimalLatitude: params.latitude,
        decimalLongitude: params.longitude,
        locationName: params.locationName,
        polygonPoints,
        memberName: params.memberName,
        memberRole: params.memberRole,
        memberEmail: params.memberEmail,
        memberLanguages: params.memberLanguages,
        memberExpertise: params.memberExpertise,
        avatar: photos.length > 0 ? photos[photos.length - 1] : undefined,
        submittedBy: user,
      });
      if (shouldConsumePolygonPoints && result.success) {
        clearOrganizationPolygonPoints(user.id);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} };
    },
  };

  const attachObservationsTool: ToolDefinition<typeof attachObservationsSchema> = {
    name: 'attach_observations',
    label: 'Attach Observations to Hypercert',
    description: 'Link community biodiversity observations as verifiable evidence to a hypercert. Use after creating a hypercert to back it with real data. Queries the community\'s published observations and creates an evidence attachment.',
    parameters: attachObservationsSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = await attachObservations({
        hypercertUri: params.hypercertUri,
        hypercertCid: params.hypercertCid,
        sinceDate: params.sinceDate,
        limit: params.limit,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} };
    },
  };

  const generateChimeTool: ToolDefinition<typeof generateChimeSchema> = {
    name: 'generate_audiomoth_chime',
    label: 'Generate AudioMoth Chime',
    description: 'Generate a WAV audio chime to configure an AudioMoth bioacoustic recorder. The chime encodes the current UTC timestamp, GPS coordinates, and a deployment ID. The user plays it near the AudioMoth microphone to sync the device. Use when the user mentions AudioMoth, wants to set up a recorder, or asks for a chime.',
    parameters: generateChimeSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const execFileAsync = promisify(execFile);

      const scriptPath = path.join(process.cwd(), 'skills', 'audiomoth-chime', 'generate-chime.py');
      const outputPath = `/tmp/audiomoth-chime-${Date.now()}.wav`;

      const args = [
        scriptPath,
        '--lat', String(params.latitude),
        '--lng', String(params.longitude),
        '--output', outputPath,
      ];
      if (params.deploymentId) {
        args.push('--deployment-id', params.deploymentId);
      }

      try {
        const { stdout, stderr } = await execFileAsync('python3', args, { timeout: 15000 });
        const wavBuffer = await fs.readFile(outputPath);

        // Clean up temp file
        await fs.unlink(outputPath).catch(() => {});

        // Parse deployment ID from stdout (line: "[chime] Deployment ID: <hex>")
        const depMatch = (stdout + stderr).match(/Deployment ID:\s*([0-9a-f]{16})/i);
        const deploymentId = depMatch ? depMatch[1] : params.deploymentId ?? 'unknown';

        // Store audio for Telegram layer to send
        stateRef.state.pendingAudio = {
          data: wavBuffer,
          filename: `audiomoth-chime-${deploymentId}.wav`,
          caption: '🎵 AudioMoth configuration chime',
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              deploymentId,
              latitude: params.latitude,
              longitude: params.longitude,
              message: 'Chime generated. The WAV file will be sent as an audio message. Tell the user to play it near their AudioMoth microphone.',
              diagnostics: (stdout + stderr).trim(),
            }),
          }],
          details: {},
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Chime generation failed: ${message}`,
              suggestion: 'Check that python3 is available and the generate-chime.py script exists.',
            }),
          }],
          details: {},
        };
      }
    },
  };

  const weatherReportTool: ToolDefinition<typeof weatherReportSchema> = {
    name: 'weather_report',
    label: 'Weather Report',
    description: 'Get current weather conditions and a 3-day forecast for a location. Use when the user asks about weather, temperature, rain, wind, or conditions at a location. Useful for planning field work, AudioMoth deployments, or outdoor activities.',
    parameters: weatherReportSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = await getWeather(params.latitude, params.longitude);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  };

  const nearbySpeciesTool: ToolDefinition<typeof nearbySpeciesSchema> = {
    name: 'nearby_species',
    label: 'Nearby Species',
    description: 'Search iNaturalist for species observed near a GPS location. Returns a ranked list of species by observation count. Use when the user asks what species live near them, what animals/plants are in an area, or wants to explore local biodiversity. Requires GPS coordinates — ask the user to share their location first if not available.',
    parameters: nearbySpeciesSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = await getSpeciesNearLocation(
        params.latitude,
        params.longitude,
        params.radiusKm,
        params.limit,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  };

  const requestPolygonWebAppTool: ToolDefinition<typeof requestPolygonWebAppSchema> = {
    name: 'request_polygon_webapp',
    label: 'Request Polygon Web App',
    description: 'Queue a Telegram Web App launch so the user can draw an organization boundary polygon. Use this during organization setup when the flow should move into the polygon capture Web App.',
    parameters: requestPolygonWebAppSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      try {
        const webAppUrl = buildPolygonWebAppUrl(config.polygonWebAppBaseUrl, params.polygonPoints);
        const launchMessageText = params.message?.trim() || 'Open the polygon editor to draw the organization boundary.';
        const buttonLabel = params.buttonLabel?.trim() || 'Open Polygon Web App';

        stateRef.state.pendingPolygonWebApp = {
          launchMessageText,
          buttonLabel,
          webAppUrl,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: true, queued: true, buttonLabel }) }],
          details: {},
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
          details: {},
        };
      }
    },
  };

  const detectAudioMothSDTool: ToolDefinition<typeof detectAudioMothSDSchema> = {
    name: "detect_audiomoth_sd",
    label: "Detect AudioMoth SD Cards",
    description: "Scan the machine for connected AudioMoth SD cards containing bioacoustic recordings. Returns a list of detected cards with file counts. Use when the user asks about SD cards, AudioMoth recorders, or wants to upload recordings.",
    parameters: detectAudioMothSDSchema,
    execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
      const result = await detectAudioMothSDCards();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  };

  const uploadAudioMothSDTool: ToolDefinition<typeof uploadAudioMothSDSchema> = {
    name: "upload_audiomoth_sd",
    label: "Upload AudioMoth SD Card",
    description: "Upload AudioMoth WAV recordings from a connected SD card to the community ATProto PDS. Converts to FLAC, deduplicates via SHA-1, and links to a recorder deployment. Only call after the user confirms they want to upload.",
    parameters: uploadAudioMothSDSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const result = await uploadAudioMothSD(params.folder, params.deploymentUri);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  };

  return [
    identifySpeciesTool as unknown as ToolDefinition,
    publishOccurrenceTool as unknown as ToolDefinition,
    publishMeasurementTool as unknown as ToolDefinition,
    geocodeLocationTool as unknown as ToolDefinition,
    clearPhotosTool as unknown as ToolDefinition,
    forestReportTool as unknown as ToolDefinition,
    queryHyperindexTool as unknown as ToolDefinition,
    createHypercertTool as unknown as ToolDefinition,
    createOrganizationTool as unknown as ToolDefinition,
    attachObservationsTool as unknown as ToolDefinition,
    generateChimeTool as unknown as ToolDefinition,
    weatherReportTool as unknown as ToolDefinition,
    nearbySpeciesTool as unknown as ToolDefinition,
    requestPolygonWebAppTool as unknown as ToolDefinition,
    detectAudioMothSDTool as unknown as ToolDefinition,
    uploadAudioMothSDTool as unknown as ToolDefinition,
  ];
}

// ─── Session management ───────────────────────────────────────────────────────

/**
 * Get or create a Pi agent session for a Telegram user.
 * Sessions are keyed by Telegram user ID and persisted to disk.
 *
 * @param isAdmin - When true, the session gets full SDK built-in tools (read, bash, edit, write).
 *                  When false (default), only custom tools are available — no filesystem/bash access.
 *
 * Note: Role changes (member → admin or admin → member) take effect on the next bot restart.
 * Existing sessions retain the tool set they were created with.
 */
export async function getOrCreateSession(userId: number, isAdmin: boolean = false): Promise<AgentSession> {
  const existing = sessions.get(userId);
  if (existing) {
    // Session exists — return it (role changes take effect on next bot restart)
    return existing.session;
  }

  const config = getConfig();
  const authStorage = getAuthStorage();
  const modelRegistry = getModelRegistry();

  // Create a mutable state reference so tools can always access the latest photos/user
  const stateRef: { state: SessionState } = {
    state: {
      session: null as unknown as AgentSession, // will be set below
      photos: [],
    },
  };

  const customTools = buildCustomTools(stateRef);

  // Parse provider and model ID from config.piModel (format: "provider/model-id")
  const [provider, ...modelParts] = config.piModel.split("/");
  const modelId = modelParts.join("/");

  let model = modelRegistry.find(provider, modelId);
  if (!model) {
    // Fall back to first available model
    const available = modelRegistry.getAvailable();
    model = available[0];
  }

  const sessionDir = `./data/sessions/${userId}`;

  const { session } = await createAgentSession({
    authStorage,
    modelRegistry,
    model: model ?? undefined,
    sessionManager: SessionManager.create(sessionDir),
    customTools,
    cwd: process.cwd(),
    tools: isAdmin ? undefined : [],  // admin gets defaults (read,bash,edit,write), members get none
  });

  const sessionState: SessionState = {
    session,
    photos: [],
  };

  // Point the stateRef at the real state object
  stateRef.state = sessionState;

  sessions.set(userId, sessionState);

  return session;
}

// ─── Message sending ──────────────────────────────────────────────────────────

/**
 * Send a message to the agent and collect the full text response.
 * Handles text messages, photo context, and location context.
 */
export async function sendToAgent(msg: IncomingMessage): Promise<string> {
  const session = await getOrCreateSession(msg.user.id, (msg as any).isAdmin ?? false);

  // Update per-session state with latest photo and user info
  const sessionState = sessions.get(msg.user.id)!;
  sessionState.currentTurnId = (sessionState.currentTurnId ?? 0) + 1;
  sessionState.currentUser = {
    id: msg.user.id,
    username: msg.user.username,
    displayName: msg.user.displayName,
  };

  const currentTurnId = sessionState.currentTurnId;

  if (msg.photo) {
    sessionState.photos.push({
      data: msg.photo.data,
      mimeType: msg.photo.mimeType,
    });
  }

  const telegramPolygonWebAppData = msg.webAppData
    ? processTelegramPolygonWebAppData(msg.user.id, msg.webAppData.rawPayload)
    : undefined;

  const pastedPolygonWebAppData = !msg.webAppData && msg.text && isLikelyPolygonPayloadText(msg.text)
    ? processTelegramPolygonWebAppData(msg.user.id, msg.text)
    : undefined;

  const failedPolygonWebAppData = telegramPolygonWebAppData && !telegramPolygonWebAppData.ok
    ? telegramPolygonWebAppData
    : pastedPolygonWebAppData && !pastedPolygonWebAppData.ok
      ? pastedPolygonWebAppData
      : undefined;

  if (failedPolygonWebAppData) {
    sessionState.currentTurnHasPhoto = Boolean(msg.photo);
    sessionState.currentTurnHasUserContext = hasMeaningfulUserContext(msg.text ?? undefined);
    return buildPolygonWebAppRecoveryMessage(failedPolygonWebAppData.error);
  }

  let latestUserText: string | undefined;
  let promptBody: string;

  if (msg.photo) {
    const userText = msg.text ? ` ${msg.text}` : "";
    latestUserText = msg.text ?? undefined;
    promptBody = `The user sent a photo (photo ${sessionState.photos.length} in this observation session). [Photo is available for analysis].${userText}`;
  } else if (msg.voice) {
    const transcription = await transcribeVoice(
      msg.voice.data,
      msg.voice.mimeType,
      getConfig().geminiApiKey
    );
    if ("text" in transcription) {
      latestUserText = transcription.text;
      promptBody = `[Voice note transcription]: ${transcription.text}`;
    } else {
      console.error("Voice transcription failed:", transcription.error);
      promptBody = `[The user sent a voice note but transcription failed. Let them know you couldn't process it and ask them to type their message instead.]`;
    }
  } else if (msg.webAppData || pastedPolygonWebAppData) {
    const polygonData = telegramPolygonWebAppData ?? pastedPolygonWebAppData!;
    if (polygonData.ok) {
      promptBody = msg.webAppData
        ? `The user submitted polygon drawing data from the Telegram Web App. The boundary was recovered. Validated polygon points: ${JSON.stringify(polygonData.points)}.`
        : `The user pasted fallback polygon drawing data into chat. The boundary was recovered. Validated polygon points: ${JSON.stringify(polygonData.points)}.`;
    } else {
      promptBody = msg.webAppData
        ? `The user submitted polygon drawing data from the Telegram Web App, but validation failed: ${JSON.stringify(polygonData)}.`
        : `The user pasted fallback polygon drawing data into chat, but validation failed: ${JSON.stringify(polygonData)}.`;
    }
  } else if (msg.location) {
    const { latitude, longitude } = msg.location;
    const userText = msg.text ? ` ${msg.text}` : "";
    latestUserText = msg.text ?? undefined;
    promptBody = `The user shared their GPS location: latitude ${latitude}, longitude ${longitude}.${userText}`;
  } else {
    const text = msg.text ?? "";
    latestUserText = text;
    promptBody = text;
  }

  const explicitLanguagePreference = latestUserText ? detectExplicitLanguagePreference(latestUserText) : undefined;
  const preferredLanguage = explicitLanguagePreference
    ? setPreferredLanguage(msg.user.id, explicitLanguagePreference) ?? explicitLanguagePreference
    : ensurePreferredLanguage(msg.user.id, msg.languageCode) ?? getPreferredLanguage(msg.user.id);

  const languageGuidance = preferredLanguage
    ? `\nThe user's preferred language is ${preferredLanguage}. Keep replies in that language, preserve Tainá's warm persona, and use the same language for chart titles, axis labels, and other generated labels. If the user clearly asks to switch languages, follow the new language.`
    : "";

  // Build the prompt text
  const userContext = `Message from ${msg.user.displayName} (Telegram user ID: ${msg.user.id})`;
  const promptText = `${userContext}${languageGuidance}\n${promptBody}`;

  sessionState.currentTurnHasPhoto = Boolean(msg.photo);
  sessionState.currentTurnHasUserContext = hasMeaningfulUserContext(latestUserText);

  if (latestUserText && isExplicitPublishConfirmation(latestUserText)) {
    sessionState.latestPublishConfirmationTurnId = currentTurnId;
  }

  if (latestUserText && isExplicitIdentificationAgreement(latestUserText)) {
    sessionState.latestIdentificationAgreementTurnId = currentTurnId;
  }

  // Collect response text from events
  let responseText = "";

  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      responseText += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(promptText);
  } finally {
    unsubscribe();
  }

  return responseText;
}

// ─── Pending chart ────────────────────────────────────────────────────────────

/**
 * Consume and return the pending chart image for a user (one-time use).
 * Returns undefined if no chart is pending.
 */
export function getPendingChart(userId: number): Buffer | undefined {
  const state = sessions.get(userId);
  if (state?.pendingChart) {
    const chart = state.pendingChart;
    state.pendingChart = undefined; // consume it
    return chart;
  }
  return undefined;
}

// ─── Pending audio ────────────────────────────────────────────────────────────

/**
 * Consume and return the pending audio file for a user (one-time use).
 * Returns undefined if no audio is pending.
 */
export function getPendingAudio(userId: number): { data: Buffer; filename: string; caption: string } | undefined {
  const state = sessions.get(userId);
  if (state?.pendingAudio) {
    const audio = state.pendingAudio;
    state.pendingAudio = undefined; // consume it
    return audio;
  }
  return undefined;
}

// ─── Pending polygon Web App ──────────────────────────────────────────────────

/**
 * Consume and return the pending polygon Web App action for a user (one-time use).
 * Returns undefined if no Web App launch is pending.
 */
export function getPendingPolygonWebApp(
  userId: number
): { launchMessageText: string; buttonLabel: string; webAppUrl: string } | undefined {
  const state = sessions.get(userId);
  if (state?.pendingPolygonWebApp) {
    const pending = state.pendingPolygonWebApp;
    state.pendingPolygonWebApp = undefined; // consume it
    return pending;
  }
  return undefined;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Reset (dispose and remove) the session for a single user.
 * If no session exists for the given userId, this is a no-op.
 */
export function resetSession(userId: number): void {
  const state = sessions.get(userId);
  if (!state) return;
  try {
    state.session.dispose();
  } catch (err) {
    console.error("Error disposing session for user", userId, ":", err);
  }
  sessions.delete(userId);
}

/**
 * Dispose all active agent sessions.
 */
export async function disposeAllSessions(): Promise<void> {
  for (const [, state] of sessions) {
    try {
      state.session.dispose();
    } catch (err) {
      console.error("Error disposing session:", err);
    }
  }
  sessions.clear();
}
