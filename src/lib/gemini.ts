import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export interface TranslationResult {
  translatedText: string;
  detectedLanguage?: string;
  context?: string;
}

export async function translateTranscript(
  text: string,
  sourceLang: string,
  targetLang: string,
  context?: string,
  history?: any[]
): Promise<TranslationResult> {
  if (!text.trim()) {
    throw new Error("Text is required for translation.");
  }

  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Please check your settings.");
  }

  try {
    const model = "gemini-3-flash-preview";

    // 1. Auto-detect context from history if not provided or to augment
    let autoContext = "";
    if (history && Array.isArray(history) && history.length > 0) {
      const historyText = history
        .slice(-5)
        .map((m: any) => `${m.speaker}: ${m.text}`)
        .join("\n");
      
      const contextPrompt = `
        Based on the following conversation history, identify the current topic or context in 5 words or less.
        History:
        ${historyText}
        
        Return ONLY the brief context.
      `;
      const contextResult = await ai.models.generateContent({
        model,
        contents: contextPrompt,
      });
      autoContext = contextResult.text?.trim() || "";
    }

    const finalContext = [context, autoContext].filter(Boolean).join(". ");

    // 2. Perform translation
    const prompt = `
      You are a professional, highly accurate translator specializing in English and Indian languages.
      
      TASK: Translate the text below from ${sourceLang} to ${targetLang}.
      
      STRICT RULES:
      1. The output MUST be written ONLY in the ${targetLang} language.
      2. Use the correct script for ${targetLang} (e.g., Kannada script for Kannada, Devanagari for Hindi).
      3. DO NOT translate into Tamil, Telugu, or any other language if the target is ${targetLang}.
      4. Maintain a natural, conversational tone appropriate for the context.
      5. If the input text contains "Canada" in a context that seems to refer to the language "Kannada", treat it as "Kannada".
      
      ${finalContext ? `CONTEXT: ${finalContext}` : ""}
      
      TEXT TO TRANSLATE:
      "${text}"
      
      OUTPUT (${targetLang} ONLY):
    `;

    const result = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const translatedText = result.text?.trim() || "";
    
    if (!translatedText) {
      throw new Error("The AI returned an empty translation. Please try rephrasing.");
    }

    return {
      translatedText,
      context: autoContext,
    };
  } catch (error: any) {
    console.error("Translation error details:", error);
    
    let errorMessage = "Failed to translate transcript.";
    if (error.message?.includes("API key not valid")) {
      errorMessage = "Gemini API key is invalid. Please check your configuration in Settings.";
    } else if (error.message?.includes("network")) {
      errorMessage = "Network error. Please check your internet connection.";
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
}
