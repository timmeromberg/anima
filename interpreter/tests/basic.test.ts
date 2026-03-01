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
    `);
    expect(output).toBe('7\nHello, Anima!\nBig number\n1\n2\n3\n4\n5\n');
  });

  conditionalTest('entity creation and field access', () => {
    const output = runProgram(`
      data entity Person(
        val name: String,
        val age: Int
      )

      val person = Person("Alice", 30)
      println(person.name)
      println(person.age)
    `);
    expect(output).toBe('Alice\n30\n');
  });

  conditionalTest('entity toString', () => {
    const output = runProgram(`
      data entity Person(
        val name: String,
        val age: Int
      )

      val person = Person("Alice", 30)
      println(person.toString())
    `);
    expect(output).toBe('Person(name=Alice, age=30)\n');
  });

  conditionalTest('entity equality', () => {
    const output = runProgram(`
      data entity Person(
        val name: String,
        val age: Int
      )

      data entity Pet(
        val name: String,
        val age: Int
      )

      val p1 = Person("Alice", 30)
      val p2 = Person("Alice", 30)
      val p3 = Person("Bob", 30)
      val pet = Pet("Alice", 30)

      println(p1 == p2)
      println(p1 == p3)
      println(p1 == pet)
    `);
    expect(output).toBe('true\nfalse\nfalse\n');
  });

  conditionalTest('entity copy with named arguments', () => {
    const output = runProgram(`
      data entity Person(
        val name: String,
        val age: Int
      )

      val original = Person("Alice", 30)
      val updated = original.copy(age = 31)

      println(original.age)
      println(updated.age)
      println(updated.name)
    `);
    expect(output).toBe('30\n31\nAlice\n');
  });

  conditionalTest('entity destructuring', () => {
    const output = runProgram(`
      data entity Point(
        val x: Int,
        val y: Int
      )

      val (x, y) = Point(3, 4)
      println(x)
      println(y)
    `);
    expect(output).toBe('3\n4\n');
  });

  conditionalTest('entity invariant violation', () => {
    expect(() => runProgram(`
      data entity Person(
        val age: Int
      ) {
        invariant { age >= 0 }
      }

      Person(-1)
    `)).toThrow('Invariant violation in Person');
  });

  conditionalTest('entity type check with is', () => {
    const output = runProgram(`
      data entity Person(
        val name: String
      )

      val person = Person("Alice")
      println(person is Person)
      println(person is String)
      println(42 is Int)
    `);
    expect(output).toBe('true\nfalse\ntrue\n');
  });

  conditionalTest('list distinct', () => {
    const output = runProgram(`
      val numbers = listOf(1, 2, 2, 3, 1)
      println(numbers.distinct())
    `);
    expect(output).toBe('[1, 2, 3]\n');
  });

  conditionalTest('list any/all/none with lambda', () => {
    const output = runProgram(`
      val numbers = listOf(1, 2, 3, 4)
      println(numbers.any { it > 3 })
      println(numbers.all { it > 0 })
      println(numbers.none { it < 0 })
    `);
    expect(output).toBe('true\ntrue\ntrue\n');
  });

  conditionalTest('list reversed, take, drop', () => {
    const output = runProgram(`
      val numbers = listOf(1, 2, 3, 4)
      println(numbers.reversed())
      println(numbers.take(2))
      println(numbers.drop(2))
    `);
    expect(output).toBe('[4, 3, 2, 1]\n[1, 2]\n[3, 4]\n');
  });

  conditionalTest('list find and indexOf', () => {
    const output = runProgram(`
      val numbers = listOf(4, 6, 8)
      println(numbers.find { it > 5 })
      println(numbers.find { it > 10 })
      println(numbers.indexOf(8))
      println(numbers.indexOf(7))
    `);
    expect(output).toBe('6\nnull\n2\n-1\n');
  });

  conditionalTest('list joinToString', () => {
    const output = runProgram(`
      val numbers = listOf(1, 2, 3)
      println(numbers.joinToString(", "))
    `);
    expect(output).toBe('1, 2, 3\n');
  });

  conditionalTest('list zip', () => {
    const output = runProgram(`
      val zipped = listOf(1, 2, 3).zip(listOf("a", "b"))
      println(size(zipped))
      println(zipped[0][0])
      println(zipped[0][1])
      println(zipped[1][0])
      println(zipped[1][1])
    `);
    expect(output).toBe('2\n1\na\n2\nb\n');
  });

  conditionalTest('map getOrDefault', () => {
    const output = runProgram(`
      val values = mapOf("a" to 1)
      println(values.getOrDefault("a", 99))
      println(values.getOrDefault("b", 99))
    `);
    expect(output).toBe('1\n99\n');
  });

  conditionalTest('map put and remove (mutable)', () => {
    const output = runProgram(`
      val values = mutableMapOf("a" to 1, "b" to 2)
      values.put("c", 3)
      println(values["c"])
      values.remove("a")
      println(values.getOrDefault("a", 99))
      println(size(values))
    `);
    expect(output).toBe('3\n99\n2\n');
  });

  conditionalTest('function with expression body', () => {
    const output = runProgram(`
      fun foo(x: Int): Int = x * 2
      println(foo(6))
    `);
    expect(output).toBe('12\n');
  });

  conditionalTest('function with when expression body', () => {
    const output = runProgram(`
      fun classify(x: Int): String = when {
        x > 0 -> "positive"
        x == 0 -> "zero"
        else -> "negative"
      }

      println(classify(2))
      println(classify(0))
      println(classify(-3))
    `);
    expect(output).toBe('positive\nzero\nnegative\n');
  });

  conditionalTest('extension function on String', () => {
    const output = runProgram(`
      fun String.shout(): String = this.uppercase()

      println("hello".shout())
    `);
    expect(output).toBe('HELLO\n');
  });

  conditionalTest('extension function with parameters', () => {
    const output = runProgram(`
      fun Int.add(other: Int): Int = this + other

      println(3.add(4))
    `);
    expect(output).toBe('7\n');
  });

  conditionalTest('extension function on entity', () => {
    const output = runProgram(`
      data entity Person(
        val name: String,
        val age: Int
      )

      fun Person.greet(): String = "Hello, " + this.name

      val p = Person("Alice", 30)
      println(p.greet())
    `);
    expect(output).toBe('Hello, Alice\n');
  });

  conditionalTest('import from another file', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { parse } = require('../src/parser');
    const { Interpreter } = require('../src/interpreter');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-test-'));
    try {
      // Write module file
      fs.writeFileSync(path.join(tmpDir, 'math.anima'),
        'fun add(a: Int, b: Int): Int = a + b\n');

      // Write main file
      const mainPath = path.join(tmpDir, 'main.anima');
      const mainSource = `
        import { add } from "./math"
        fun main() {
          println(add(3, 4))
        }
      `;
      fs.writeFileSync(mainPath, mainSource);

      // Capture stdout
      let output = '';
      const originalWrite = process.stdout.write;
      process.stdout.write = ((str: string) => { output += str; return true; }) as any;

      try {
        const result = parse(mainSource);
        const interpreter = new Interpreter();
        interpreter.run(result.rootNode, mainPath);
      } finally {
        process.stdout.write = originalWrite;
      }

      expect(output).toBe('7\n');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  conditionalTest('confidence annotation and accessors', () => {
    const output = runProgram(`
      val prediction = "cat" @ 0.92
      println(prediction.value)
      println(prediction.confidence)
    `);
    expect(output).toBe('cat\n0.92\n');
  });

  conditionalTest('confidence unwrap and decompose', () => {
    const output = runProgram(`
      val prediction = "cat" @ 0.92
      val raw = prediction.unwrap()
      println(raw)
      val parts = prediction.decompose()
      println(parts[0])
      println(parts[1])
    `);
    expect(output).toBe('cat\ncat\n0.92\n');
  });

  conditionalTest('confidence arithmetic propagation (product rule)', () => {
    const output = runProgram(`
      val x = 10 @ 0.9
      val y = 20 @ 0.8
      val sum = x + y
      println(sum.value)
      println(sum.confidence)
    `);
    expect(output).toBe('30\n0.72\n');
  });

  conditionalTest('confidence with certain operand', () => {
    const output = runProgram(`
      val x = 10 @ 0.9
      val doubled = x * 2
      println(doubled.value)
      println(doubled.confidence)
    `);
    expect(output).toBe('20\n0.9\n');
  });

  conditionalTest('confidence logical operators', () => {
    const output = runProgram(`
      val a = true @ 0.95
      val b = true @ 0.80
      val both = a && b
      println(both.confidence)
      val either = a || b
      println(either.confidence)
      val notA = !a
      println(notA.confidence)
    `);
    // AND: min(0.95, 0.80) = 0.80
    // OR: max(0.95, 0.80) = 0.95
    // NOT: preserves 0.95
    expect(output).toBe('0.8\n0.95\n0.95\n');
  });

  conditionalTest('confidence member access propagation', () => {
    const output = runProgram(`
      data entity Point(val x: Int, val y: Int)
      val p = Point(1, 2) @ 0.85
      println(p.x.value)
      println(p.x.confidence)
    `);
    // Accessing field of a confident entity propagates confidence
    expect(output).toBe('1\n0.85\n');
  });

  conditionalTest('confidence comparison propagation', () => {
    const output = runProgram(`
      val temp = 100.0 @ 0.9
      val threshold = 50.0
      val isHot = temp > threshold
      println(isHot.value)
      println(isHot.confidence)
    `);
    expect(output).toBe('true\n0.9\n');
  });

  conditionalTest('confidence toString', () => {
    const output = runProgram(`
      val x = "hello" @ 0.75
      println(x)
    `);
    expect(output).toBe('hello @ 0.75\n');
  });

  conditionalTest('intent function with fallback', () => {
    const output = runProgram(`
      intent fun doubleIt(x: Int): Int {
        ensure { output > 0 }
        fallback {
          x * 2
        }
      }

      println(doubleIt(5))
    `);
    expect(output).toBe('10\n');
  });

  conditionalTest('intent function ensure violation', () => {
    expect(() => runProgram(`
      intent fun negative(x: Int): Int {
        ensure { output < 0 }
        fallback {
          x * 2
        }
      }

      negative(5)
    `)).toThrow('ensure clause failed');
  });

  conditionalTest('fuzzy predicate with factors', () => {
    const output = runProgram(`
      fuzzy fun isLong(text: String): Boolean {
        factors {
          text.length > 5 weight 0.5
          text.length > 10 weight 0.5
        }
      }

      val short = isLong("hi")
      println(short.value)
      println(short.confidence)

      val medium = isLong("hello world")
      println(medium.value)
      println(medium.confidence)
    `);
    // "hi": length=2, both factors false => confidence 0.0, result false
    // "hello world": length=11, both true => confidence 1.0, result true
    expect(output).toBe('false\n0.0\ntrue\n1.0\n');
  });

  conditionalTest('fuzzy predicate partial match', () => {
    const output = runProgram(`
      fuzzy fun isMedium(text: String): Boolean {
        factors {
          text.length > 3 weight 0.6
          text.length > 20 weight 0.4
        }
      }

      val result = isMedium("hello")
      println(result.value)
      println(result.confidence)
    `);
    // "hello": length=5, factor1 true (0.6), factor2 false (0.0)
    // score = (1.0*0.6 + 0.0*0.4) / 1.0 = 0.6
    // 0.6 >= 0.5 => true
    expect(output).toBe('true\n0.6\n');
  });
});
