export type NormalizedGeminiModelKey = {
  modelId: string;
  modelKeyType: string;
  modelKeyLength: number | null;
  removedModelsPrefixes: number;
  hadSurroundingWhitespace: boolean;
  valid: boolean;
};

export function normalizeGeminiModelKey(
  modelKey: unknown,
): NormalizedGeminiModelKey {
  const isString = typeof modelKey === "string";
  const original = isString ? modelKey : "";
  let modelId = original.trim();
  let removedModelsPrefixes = 0;
  while (/^models\/\s*/.test(modelId)) {
    modelId = modelId.replace(/^models\/\s*/, "").trim();
    removedModelsPrefixes += 1;
  }

  // Keep the accepted syntax broad; let Gemini validate model names not known here.
  return {
    modelId,
    modelKeyType: modelKey === null ? "null" : typeof modelKey,
    modelKeyLength: isString ? original.length : null,
    removedModelsPrefixes,
    hadSurroundingWhitespace: isString && original !== original.trim(),
    valid:
      isString &&
      modelId.length > 0 &&
      modelId.length <= 256 &&
      !/\s/.test(modelId) &&
      !/[\u0000-\u001f\u007f]/.test(modelId) &&
      !/[?&]/.test(modelId),
  };
}

export function escapeModelKeyForDiagnostics(
  modelKey: unknown,
  apiKey: string,
) {
  if (typeof modelKey !== "string") {
    return (JSON.stringify(modelKey) ?? String(modelKey)).slice(0, 180);
  }

  const safeValue = modelKey
    .split(apiKey).join("[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|api_key)=)[^\s&#"']+/gi, "$1[redacted]")
    .replace(/(?:api[_-]?key["'=:\s]+)[^,\s"'&]+/gi, "API key [redacted]");
  return JSON.stringify(safeValue).slice(0, 180);
}
