import type { StringTemplateReference } from "../types";
import { normalizePath } from "../utils";

const NUMERIC_PLACEHOLDER = /\{(\d+)(?:\.([^}]+))?\}/g;

export function parseTemplateString(
  tpl: string,
  stepIdByIndex: Map<number, string>,
): StringTemplateReference | string {
  const matches = Array.from(tpl.matchAll(NUMERIC_PLACEHOLDER));
  if (matches.length === 0) return tpl;

  const values: StringTemplateReference["$values"] = [];
  let result = "";
  let lastIndex = 0;

  for (const match of matches) {
    const [full, idxStr, path] = match;

    if (!idxStr) {
      console.error("Invalid template reference: missing index", {
        template: tpl,
        index: idxStr,
      });

      result += tpl.slice(lastIndex, (match.index ?? 0) + full.length);
      lastIndex = (match.index ?? 0) + full.length;

      continue;
    }

    const idx = Number.parseInt(idxStr, 10);
    const stepId = stepIdByIndex.get(idx);

    if (!stepId) {
      console.error(`Invalid template reference: step index ${idx} not found`, {
        template: tpl,
        index: idx,
        path,
      });

      result += tpl.slice(lastIndex, (match.index ?? 0) + full.length);
      lastIndex = (match.index ?? 0) + full.length;

      continue;
    }

    values.push({
      $fromStep: stepId,
      $outputKey: path ? normalizePath(path) : "",
    });

    const start = match.index ?? 0;
    result += `${tpl.slice(lastIndex, start)}{${values.length - 1}}`;
    lastIndex = start + full.length;
  }

  result += tpl.slice(lastIndex);

  if (values.length === 0) {
    return tpl;
  }

  return { $fromTemplateString: result, $values: values };
}
