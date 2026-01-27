import { describe, expect, it } from "bun:test";
import {
  extractDependencyStepIds,
  formatPath,
  getNestedValue,
  isDependencyReference,
  isNumericString,
  isRawDependencyReference,
  isStringTemplateReference,
  normalizePath,
  parsePath,
  traverseReferences,
  type Path,
} from "../src/utils";

describe("isDependencyReference", () => {
  it("should return true for valid dependency reference", () => {
    expect(
      isDependencyReference({ $fromStep: "step-1", $outputKey: "result" }),
    ).toBe(true);
  });

  it("should return false for raw dependency reference format", () => {
    expect(isDependencyReference({ fromStep: 0, outputKey: "result" })).toBe(
      false,
    );
  });

  it("should return false for missing $fromStep", () => {
    expect(isDependencyReference({ $outputKey: "result" })).toBe(false);
  });

  it("should return false for missing $outputKey", () => {
    expect(isDependencyReference({ $fromStep: "step-1" })).toBe(false);
  });

  it("should return false for null", () => {
    expect(isDependencyReference(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isDependencyReference(undefined)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isDependencyReference("string")).toBe(false);
    expect(isDependencyReference(123)).toBe(false);
    expect(isDependencyReference(true)).toBe(false);
  });

  it("should return false for arrays", () => {
    expect(isDependencyReference([])).toBe(false);
    expect(
      isDependencyReference([{ $fromStep: "step-1", $outputKey: "result" }]),
    ).toBe(false);
  });
});

describe("isStringTemplateReference", () => {
  it("should return true for valid string template reference", () => {
    expect(
      isStringTemplateReference({
        $fromTemplateString: "Hello {0}",
        $values: [{ $fromStep: "step-1", $outputKey: "name" }],
      }),
    ).toBe(true);
  });

  it("should return true for empty $values array", () => {
    expect(
      isStringTemplateReference({
        $fromTemplateString: "Hello world",
        $values: [],
      }),
    ).toBe(true);
  });

  it("should return false for missing $fromTemplateString", () => {
    expect(
      isStringTemplateReference({
        $values: [{ $fromStep: "step-1", $outputKey: "name" }],
      }),
    ).toBe(false);
  });

  it("should return false for missing $values", () => {
    expect(
      isStringTemplateReference({
        $fromTemplateString: "Hello {0}",
      }),
    ).toBe(false);
  });

  it("should return false when $values is not an array", () => {
    expect(
      isStringTemplateReference({
        $fromTemplateString: "Hello {0}",
        $values: { $fromStep: "step-1", $outputKey: "name" },
      }),
    ).toBe(false);
  });

  it("should return false for null", () => {
    expect(isStringTemplateReference(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isStringTemplateReference(undefined)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isStringTemplateReference("string")).toBe(false);
    expect(isStringTemplateReference(123)).toBe(false);
    expect(isStringTemplateReference(true)).toBe(false);
  });
});

describe("isRawDependencyReference", () => {
  it("should return true for valid raw dependency reference", () => {
    expect(isRawDependencyReference({ fromStep: 0, outputKey: "result" })).toBe(
      true,
    );
  });

  it("should return true for non-zero step index", () => {
    expect(isRawDependencyReference({ fromStep: 5, outputKey: "data" })).toBe(
      true,
    );
  });

  it("should return false for transformed dependency reference format", () => {
    expect(
      isRawDependencyReference({ $fromStep: "step-1", $outputKey: "result" }),
    ).toBe(false);
  });

  it("should return false for missing fromStep", () => {
    expect(isRawDependencyReference({ outputKey: "result" })).toBe(false);
  });

  it("should return false for missing outputKey", () => {
    expect(isRawDependencyReference({ fromStep: 0 })).toBe(false);
  });

  it("should return false for null", () => {
    expect(isRawDependencyReference(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isRawDependencyReference(undefined)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isRawDependencyReference("string")).toBe(false);
    expect(isRawDependencyReference(123)).toBe(false);
    expect(isRawDependencyReference(true)).toBe(false);
  });

  it("should return false for arrays", () => {
    expect(isRawDependencyReference([])).toBe(false);
    expect(
      isRawDependencyReference([{ fromStep: 0, outputKey: "result" }]),
    ).toBe(false);
  });
});

describe("parsePath", () => {
  it("should return empty array for empty string", () => {
    expect(parsePath("")).toEqual([]);
  });

  it("should parse simple dot notation", () => {
    expect(parsePath("foo")).toEqual(["foo"]);
    expect(parsePath("foo.bar")).toEqual(["foo", "bar"]);
    expect(parsePath("foo.bar.baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("should parse bracket notation with numbers", () => {
    expect(parsePath("items[0]")).toEqual(["items", 0]);
    expect(parsePath("items[0].name")).toEqual(["items", 0, "name"]);
    expect(parsePath("data[5].value")).toEqual(["data", 5, "value"]);
  });

  it("should parse bracket notation with double quotes", () => {
    expect(parsePath('data["user"]')).toEqual(["data", "user"]);
    expect(parsePath('data["user"].name')).toEqual(["data", "user", "name"]);
  });

  it("should parse bracket notation with single quotes", () => {
    expect(parsePath("data['user']")).toEqual(["data", "user"]);
    expect(parsePath("data['user'].name")).toEqual(["data", "user", "name"]);
  });

  it("should parse mixed notation", () => {
    expect(parsePath('users[0].addresses["home"].street')).toEqual([
      "users",
      0,
      "addresses",
      "home",
      "street",
    ]);
  });

  it("should filter empty segments", () => {
    expect(parsePath(".foo..bar.")).toEqual(["foo", "bar"]);
  });

  it("should handle keys with special characters in quotes", () => {
    expect(parsePath('data["key with spaces"]')).toEqual([
      "data",
      "key with spaces",
    ]);
    expect(parsePath("data['special-key']")).toEqual(["data", "special-key"]);
  });
});

describe("normalizePath", () => {
  it("should return empty string for empty input", () => {
    expect(normalizePath("")).toBe("");
  });

  it("should keep simple dot notation", () => {
    expect(normalizePath("foo.bar")).toBe("foo.bar");
  });

  it("should convert bracket notation to dot notation", () => {
    expect(normalizePath("items[0]")).toBe("items[0]");
    expect(normalizePath("items[0].name")).toBe("items[0].name");
  });

  it("should convert quoted brackets to dot notation", () => {
    expect(normalizePath('data["user"]')).toBe("data.user");
    expect(normalizePath("data['user']")).toBe("data.user");
  });

  it("should handle mixed notation", () => {
    expect(normalizePath('users[0].addresses["home"]')).toBe(
      "users[0].addresses.home",
    );
  });
});

describe("formatPath", () => {
  it("should return empty string for empty array", () => {
    expect(formatPath([])).toBe("");
  });

  it("should format simple path", () => {
    expect(formatPath(["foo"])).toBe("foo");
    expect(formatPath(["foo", "bar"])).toBe("foo.bar");
  });

  it("should format array indices with brackets", () => {
    expect(formatPath(["items", 0])).toBe("items[0]");
    expect(formatPath(["items", 0, "name"])).toBe("items[0].name");
  });

  it("should format mixed paths", () => {
    expect(formatPath(["users", 0, "addresses", "home"])).toBe(
      "users[0].addresses.home",
    );
  });

  it("should round-trip with parsePath", () => {
    const paths = [
      ["foo", "bar"],
      ["items", 0, "name"],
      ["users", 0, "addresses", 1, "street"],
    ];

    for (const path of paths) {
      const formatted = formatPath(path);
      const parsed = parsePath(formatted);
      expect(parsed).toEqual(path);
    }
  });
});

describe("isNumericString", () => {
  it("should return true for numeric strings", () => {
    expect(isNumericString("0")).toBe(true);
    expect(isNumericString("1")).toBe(true);
    expect(isNumericString("123")).toBe(true);
    expect(isNumericString("999999")).toBe(true);
  });

  it("should return false for non-numeric strings", () => {
    expect(isNumericString("")).toBe(false);
    expect(isNumericString("abc")).toBe(false);
    expect(isNumericString("12a")).toBe(false);
    expect(isNumericString("a12")).toBe(false);
    expect(isNumericString("1.5")).toBe(false);
    expect(isNumericString("-1")).toBe(false);
    expect(isNumericString("1e5")).toBe(false);
  });

  it("should return false for strings that look numeric but have special chars", () => {
    expect(isNumericString("2023年")).toBe(false);
    expect(isNumericString(" 123")).toBe(false);
    expect(isNumericString("123 ")).toBe(false);
  });
});

describe("getNestedValue", () => {
  it("should return object for empty path", () => {
    const obj = { foo: "bar" };
    expect(getNestedValue(obj, [])).toBe(obj);
  });

  it("should get simple property", () => {
    expect(getNestedValue({ foo: "bar" }, ["foo"])).toBe("bar");
  });

  it("should get nested property", () => {
    const obj = { foo: { bar: { baz: "value" } } };
    expect(getNestedValue(obj, ["foo", "bar", "baz"])).toBe("value");
  });

  it("should get array element", () => {
    expect(getNestedValue({ items: ["a", "b"] }, ["items", 0])).toBe("a");
    expect(getNestedValue({ items: ["a", "b"] }, ["items", 1])).toBe("b");
  });

  it("should get nested array element property", () => {
    const obj = { users: [{ name: "Alice" }, { name: "Bob" }] };
    expect(getNestedValue(obj, ["users", 0, "name"])).toBe("Alice");
  });

  it("should return undefined for missing path", () => {
    expect(getNestedValue({ foo: "bar" }, ["baz"])).toBeUndefined();
  });

  it("should return undefined when traversing null", () => {
    expect(getNestedValue({ foo: null }, ["foo", "bar"])).toBeUndefined();
  });

  it("should return undefined for number index on non-array", () => {
    expect(getNestedValue({ foo: "bar" }, ["foo", 0])).toBeUndefined();
  });

  it("should work with parsePath", () => {
    const obj = { users: [{ name: "Alice" }] };
    expect(getNestedValue(obj, parsePath("users[0].name"))).toBe("Alice");
  });

  it("should return undefined for out of bounds array access", () => {
    const obj = { items: ["a", "b", "c"] };
    expect(getNestedValue(obj, ["items", 10])).toBeUndefined();
    expect(getNestedValue(obj, ["items", -1])).toBeUndefined();
  });
});

describe("traverseReferences", () => {
  it("should call onDependency for dependency references", () => {
    const deps: Array<{ ref: unknown; path: Path }> = [];
    const value = {
      input: { $fromStep: "step-1", $outputKey: "result" },
    };

    traverseReferences(value, {
      onDependency: (ref, path) => deps.push({ ref, path }),
    });

    expect(deps).toHaveLength(1);
    expect(deps[0]?.path).toEqual(["input"]);
  });

  it("should call onTemplate for template references", () => {
    const templates: Array<{ ref: unknown; path: Path }> = [];
    const value = {
      query: {
        $fromTemplateString: "Hello {0}",
        $values: [{ $fromStep: "step-1", $outputKey: "name" }],
      },
    };

    traverseReferences(value, {
      onTemplate: (ref, path) => templates.push({ ref, path }),
    });

    expect(templates).toHaveLength(1);
    expect(templates[0]?.path).toEqual(["query"]);
  });

  it("should traverse arrays", () => {
    const deps: Path[] = [];
    const value = {
      items: [
        { $fromStep: "step-1", $outputKey: "a" },
        { $fromStep: "step-2", $outputKey: "b" },
      ],
    };

    traverseReferences(value, {
      onDependency: (_, path) => deps.push(path),
    });

    expect(deps).toEqual([
      ["items", 0],
      ["items", 1],
    ]);
  });

  it("should traverse nested objects", () => {
    const deps: Path[] = [];
    const value = {
      outer: {
        inner: { $fromStep: "step-1", $outputKey: "x" },
      },
    };

    traverseReferences(value, {
      onDependency: (_, path) => deps.push(path),
    });

    expect(deps).toEqual([["outer", "inner"]]);
  });

  it("should not call callbacks for primitives", () => {
    const calls: unknown[] = [];
    const value = {
      str: "hello",
      num: 123,
      bool: true,
      nil: null,
    };

    traverseReferences(value, {
      onDependency: (ref) => calls.push(ref),
      onTemplate: (ref) => calls.push(ref),
    });

    expect(calls).toHaveLength(0);
  });

  it("should handle root value being a reference", () => {
    const deps: Path[] = [];
    const value = { $fromStep: "step-1", $outputKey: "result" };

    traverseReferences(value, {
      onDependency: (_, path) => deps.push(path),
    });

    expect(deps).toEqual([[]]);
  });

  it("should handle root value being a template reference", () => {
    const templates: Path[] = [];
    const value = {
      $fromTemplateString: "Hello {0}",
      $values: [{ $fromStep: "step-1", $outputKey: "name" }],
    };

    traverseReferences(value, {
      onTemplate: (_, path) => templates.push(path),
    });

    expect(templates).toEqual([[]]);
  });
});

describe("extractDependencyStepIds", () => {
  it("should return empty array for no dependencies", () => {
    expect(extractDependencyStepIds({ foo: "bar" })).toEqual([]);
  });

  it("should extract step ID from dependency reference", () => {
    const args = {
      input: { $fromStep: "step-1", $outputKey: "result" },
    };
    expect(extractDependencyStepIds(args)).toEqual(["step-1"]);
  });

  it("should extract step IDs from template reference", () => {
    const args = {
      query: {
        $fromTemplateString: "{0} and {1}",
        $values: [
          { $fromStep: "step-1", $outputKey: "a" },
          { $fromStep: "step-2", $outputKey: "b" },
        ],
      },
    };
    expect(extractDependencyStepIds(args).sort()).toEqual(["step-1", "step-2"]);
  });

  it("should deduplicate step IDs", () => {
    const args = {
      a: { $fromStep: "step-1", $outputKey: "x" },
      b: { $fromStep: "step-1", $outputKey: "y" },
    };
    expect(extractDependencyStepIds(args)).toEqual(["step-1"]);
  });

  it("should extract from nested structures", () => {
    const args = {
      items: [
        { $fromStep: "step-1", $outputKey: "a" },
        {
          nested: { $fromStep: "step-2", $outputKey: "b" },
        },
      ],
    };
    expect(extractDependencyStepIds(args).sort()).toEqual(["step-1", "step-2"]);
  });
});
