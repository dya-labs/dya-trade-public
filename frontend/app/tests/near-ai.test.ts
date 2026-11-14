import { experimental_evaluate as evaluate } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { JEV_MODEL, jevEvaluationModel } from "@/lib/analysis/near-ai";

afterEach(() => { vi.unstubAllGlobals(); });

const questions = {
  reacts: { type: "boolean", instructions: "Will price react at this level?" },
  regime: { type: "choice", instructions: "Classify the regime.", criteria: { BULLISH: "Up", BEARISH: "Down" } },
} as const;

it("sends Jev questions to NEAR AI Cloud System One and maps noul answers to boolean probabilities", async () => {
  const fetch = vi.fn(async () => Response.json({
    id: "decision-1",
    model: JEV_MODEL,
    answers: {
      reacts: { type: "noul", noul: 0.73 },
      regime: { type: "choice", choice: "BEARISH", confidence: 0.6, probabilities: { BULLISH: 0.4, BEARISH: 0.6 } },
    },
  }));
  vi.stubGlobal("fetch", fetch);

  const result = await evaluate({ model: jevEvaluationModel("synthetic-key"), state: { price: 3 }, questions });

  expect(result.answers.reacts).toEqual({ type: "boolean", probability: 0.73 });
  expect(result.answers.regime).toMatchObject({ type: "choice", choice: "BEARISH" });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://cloud-api.near.ai/v1/systemone");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-key");
  expect(JSON.parse(init.body as string)).toEqual({
    model: JEV_MODEL,
    state: { price: 3 },
    questions: { reacts: { type: "noul", instructions: questions.reacts.instructions }, regime: questions.regime },
  });
});

it("rejects a NEAR AI Cloud authentication failure without retrying", async () => {
  const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));
  vi.stubGlobal("fetch", fetch);

  await expect(evaluate({ model: jevEvaluationModel("bad-key"), state: "x", questions })).rejects.toMatchObject({ statusCode: 401 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
