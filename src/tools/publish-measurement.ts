// Publish Darwin Core MeasurementOrFact records to the community ATProto PDS
// Links to an occurrence via occurrenceRef (AT-URI)

import { getPublishingAgent, getPublishingDid } from "../atproto.js";
import { loadEnvConfig } from "../env.js";
import type { TelegramUser } from "./publish-occurrence.js";

export interface MeasurementEntry {
  measurementType: string;
  measurementValue: string;
  measurementUnit?: string;
  measurementMethod?: string;
  measurementAccuracy?: string;
  measurementRemarks?: string;
}

export interface FloraMeasurementInput {
  dbh?: string;
  dbhMeasurementHeight?: string;
  girth?: string;
  basalDiameter?: string;
  stemCount?: number;
  totalHeight?: string;
  heightToFirstBranch?: string;
  buttressHeight?: string;
  heightMeasurementMethod?: string;
  crownDiameter?: string;
  crownDepth?: string;
  canopyCoverPercent?: string;
  crownPosition?: string;
  crownDieback?: string;
  abovegroundBiomass?: string;
  carbonContent?: string;
  woodDensity?: string;
  biomassAllometricEquation?: string;
  estimatedAge?: string;
  growthForm?: string;
  vitalityStatus?: string;
  healthScore?: string;
  damageType?: string;
  damageCause?: string;
  floweringStatus?: string;
  phenology?: string;
  additionalMeasurements?: MeasurementEntry[];
}

export interface FaunaMeasurementInput {
  bodyMass?: string;
  totalLength?: string;
  headBodyLength?: string;
  tailLength?: string;
  wingLength?: string;
  wingspan?: string;
  billLength?: string;
  tarsusLength?: string;
  fatScore?: string;
  pectoralMuscleScore?: string;
  hindFootLength?: string;
  earLength?: string;
  forearmLength?: string;
  snoutVentLength?: string;
  carapaceLength?: string;
  carapaceWidth?: string;
  standardLength?: string;
  forkLength?: string;
  groupSize?: number;
  clutchSize?: number;
  litterSize?: number;
  broodSize?: number;
  bodyConditionScore?: string;
  bodyConditionIndex?: string;
  injuryPresent?: boolean;
  injuryDescription?: string;
  diseaseSignsPresent?: boolean;
  diseaseDescription?: string;
  tagId?: string;
  tagType?: string;
  bandNumber?: string;
  pitTagId?: string;
  recaptureStatus?: string;
  geneticSampleId?: string;
  additionalMeasurements?: MeasurementEntry[];
}

export type MeasurementResult =
  | { type: 'flora'; data: FloraMeasurementInput }
  | { type: 'fauna'; data: FaunaMeasurementInput }
  | { type: 'generic'; measurements: MeasurementEntry[] };

export interface PublishMeasurementInput {
  occurrenceRef: string;    // AT-URI of the linked occurrence
  occurrenceID?: string;
  result: MeasurementResult;
  measurementDate?: string;
  measurementMethod?: string;
  measurementRemarks?: string;
  submittedBy: TelegramUser;
}

export interface PublishMeasurementSuccess {
  success: true;
  uri: string;
  cid: string;
  measurementType: string;
  hyperscanUrl: string;
}

export interface PublishMeasurementError {
  success: false;
  error: string;
}

export type PublishMeasurementResponse = PublishMeasurementSuccess | PublishMeasurementError;

function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function publishMeasurement(input: PublishMeasurementInput): Promise<PublishMeasurementResponse> {
  if (!input.occurrenceRef) {
    return { success: false, error: "occurrenceRef is required" };
  }

  let agent;
  try {
    const config = loadEnvConfig();
    agent = await getPublishingAgent(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `ATProto agent error: ${message}` };
  }

  const did = getPublishingDid();
  const createdAt = new Date().toISOString();
  const { id, username, displayName } = input.submittedBy;
  const attribution = username
    ? `${displayName} (@${username}, tg:${id})`
    : `${displayName} (tg:${id})`;

  let resultObj: Record<string, unknown>;
  let measurementTypeName: string;

  if (input.result.type === 'flora') {
    measurementTypeName = 'flora';
    const d = input.result.data;
    resultObj = {
      $type: "app.gainforest.dwc.measurement#floraMeasurement",
      ...defined(d as unknown as Record<string, unknown>),
    };
  } else if (input.result.type === 'fauna') {
    measurementTypeName = 'fauna';
    const d = input.result.data;
    resultObj = {
      $type: "app.gainforest.dwc.measurement#faunaMeasurement",
      ...defined(d as unknown as Record<string, unknown>),
    };
  } else {
    measurementTypeName = 'generic';
    resultObj = {
      $type: "app.gainforest.dwc.measurement#genericMeasurement",
      measurements: input.result.measurements,
    };
  }

  const record: Record<string, unknown> = {
    $type: "app.gainforest.dwc.measurement",
    occurrenceRef: input.occurrenceRef,
    result: resultObj,
    measuredBy: attribution,
    measuredByID: did,
    createdAt,
  };

  if (input.occurrenceID) record.occurrenceID = input.occurrenceID;
  if (input.measurementDate) record.measurementDate = input.measurementDate;
  if (input.measurementMethod) record.measurementMethod = input.measurementMethod;
  if (input.measurementRemarks) record.measurementRemarks = input.measurementRemarks;

  let createResult;
  try {
    createResult = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: "app.gainforest.dwc.measurement",
      record,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to publish measurement: ${message}` };
  }

  const atUri = createResult.data.uri;
  const uriParts = atUri.slice("at://".length).split("/");
  const hyperscanUrl = uriParts.length >= 3
    ? `https://www.hyperscan.dev/data?did=${encodeURIComponent(uriParts[0])}&collection=${encodeURIComponent(uriParts[1])}&rkey=${encodeURIComponent(uriParts[2])}`
    : `https://www.hyperscan.dev/data?did=${encodeURIComponent(atUri)}`;

  return {
    success: true as const,
    uri: atUri,
    cid: createResult.data.cid,
    measurementType: measurementTypeName,
    hyperscanUrl,
  };
}
