// Voice transcription using Google Gemini generative AI
// Transcribes audio/ogg voice notes sent via Telegram

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface TranscriptionSuccess {
  text: string;
}

export interface TranscriptionError {
  error: string;
}

export type TranscriptionResult = TranscriptionSuccess | TranscriptionError;

const DEFAULT_MODEL = "gemini-3.1-pro-preview";

const TRANSCRIPTION_PROMPT =
  "Transcribe exactly as spoken, preserve language, return only the transcription with no additional commentary or formatting.";

/**
 * Transcribe a voice note using Google Gemini generative AI.
 *
 * @param audioData - Raw audio data as a Buffer (audio/ogg from Telegram)
 * @param mimeType - MIME type of the audio, e.g. "audio/ogg"
 * @param geminiApiKey - Google Gemini API key
 * @param model - Gemini model ID (defaults to "gemini-2.5-flash")
 * @returns { text } on success, { error } on failure — never throws
 */
export async function transcribeVoice(
  audioData: Buffer,
  mimeType: string,
  geminiApiKey: string,
  model?: string
): Promise<TranscriptionResult> {
  try {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const modelId = model ?? DEFAULT_MODEL;

    const generativeModel = genAI.getGenerativeModel({ model: modelId });

    const audioBase64 = audioData.toString("base64");

    const result = await generativeModel.generateContent([
      {
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      },
      { text: TRANSCRIPTION_PROMPT },
    ]);

    const transcription = result.response.text().trim();
    return { text: transcription };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to transcribe voice note: ${message}` };
  }
}
