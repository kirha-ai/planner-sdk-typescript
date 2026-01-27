import { describe, expect, it } from "bun:test";
import { parseTemplateString } from "../../src/parser/template-string-parser";

describe("parseTemplateString", () => {
  describe("non-template strings", () => {
    it("should return string as-is when no templates present", () => {
      const stepIdByIndex = new Map<number, string>();

      expect(parseTemplateString("just a regular string", stepIdByIndex)).toBe(
        "just a regular string",
      );
      expect(parseTemplateString("12345", stepIdByIndex)).toBe("12345");
      expect(parseTemplateString("no placeholders here", stepIdByIndex)).toBe(
        "no placeholders here",
      );
    });

    it("should not match incomplete template patterns", () => {
      const stepIdByIndex = new Map([[0, "step-id-1"]]);

      expect(parseTemplateString("{0}", stepIdByIndex)).toEqual({
        $fromTemplateString: "{0}",
        $values: [{ $fromStep: "step-id-1", $outputKey: "" }],
      });
    });
  });

  describe("single template", () => {
    it("should parse valid single template", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);
      const result = parseTemplateString(
        "search data for {0.output}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "search data for {0}",
        $values: [
          {
            $fromStep: "step-id-1",
            $outputKey: "output",
          },
        ],
      });
    });

    it("should parse template with nested path", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);
      const result = parseTemplateString(
        "data: {0.data.output}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "data: {0}",
        $values: [
          {
            $fromStep: "step-id-1",
            $outputKey: "data.output",
          },
        ],
      });
    });

    it("should parse template with array notation", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);
      const result = parseTemplateString(
        "transaction: {0.transactions[0].sender}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "transaction: {0}",
        $values: [
          {
            $fromStep: "step-id-1",
            $outputKey: "transactions[0].sender",
          },
        ],
      });
    });

    it("should parse template with bracket string notation", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);
      const result = parseTemplateString(
        'user: {0.data["user"].name}',
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "user: {0}",
        $values: [
          {
            $fromStep: "step-id-1",
            $outputKey: "data.user.name",
          },
        ],
      });
    });
  });

  describe("multiple templates", () => {
    it("should parse two templates", () => {
      const stepIdByIndex = new Map<number, string>([
        [0, "step-id-1"],
        [1, "step-id-2"],
      ]);

      const result = parseTemplateString(
        "combine {0.result} and {1.info}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "combine {0} and {1}",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "result" },
          { $fromStep: "step-id-2", $outputKey: "info" },
        ],
      });
    });

    it("should parse three templates", () => {
      const stepIdByIndex = new Map<number, string>([
        [0, "step-id-1"],
        [1, "step-id-2"],
        [2, "step-id-3"],
      ]);

      const result = parseTemplateString(
        "combine {0.result} and {1.info} with {2.detail}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "combine {0} and {1} with {2}",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "result" },
          { $fromStep: "step-id-2", $outputKey: "info" },
          { $fromStep: "step-id-3", $outputKey: "detail" },
        ],
      });
    });

    it("should parse same step referenced multiple times", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "Price: {0.price} USD ({0.currency})",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "Price: {0} USD ({1})",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "price" },
          { $fromStep: "step-id-1", $outputKey: "currency" },
        ],
      });
    });

    it("should parse consecutive templates", () => {
      const stepIdByIndex = new Map<number, string>([
        [0, "step-id-1"],
        [1, "step-id-2"],
      ]);

      const result = parseTemplateString("{0.name}{1.value}", stepIdByIndex);

      expect(result).toEqual({
        $fromTemplateString: "{0}{1}",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "name" },
          { $fromStep: "step-id-2", $outputKey: "value" },
        ],
      });
    });
  });

  describe("invalid references", () => {
    it("should preserve template when step index not found", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "data from {1.result} and {0.info}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "data from {1.result} and {0}",
        $values: [{ $fromStep: "step-id-1", $outputKey: "info" }],
      });
    });

    it("should handle all invalid references", () => {
      const stepIdByIndex = new Map<number, string>();

      const result = parseTemplateString(
        "data from {0.result} and {1.info}",
        stepIdByIndex,
      );

      expect(result).toBe("data from {0.result} and {1.info}");
    });

    it("should handle mixed valid and invalid references", () => {
      const stepIdByIndex = new Map<number, string>([
        [0, "step-id-1"],
        [2, "step-id-3"],
      ]);

      const result = parseTemplateString(
        "data {0.a} and {1.b} and {2.c}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "data {0} and {1.b} and {1}",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "a" },
          { $fromStep: "step-id-3", $outputKey: "c" },
        ],
      });
    });
  });

  describe("real-world scenarios", () => {
    it("should parse search query template", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "Latest news about {0.name} ({0.symbol})",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "Latest news about {0} ({1})",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "name" },
          { $fromStep: "step-id-1", $outputKey: "symbol" },
        ],
      });
    });

    it("should parse web search with coin data", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "Search for news about {0.coins.0.name} ({0.coins.0.symbol})",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "Search for news about {0} ({1})",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "coins.0.name" },
          { $fromStep: "step-id-1", $outputKey: "coins.0.symbol" },
        ],
      });
    });

    it("should parse transaction confirmation message", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "Tx {0.result.txHash} confirmed in block {0.result.blockNumber}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "Tx {0} confirmed in block {1}",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "result.txHash" },
          { $fromStep: "step-id-1", $outputKey: "result.blockNumber" },
        ],
      });
    });

    it("should parse company news query", () => {
      const stepIdByIndex = new Map<number, string>([[1, "step-id-2"]]);

      const result = parseTemplateString(
        "{1.name} hires, investments, major partnerships",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "{0} hires, investments, major partnerships",
        $values: [{ $fromStep: "step-id-2", $outputKey: "name" }],
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const stepIdByIndex = new Map<number, string>();
      expect(parseTemplateString("", stepIdByIndex)).toBe("");
    });

    it("should handle very long paths", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "Value: {0.deeply.nested.path.to.value.here}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "Value: {0}",
        $values: [
          {
            $fromStep: "step-id-1",
            $outputKey: "deeply.nested.path.to.value.here",
          },
        ],
      });
    });

    it("should handle template at start of string", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "{0.value} is the result",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "{0} is the result",
        $values: [{ $fromStep: "step-id-1", $outputKey: "value" }],
      });
    });

    it("should handle template at end of string", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString(
        "The result is {0.value}",
        stepIdByIndex,
      );

      expect(result).toEqual({
        $fromTemplateString: "The result is {0}",
        $values: [{ $fromStep: "step-id-1", $outputKey: "value" }],
      });
    });

    it("should handle template as entire string", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      const result = parseTemplateString("{0.value}", stepIdByIndex);

      expect(result).toEqual({
        $fromTemplateString: "{0}",
        $values: [{ $fromStep: "step-id-1", $outputKey: "value" }],
      });
    });

    it("should handle special characters in surrounding text", () => {
      const stepIdByIndex = new Map<number, string>([[0, "step-id-1"]]);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template parsing
      const input = "Price: ${0.price} USD (€{0.priceEur})";
      const result = parseTemplateString(input, stepIdByIndex);

      expect(result).toEqual({
        // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template parsing
        $fromTemplateString: "Price: ${0} USD (€{1})",
        $values: [
          { $fromStep: "step-id-1", $outputKey: "price" },
          { $fromStep: "step-id-1", $outputKey: "priceEur" },
        ],
      });
    });
  });
});
