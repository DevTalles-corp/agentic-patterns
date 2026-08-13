/**
 * Esta función ayuda a poder ver el progreso de la ejecución del modelo
 * NO ES NECESARIA, pero
 * si queremos comprender el razonamiento y pasos del modelo, nos ayudará
 */

import type { GenerateTextStepEndEvent } from 'ai';

export function createTracer(label: string) {
  let step = 0;
  let totalTokens = 0;

  return {
    onStepFinish({
      toolCalls,
      toolResults,
      text,
      usage,
    }: GenerateTextStepEndEvent) {
      try {
        step++;
        const tokens = usage.totalTokens ?? 0;
        totalTokens += tokens;

        console.log(
          `\n  ┌─ [${label.blue}] ${`step ${step}`.yellow} · ${`${tokens} tokens`.purple}`,
        );

        for (const call of toolCalls) {
          console.log(
            `  │  ${'TOOL'.yellow}  → ${call.toolName.blue}(${JSON.stringify(call.input)})`,
          );
        }

        for (const result of toolResults) {
          console.log(
            `  │  ${'RESULT'.green}← ${JSON.stringify(result.output).slice(0, 150)}`,
          );
        }

        if (text.trim()) {
          console.log(`  │  ${'TEXT'.purple}  → ${text.trim().slice(0, 150)}`);
        }

        console.log(`  └─`);
      } catch (error) {
        console.error(`Error while tracing step ${step}:`, error);
      }
    },

    // Retorna un objeto con el número de pasos y el total de tokens utilizados
    // { steps: 4, totalTokens: 100 }
    summary: () => ({ steps: step, totalTokens }),
  };
}
