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
import { geocodeLocation } from "./tools/geocode-location.js";
import { createGeostore, getTreeCoverExtent, getTreeCoverLoss, getFireAlerts, getDeforestationAlerts, reverseGeocodeAdmin } from "./tools/gfw-api.js";
import { generateTreeCoverLossChart, buildGfwMapUrl } from "./tools/gfw-chart.js";
import { transcribeVoice } from "./tools/transcribe-voice.js";
import { queryHyperindex } from "./tools/query-hyperindex.js";
import { createHypercert } from "./tools/create-hypercert.js";
import { attachObservations } from "./tools/attach-observations.js";

// ─── Per-session state ────────────────────────────────────────────────────────

interface SessionState {
  session: AgentSession;
  photos: Array<{ data: Buffer; mimeType: string }>;
  currentUser?: TelegramUser;
  pendingChart?: Buffer;
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
  did: Type.Optional(Type.String({ description: 'Filter by DID (ATProto decentralized identifier). Use community DID to see our records.' })),
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

const attachObservationsSchema = Type.Object({
  hypercertUri: Type.String({ description: 'AT URI of the hypercert to attach observations to (from create_hypercert result)' }),
  hypercertCid: Type.String({ description: 'CID of the hypercert record (from create_hypercert result)' }),
  sinceDate: Type.Optional(Type.String({ description: 'Only include observations recorded after this date (ISO 8601)' })),
  limit: Type.Optional(Type.Number({ description: 'Max observations to attach (default 100, max 200)' })),
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

      const imageData = photo.data.toString("base64");
      const result = await identifySpecies(
        imageData,
        photo.mimeType,
        config.geminiApiKey,
        config.speciesIdModel,
        params.userContext
      );

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

      // Clear photos after a successful publish
      if (result.success) {
        stateRef.state.photos = [];
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
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

  return [
    identifySpeciesTool as unknown as ToolDefinition,
    publishOccurrenceTool as unknown as ToolDefinition,
    geocodeLocationTool as unknown as ToolDefinition,
    clearPhotosTool as unknown as ToolDefinition,
    forestReportTool as unknown as ToolDefinition,
    queryHyperindexTool as unknown as ToolDefinition,
    createHypercertTool as unknown as ToolDefinition,
    attachObservationsTool as unknown as ToolDefinition,
  ];
}

// ─── Session management ───────────────────────────────────────────────────────

/**
 * Get or create a Pi agent session for a Telegram user.
 * Sessions are keyed by Telegram user ID and persisted to disk.
 */
export async function getOrCreateSession(userId: number): Promise<AgentSession> {
  const existing = sessions.get(userId);
  if (existing) {
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
  const session = await getOrCreateSession(msg.user.id);

  // Update per-session state with latest photo and user info
  const sessionState = sessions.get(msg.user.id)!;
  sessionState.currentUser = {
    id: msg.user.id,
    username: msg.user.username,
    displayName: msg.user.displayName,
  };

  if (msg.photo) {
    sessionState.photos.push({
      data: msg.photo.data,
      mimeType: msg.photo.mimeType,
    });
  }

  // Build the prompt text
  const userContext = `Message from ${msg.user.displayName} (Telegram user ID: ${msg.user.id})`;
  let promptText: string;

  if (msg.photo) {
    const userText = msg.text ? ` ${msg.text}` : "";
    promptText = `${userContext}\nThe user sent a photo (photo ${sessionState.photos.length} in this observation session). [Photo is available for analysis].${userText}`;
  } else if (msg.voice) {
    const transcription = await transcribeVoice(
      msg.voice.data,
      msg.voice.mimeType,
      getConfig().geminiApiKey
    );
    if ("text" in transcription) {
      promptText = `${userContext}\n[Voice note transcription]: ${transcription.text}`;
    } else {
      console.error("Voice transcription failed:", transcription.error);
      promptText = `${userContext}\n[The user sent a voice note but transcription failed. Let them know you couldn't process it and ask them to type their message instead.]`;
    }
  } else if (msg.location) {
    const { latitude, longitude } = msg.location;
    const userText = msg.text ? ` ${msg.text}` : "";
    promptText = `${userContext}\nThe user shared their GPS location: latitude ${latitude}, longitude ${longitude}.${userText}`;
  } else {
    const text = msg.text ?? "";
    promptText = `${userContext}\n${text}`;
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

// ─── Cleanup ──────────────────────────────────────────────────────────────────

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
