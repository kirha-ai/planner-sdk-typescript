import type {
  DependencyReference,
  RawDependencyReference,
  StringTemplateReference,
} from "./types";

export type PathSegment = string | number;
export type Path = PathSegment[];

const BRACKET_INDEX_REGEX = /\[(\d+)\]/g;
const BRACKET_DOUBLE_QUOTE_REGEX = /\["([^"]+)"\]/g;
const BRACKET_SINGLE_QUOTE_REGEX = /\['([^']+)'\]/g;

const INDEX_MARKER_PREFIX = "\0IDX:";

function createIndexMarker(index: string): string {
  return `${INDEX_MARKER_PREFIX}${index}`;
}

function isIndexMarker(segment: string): boolean {
  return segment.startsWith(INDEX_MARKER_PREFIX);
}

function parseIndexMarker(segment: string): number {
  return Number(segment.slice(INDEX_MARKER_PREFIX.length));
}

function normalizeToSegments(path: string): string {
  if (!path) {
    return "";
  }

  return path
    .replace(BRACKET_INDEX_REGEX, (_, index) => `.${createIndexMarker(index)}`)
    .replace(BRACKET_DOUBLE_QUOTE_REGEX, ".$1")
    .replace(BRACKET_SINGLE_QUOTE_REGEX, ".$1");
}

export function parsePath(path: string): Path {
  const normalized = normalizeToSegments(path);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(".")
    .filter(Boolean)
    .map((segment) => {
      if (isIndexMarker(segment)) {
        return parseIndexMarker(segment);
      }
      return segment;
    });
}

export function normalizePath(path: string): string {
  return formatPath(parsePath(path));
}

export function formatPath(path: Path): string {
  if (path.length === 0) {
    return "";
  }

  return path.reduce<string>((acc, part) => {
    if (typeof part === "number") {
      return `${acc}[${part}]`;
    }
    return acc ? `${acc}.${part}` : part;
  }, "");
}

export function isNumericString(value: string): boolean {
  return /^\d+$/.test(value);
}

export function getNestedValue(obj: unknown, path: Path): unknown {
  let current = obj;

  for (const part of path) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof part === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[part];
      continue;
    }

    if (Array.isArray(current) && isNumericString(part)) {
      current = current[Number(part)];
      continue;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export type ReferenceCallbacks = {
  onDependency?: (ref: DependencyReference, path: Path) => void;
  onTemplate?: (ref: StringTemplateReference, path: Path) => void;
};

export function traverseReferences(
  value: unknown,
  callbacks: ReferenceCallbacks,
  currentPath: Path = [],
): void {
  if (isDependencyReference(value)) {
    callbacks.onDependency?.(value, currentPath);
    return;
  }

  if (isStringTemplateReference(value)) {
    callbacks.onTemplate?.(value, currentPath);
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      traverseReferences(item, callbacks, [...currentPath, index]);
    }
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      traverseReferences(item, callbacks, [...currentPath, key]);
    }
  }
}

export function extractDependencyStepIds(
  args: Record<string, unknown>,
): string[] {
  const deps: string[] = [];

  traverseReferences(args, {
    onDependency: (ref) => deps.push(ref.$fromStep),
    onTemplate: (ref) => {
      for (const val of ref.$values) {
        deps.push(val.$fromStep);
      }
    },
  });

  return [...new Set(deps)];
}

export function isDependencyReference(
  value: unknown,
): value is DependencyReference {
  return (
    typeof value === "object" &&
    value !== null &&
    "$fromStep" in value &&
    "$outputKey" in value
  );
}

export function isStringTemplateReference(
  value: unknown,
): value is StringTemplateReference {
  return (
    typeof value === "object" &&
    value !== null &&
    "$fromTemplateString" in value &&
    "$values" in value &&
    Array.isArray((value as StringTemplateReference).$values)
  );
}

export function isRawDependencyReference(
  value: unknown,
): value is RawDependencyReference {
  return (
    typeof value === "object" &&
    value !== null &&
    "fromStep" in value &&
    "outputKey" in value
  );
}
