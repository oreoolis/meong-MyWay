import "server-only";

import type { RunCost } from "@/lib/contracts";
import type { ModelUsage } from "@/lib/bedrock/reason";
import { getBedrockConfig } from "@/lib/aws/clients";

/**
 * What a run cost.
 *
 * The brief set a hard budget, so every run reports its own price rather than
 * leaving it to be inferred from a monthly bill. Reporting it per run is what
 * makes a regression visible: if a prompt change doubles token use, the number
 * on the results screen moves immediately.
 *
 * Rates are USD per million tokens, on-demand, and are a local copy of a
 * published price list — AWS does not expose pricing to the runtime, so this
 * table has to be maintained by hand. It is used for reporting only; nothing
 * bills against it.
 */

type Rate = { input: number; output: number };

/**
 * Keyed by Bedrock model ID prefix so cross-region inference profiles
 * ("us.amazon.nova-lite-v1:0") resolve to the same rate as the bare model.
 */
const RATES: Record<string, Rate> = {
  "amazon.nova-micro": { input: 0.035, output: 0.14 },
  "amazon.nova-lite": { input: 0.06, output: 0.24 },
  "amazon.nova-pro": { input: 0.8, output: 3.2 },
  "anthropic.claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "anthropic.claude-sonnet-4-5": { input: 3.0, output: 15.0 },
};

/** Titan Text Embeddings V2, USD per million input tokens. */
const EMBEDDING_RATE = 0.02;

/** Nova Lite, matching the Terraform default. */
const FALLBACK_RATE: Rate = { input: 0.06, output: 0.24 };

function rateFor(modelId: string): Rate {
  // Strip any cross-region prefix ("us.", "eu.", "apac.") before matching.
  const bare = modelId.replace(/^(us|eu|apac)\./, "");

  for (const [prefix, rate] of Object.entries(RATES)) {
    if (bare.startsWith(prefix)) return rate;
  }

  return FALLBACK_RATE;
}

export function estimateCost(
  usage: ModelUsage,
  embeddingTokens: number,
): RunCost {
  const { reasoningModelId } = getBedrockConfig();
  const rate = rateFor(reasoningModelId);

  const usd =
    (usage.inputTokens / 1_000_000) * rate.input +
    (usage.outputTokens / 1_000_000) * rate.output +
    (embeddingTokens / 1_000_000) * EMBEDDING_RATE;

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    embeddingTokens,
    // Six decimals: a run costs thousandths of a cent, and rounding to four
    // would display every one of them as $0.00.
    estimatedUsd: Number(usd.toFixed(6)),
  };
}
