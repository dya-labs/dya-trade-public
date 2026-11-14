import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  type Experimental_EvaluationAnswer as EvaluationAnswer,
  type Experimental_EvaluationModel as EvaluationModel,
  type Experimental_EvaluationQuestion as EvaluationQuestion,
} from "ai";
import { z } from "zod";

// Server-only: Terminal chat and Insights both run on NEAR AI Cloud.
const NEAR_AI_BASE_URL = "https://cloud-api.near.ai/v1";
/** Confidential TEE model on NEAR AI's own GPU fleet: prompts, wallet checks and replies stay inside the enclave. */
export const NEAR_AI_CHAT_MODEL = "z-ai/glm-5.3-flash";
/** TypeSafe's System One decision model, served through the NEAR AI Cloud gateway. */
export const JEV_MODEL = "typesafe/jev-1.13";

export function nearAiApiKey() {
  return process.env.NEAR_AI_API_KEY || undefined;
}

export function nearAiChatModel(apiKey: string) {
  return createOpenAICompatible({ name: "near-ai", baseURL: NEAR_AI_BASE_URL, apiKey })(NEAR_AI_CHAT_MODEL);
}

const probability = z.number().min(0).max(1);
const systemOneResponse = z.object({
  id: z.string().nullish(),
  model: z.string().min(1),
  answers: z.record(z.string(), z.discriminatedUnion("type", [
    z.object({ type: z.literal("noul"), noul: probability }),
    z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), probability) }),
  ])),
});

type JevEvaluationModel = Exclude<EvaluationModel, string>;

/** Adapts `evaluate()` to NEAR AI Cloud's System One endpoint, where yes/no questions are "noul". */
export function jevEvaluationModel(apiKey: string): JevEvaluationModel {
  return {
    specificationVersion: "v4",
    provider: "near-ai",
    modelId: JEV_MODEL,
    supportedQuestionTypes: ["boolean", "choice"],
    async doEvaluate({ state, questions, abortSignal, headers }) {
      const url = `${NEAR_AI_BASE_URL}/systemone`;
      const body = {
        model: JEV_MODEL,
        state,
        questions: Object.fromEntries(Object.entries(questions).map(([id, question]) =>
          [id, question.type === "boolean" ? { ...question, type: "noul" } : question])),
      };
      const extra = Object.entries(headers ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined);
      const response = await fetch(url, {
        method: "POST",
        headers: { ...Object.fromEntries(extra), authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      const responseHeaders = Object.fromEntries(response.headers);
      const text = await response.text();
      if (!response.ok) {
        throw new APICallError({
          message: `NEAR AI Cloud returned ${response.status}`,
          url, requestBodyValues: body, statusCode: response.status, responseHeaders, responseBody: text,
          isRetryable: response.status === 429 || response.status >= 500,
        });
      }
      const parsed = systemOneResponse.parse(JSON.parse(text));
      const answers: Record<string, EvaluationAnswer<EvaluationQuestion>> = {};
      for (const id of Object.keys(questions)) {
        const answer = parsed.answers[id];
        if (!answer) throw new Error(`Jev omitted an answer for ${id}`);
        answers[id] = answer.type === "noul"
          ? { type: "boolean", probability: answer.noul }
          : { type: "choice", choice: answer.choice, probabilities: answer.probabilities };
      }
      return { answers, warnings: [], response: { id: parsed.id ?? undefined, modelId: parsed.model, headers: responseHeaders } };
    },
  };
}
