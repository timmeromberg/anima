/**
 * Tests for the Anima type checker.
 *
 * Uses tree-sitter to parse real Anima code, then runs the TypeChecker
 * and asserts on the produced diagnostics.
 */

import { TypeChecker } from '../src/checker';
import { Diagnostic } from '../src/diagnostics';

// ---- tree-sitter setup ----

let Parser: any;
let AnimaLanguage: any;
let treeSitterAvailable = false;

try {
  Parser = require('tree-sitter');
  AnimaLanguage = require('tree-sitter-anima');
  treeSitterAvailable = true;
} catch (e) {
  // tree-sitter not available — tests will be skipped
}

function parse(source: string): any {
  const parser = new Parser();
  parser.setLanguage(AnimaLanguage);
  return parser.parse(source).rootNode;
}

/** Helper: run the checker on Anima source code and return diagnostics. */
function check(source: string): Diagnostic[] {
  const checker = new TypeChecker();
  return checker.check(parse(source));
}

/** Find diagnostics matching a pattern. */
function errorsMatching(ds: Diagnostic[], pattern: string | RegExp): Diagnostic[] {
  return ds.filter(d =>
    d.severity === 'error' &&
    (typeof pattern === 'string' ? d.message.includes(pattern) : pattern.test(d.message)),
  );
}

function warningsMatching(ds: Diagnostic[], pattern: string | RegExp): Diagnostic[] {
  return ds.filter(d =>
    d.severity === 'warning' &&
    (typeof pattern === 'string' ? d.message.includes(pattern) : pattern.test(d.message)),
  );
}

// ---- Tests ----

const describeIfTs = treeSitterAvailable ? describe : describe.skip;

describeIfTs('TypeChecker', () => {
  // ---- Undefined variable detection ----

  describe('undefined variables', () => {
    it('reports error for undefined variable', () => {
      const ds = check('val x = unknownVar');
      expect(errorsMatching(ds, "Undefined variable 'unknownVar'").length).toBeGreaterThan(0);
    });

    it('does not report error for defined variable', () => {
      const ds = check(`
        val x = 42
        val y = x
      `);
      expect(errorsMatching(ds, 'Undefined')).toHaveLength(0);
    });

    it('does not report error for builtin functions', () => {
      const ds = check('println("hello")');
      expect(errorsMatching(ds, "Undefined function 'println'")).toHaveLength(0);
    });

    it('reports error for undefined function in call', () => {
      const ds = check('val x = missingFn(1, 2)');
      expect(errorsMatching(ds, "Undefined function 'missingFn'").length).toBeGreaterThan(0);
    });

    it('does not report error for val used after declaration', () => {
      const ds = check(`
        val greeting = "hello"
        val message = greeting
      `);
      expect(errorsMatching(ds, 'Undefined')).toHaveLength(0);
    });
  });

  // ---- Function argument count ----

  describe('function argument count', () => {
    it('reports error when too few arguments', () => {
      const ds = check(`
        fun add(a: Int, b: Int): Int = a + b
        val x = add(1)
      `);
      expect(errorsMatching(ds, 'expects at least 2 argument(s) but got 1').length).toBeGreaterThan(0);
    });

    it('reports warning when too many arguments', () => {
      const ds = check(`
        fun greet(name: String): String = name
        val x = greet("Alice", "Bob", "Charlie")
      `);
      expect(warningsMatching(ds, 'expects at most 1 argument(s) but got 3').length).toBeGreaterThan(0);
    });

    it('does not report error for correct argument count', () => {
      const ds = check(`
        fun add(a: Int, b: Int): Int = a + b
        val x = add(1, 2)
      `);
      expect(errorsMatching(ds, 'expects at least')).toHaveLength(0);
      expect(warningsMatching(ds, 'expects at most')).toHaveLength(0);
    });
  });

  // ---- Binary expression type checking ----

  describe('binary expression types', () => {
    it('warns on arithmetic with bool operand', () => {
      const ds = check('val x = true + 1');
      expect(warningsMatching(ds, /incompatible types/).length).toBeGreaterThan(0);
    });

    it('does not warn on string concatenation', () => {
      const ds = check('val x = "hello" + " world"');
      expect(warningsMatching(ds, /incompatible types/)).toHaveLength(0);
    });

    it('does not warn on int arithmetic', () => {
      const ds = check('val x = 1 + 2');
      expect(warningsMatching(ds, /incompatible types/)).toHaveLength(0);
    });

    it('does not warn on mixed int/float arithmetic', () => {
      const ds = check('val x = 1 + 2.0');
      expect(warningsMatching(ds, /incompatible types/)).toHaveLength(0);
    });
  });

  // ---- Entity field access ----

  describe('entity field access', () => {
    it('reports error for unknown field on entity', () => {
      const ds = check(`
        data entity Person(val name: String, val age: Int)
        val p = Person("Alice", 30)
        val x = p.nonexistent
      `);
      expect(errorsMatching(ds, "Property 'nonexistent' does not exist on type 'Person'").length).toBeGreaterThan(0);
    });

    it('does not report error for valid field access', () => {
      const ds = check(`
        data entity Person(val name: String, val age: Int)
        val p = Person("Alice", 30)
        val n = p.name
      `);
      expect(errorsMatching(ds, 'does not exist')).toHaveLength(0);
    });
  });

  // ---- Type inference for basic expressions ----

  describe('type inference', () => {
    it('infers int type from int literal', () => {
      // No errors for arithmetic on inferred ints
      const ds = check(`
        val x = 42
        val y = x + 1
      `);
      expect(warningsMatching(ds, /incompatible types/)).toHaveLength(0);
    });

    it('infers string type from string literal', () => {
      // String + String is fine
      const ds = check(`
        val x = "hello"
        val y = x + " world"
      `);
      expect(warningsMatching(ds, /incompatible types/)).toHaveLength(0);
    });

    it('infers bool type from bool literal', () => {
      const ds = check('val x = true');
      expect(errorsMatching(ds, 'Undefined')).toHaveLength(0);
    });
  });

  // ---- Function body checking ----

  describe('function bodies', () => {
    it('checks function body with parameters in scope', () => {
      const ds = check(`
        fun greet(name: String): String = "Hello, " + name
      `);
      expect(errorsMatching(ds, 'Undefined')).toHaveLength(0);
    });

    it('reports undefined variable in function body', () => {
      const ds = check(`
        fun greet(name: String): String = "Hello, " + unknownInBody
      `);
      expect(errorsMatching(ds, "Undefined variable 'unknownInBody'").length).toBeGreaterThan(0);
    });
  });

  // ---- Sealed types ----

  describe('sealed types', () => {
    it('registers sealed variants and does not report errors', () => {
      const ds = check(`
        sealed class Shape {
          data class Circle(val radius: Float) : Shape()
          data class Rect(val width: Float, val height: Float) : Shape()
        }
        val c = Circle(3.14)
      `);
      expect(errorsMatching(ds, "Undefined function 'Circle'")).toHaveLength(0);
    });
  });

  // ---- No false positives for common patterns ----

  describe('common patterns', () => {
    it('handles literal-only program with no errors', () => {
      const ds = check('val x = 42');
      expect(errorsMatching(ds, 'Undefined')).toHaveLength(0);
    });

    it('handles multiple declarations with no false positives', () => {
      const ds = check(`
        val a = 1
        val b = 2
        val c = a + b
      `);
      expect(errorsMatching(ds, 'Undefined')).toHaveLength(0);
      expect(warningsMatching(ds, /incompatible/)).toHaveLength(0);
    });

    it('handles function declarations and calls', () => {
      const ds = check(`
        fun double(x: Int): Int = x + x
        val result = double(21)
      `);
      expect(errorsMatching(ds, 'Undefined')).toHaveLength(0);
    });
  });

  // ---- Logical operator warnings ----

  describe('logical operators', () => {
    it('warns when non-bool used with &&', () => {
      const ds = check('val x = 1 && 2');
      expect(warningsMatching(ds, /should be Bool/).length).toBeGreaterThan(0);
    });
  });
});
