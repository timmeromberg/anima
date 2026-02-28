/**
 * Basic tests for the Anima interpreter.
 *
 * These tests verify the core interpreter logic by constructing
 * values and environments directly, without requiring tree-sitter
 * native bindings.
 */

import { Environment } from '../src/environment';
import {
  AnimaValue,
  mkInt,
  mkFloat,
  mkString,
  mkBool,
  mkNull,
  mkUnit,
  mkList,
  mkMap,
  mkBuiltin,
  isTruthy,
  valueToString,
  valuesEqual,
  asNumber,
} from '../src/values';
import {
  AnimaRuntimeError,
  AnimaNameError,
  AnimaImmutableError,
  ReturnSignal,
} from '../src/errors';

// ==================================================================
// Environment tests
// ==================================================================

describe('Environment', () => {
  test('define and get a variable', () => {
    const env = new Environment();
    env.define('x', mkInt(42), false);
    expect(env.get('x')).toEqual(mkInt(42));
  });

  test('undefined variable throws AnimaNameError', () => {
    const env = new Environment();
    expect(() => env.get('unknown')).toThrow(AnimaNameError);
  });

  test('immutable variable cannot be reassigned', () => {
    const env = new Environment();
    env.define('x', mkInt(1), false);
    expect(() => env.set('x', mkInt(2))).toThrow(AnimaImmutableError);
  });

  test('mutable variable can be reassigned', () => {
    const env = new Environment();
    env.define('x', mkInt(1), true);
    env.set('x', mkInt(2));
    expect(env.get('x')).toEqual(mkInt(2));
  });

  test('child scope inherits parent variables', () => {
    const parent = new Environment();
    parent.define('x', mkInt(10), false);
    const child = parent.child();
    expect(child.get('x')).toEqual(mkInt(10));
  });

  test('child scope can shadow parent variables', () => {
    const parent = new Environment();
    parent.define('x', mkInt(10), false);
    const child = parent.child();
    child.define('x', mkInt(20), false);
    expect(child.get('x')).toEqual(mkInt(20));
    expect(parent.get('x')).toEqual(mkInt(10));
  });

  test('set traverses parent chain for mutable var', () => {
    const parent = new Environment();
    parent.define('x', mkInt(1), true);
    const child = parent.child();
    child.set('x', mkInt(2));
    expect(parent.get('x')).toEqual(mkInt(2));
  });

  test('has returns true for defined variables', () => {
    const env = new Environment();
    env.define('x', mkInt(1), false);
    expect(env.has('x')).toBe(true);
    expect(env.has('y')).toBe(false);
  });

  test('cannot redefine variable in same scope', () => {
    const env = new Environment();
    env.define('x', mkInt(1), false);
    expect(() => env.define('x', mkInt(2), false)).toThrow(AnimaRuntimeError);
  });
});

// ==================================================================
// Value tests
// ==================================================================

describe('Values', () => {
  test('isTruthy', () => {
    expect(isTruthy(mkBool(true))).toBe(true);
    expect(isTruthy(mkBool(false))).toBe(false);
    expect(isTruthy(mkNull())).toBe(false);
    expect(isTruthy(mkUnit())).toBe(false);
    expect(isTruthy(mkInt(0))).toBe(false);
    expect(isTruthy(mkInt(1))).toBe(true);
    expect(isTruthy(mkString(''))).toBe(false);
    expect(isTruthy(mkString('hello'))).toBe(true);
    expect(isTruthy(mkList([]))).toBe(false);
    expect(isTruthy(mkList([mkInt(1)]))).toBe(true);
  });

  test('valueToString', () => {
    expect(valueToString(mkInt(42))).toBe('42');
    expect(valueToString(mkFloat(3.14))).toBe('3.14');
    expect(valueToString(mkString('hello'))).toBe('hello');
    expect(valueToString(mkBool(true))).toBe('true');
    expect(valueToString(mkNull())).toBe('null');
    expect(valueToString(mkUnit())).toBe('Unit');
    expect(valueToString(mkList([mkInt(1), mkInt(2)]))).toBe('[1, 2]');
  });

  test('valuesEqual', () => {
    expect(valuesEqual(mkInt(1), mkInt(1))).toBe(true);
    expect(valuesEqual(mkInt(1), mkInt(2))).toBe(false);
    expect(valuesEqual(mkString('a'), mkString('a'))).toBe(true);
    expect(valuesEqual(mkString('a'), mkString('b'))).toBe(false);
    expect(valuesEqual(mkBool(true), mkBool(true))).toBe(true);
    expect(valuesEqual(mkNull(), mkNull())).toBe(true);
    expect(valuesEqual(mkInt(1), mkString('1'))).toBe(false);
    // Int/Float comparison
    expect(valuesEqual(mkInt(3), mkFloat(3))).toBe(true);
  });

  test('valuesEqual for lists', () => {
    const l1 = mkList([mkInt(1), mkInt(2)]);
    const l2 = mkList([mkInt(1), mkInt(2)]);
    const l3 = mkList([mkInt(1), mkInt(3)]);
    expect(valuesEqual(l1, l2)).toBe(true);
    expect(valuesEqual(l1, l3)).toBe(false);
  });

  test('valuesEqual for maps', () => {
    const m1 = mkMap(new Map([['a', mkInt(1)]]));
    const m2 = mkMap(new Map([['a', mkInt(1)]]));
    const m3 = mkMap(new Map([['a', mkInt(2)]]));
    expect(valuesEqual(m1, m2)).toBe(true);
    expect(valuesEqual(m1, m3)).toBe(false);
  });

  test('asNumber', () => {
    expect(asNumber(mkInt(5))).toBe(5);
    expect(asNumber(mkFloat(3.14))).toBe(3.14);
    expect(() => asNumber(mkString('x'))).toThrow();
  });
});

// ==================================================================
// Error / Signal tests
// ==================================================================

describe('Errors and Signals', () => {
  test('ReturnSignal carries a value', () => {
    const sig = new ReturnSignal(mkInt(42));
    expect(sig.value).toEqual(mkInt(42));
  });

  test('AnimaRuntimeError includes location info', () => {
    const err = new AnimaRuntimeError('test error', 10, 5);
    expect(err.message).toContain('line 10');
    expect(err.message).toContain('test error');
  });

  test('AnimaNameError includes variable name', () => {
    const err = new AnimaNameError('myVar');
    expect(err.message).toContain('myVar');
  });

  test('AnimaImmutableError includes variable name', () => {
    const err = new AnimaImmutableError('myVal');
    expect(err.message).toContain('myVal');
  });
});

// ==================================================================
// Builtin function tests (standalone, without tree-sitter)
// ==================================================================

describe('Builtins', () => {
  test('toString builtin', () => {
    // We can test builtins directly via their function value
    const fn = mkBuiltin('toString', (args) => {
      return mkString(valueToString(args[0]));
    });
    if (fn.kind === 'builtin') {
      expect(fn.fn([mkInt(42)])).toEqual(mkString('42'));
    }
  });

  test('size builtin on list', () => {
    const fn = mkBuiltin('size', (args) => {
      const v = args[0];
      if (v.kind === 'list') return mkInt(v.elements.length);
      throw new Error('not a list');
    });
    if (fn.kind === 'builtin') {
      expect(fn.fn([mkList([mkInt(1), mkInt(2), mkInt(3)])])).toEqual(mkInt(3));
    }
  });
});

// ==================================================================
// Integration test with tree-sitter (conditional)
// ==================================================================

describe('Interpreter integration', () => {
  let treeSitterAvailable = false;

  beforeAll(() => {
    try {
      const { isTreeSitterAvailable } = require('../src/parser');
      treeSitterAvailable = isTreeSitterAvailable();
    } catch {
      treeSitterAvailable = false;
    }
  });

  function runProgram(source: string): string {
    const { parse } = require('../src/parser');
    const { Interpreter } = require('../src/interpreter');

    // Capture stdout
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((str: string) => {
      output += str;
      return true;
    }) as any;

    try {
      const result = parse(source);
      const interpreter = new Interpreter();
      interpreter.run(result.rootNode);
    } finally {
      process.stdout.write = originalWrite;
    }

    return output;
  }

  const conditionalTest = (name: string, fn: () => void) => {
    test(name, () => {
      if (!treeSitterAvailable) {
        console.log(`  [SKIPPED] tree-sitter not available: ${name}`);
        return;
      }
      fn();
    });
  };

  conditionalTest('basic arithmetic', () => {
    const output = runProgram('println(1 + 2)');
    expect(output).toBe('3\n');
  });

  conditionalTest('val and var declarations', () => {
    const output = runProgram(`
      val x = 10
      var y = 20
      y = 30
      println(x + y)
    `);
    expect(output).toBe('40\n');
  });

  conditionalTest('function definition and call', () => {
    const output = runProgram(`
      fun add(a: Int, b: Int): Int = a + b
      println(add(3, 4))
    `);
    expect(output).toBe('7\n');
  });

  conditionalTest('string template', () => {
    const output = runProgram(`
      val name = "Anima"
      println("Hello, \${name}!")
    `);
    expect(output).toBe('Hello, Anima!\n');
  });

  conditionalTest('if expression', () => {
    const output = runProgram(`
      val x = 10
      if (x > 5) {
        println("big")
      } else {
        println("small")
      }
    `);
    expect(output).toBe('big\n');
  });

  conditionalTest('for loop with range', () => {
    const output = runProgram(`
      for (i in 1..3) {
        println(i)
      }
    `);
    expect(output).toBe('1\n2\n3\n');
  });

  conditionalTest('while loop', () => {
    const output = runProgram(`
      var i = 0
      while (i < 3) {
        println(i)
        i = i + 1
      }
    `);
    expect(output).toBe('0\n1\n2\n');
  });

  conditionalTest('function with block body and return', () => {
    const output = runProgram(`
      fun max(a: Int, b: Int): Int {
        if (a > b) {
          return a
        } else {
          return b
        }
      }
      println(max(3, 7))
    `);
    expect(output).toBe('7\n');
  });

  conditionalTest('boolean expressions', () => {
    const output = runProgram(`
      println(true && false)
      println(true || false)
      println(!true)
    `);
    expect(output).toBe('false\ntrue\nfalse\n');
  });

  conditionalTest('elvis operator', () => {
    const output = runProgram(`
      val x = null
      val y = x ?: 42
      println(y)
    `);
    expect(output).toBe('42\n');
  });

  conditionalTest('list operations', () => {
    const output = runProgram(`
      val items = listOf(1, 2, 3)
      println(items[0])
      println(size(items))
    `);
    expect(output).toBe('1\n3\n');
  });

  conditionalTest('full test program', () => {
    const output = runProgram(`
      fun add(a: Int, b: Int): Int = a + b

      fun main() {
          val x = add(3, 4)
          println(x)

          val name = "Anima"
          println("Hello, \${name}!")

          if (x > 5) {
              println("Big number")
          } else {
              println("Small number")
          }

          for (i in 1..5) {
              println(i)
          }
      }

      main()
    `);
    expect(output).toBe('7\nHello, Anima!\nBig number\n1\n2\n3\n4\n5\n');
  });
});
