import { isSubtype } from '../src/subtyping';
import {
  AnimaType,
  mkIntType,
  mkFloatType,
  mkStringType,
  mkBoolType,
  mkNullType,
  mkUnitType,
  mkAnyType,
  mkNothingType,
  mkNullableType,
  mkListType,
  mkMapType,
  mkSetType,
  mkEntityType,
  mkSealedType,
  mkFunctionType,
  mkTupleType,
  mkUnionType,
  mkIntersectionType,
  mkConfidentType,
  mkTypeAlias,
  ParamType,
} from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function param(name: string, type: AnimaType): ParamType {
  return { name, type, hasDefault: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isSubtype', () => {
  // -- Reflexivity (primitive identity) -----------------------------------

  describe('reflexivity', () => {
    const primitives: AnimaType[] = [
      mkIntType(),
      mkFloatType(),
      mkStringType(),
      mkBoolType(),
      mkNullType(),
      mkUnitType(),
      mkAnyType(),
      mkNothingType(),
    ];

    for (const t of primitives) {
      it(`${t.tag} <: ${t.tag}`, () => {
        expect(isSubtype(t, t)).toBe(true);
      });
    }
  });

  // -- Top and bottom -----------------------------------------------------

  describe('Any (top type)', () => {
    it('Int <: Any', () => {
      expect(isSubtype(mkIntType(), mkAnyType())).toBe(true);
    });
    it('String <: Any', () => {
      expect(isSubtype(mkStringType(), mkAnyType())).toBe(true);
    });
    it('Null <: Any', () => {
      expect(isSubtype(mkNullType(), mkAnyType())).toBe(true);
    });
    it('List<Int> <: Any', () => {
      expect(isSubtype(mkListType(mkIntType()), mkAnyType())).toBe(true);
    });
  });

  describe('Nothing (bottom type)', () => {
    it('Nothing <: Int', () => {
      expect(isSubtype(mkNothingType(), mkIntType())).toBe(true);
    });
    it('Nothing <: String?', () => {
      expect(isSubtype(mkNothingType(), mkNullableType(mkStringType()))).toBe(true);
    });
    it('Nothing <: Any', () => {
      expect(isSubtype(mkNothingType(), mkAnyType())).toBe(true);
    });
    it('Int is NOT <: Nothing', () => {
      expect(isSubtype(mkIntType(), mkNothingType())).toBe(false);
    });
  });

  // -- Numeric widening ---------------------------------------------------

  describe('numeric widening', () => {
    it('Int <: Float', () => {
      expect(isSubtype(mkIntType(), mkFloatType())).toBe(true);
    });
    it('Float is NOT <: Int', () => {
      expect(isSubtype(mkFloatType(), mkIntType())).toBe(false);
    });
  });

  // -- Nullable -----------------------------------------------------------

  describe('nullable', () => {
    it('String <: String?', () => {
      expect(isSubtype(mkStringType(), mkNullableType(mkStringType()))).toBe(true);
    });
    it('Null <: String?', () => {
      expect(isSubtype(mkNullType(), mkNullableType(mkStringType()))).toBe(true);
    });
    it('String? is NOT <: String', () => {
      expect(isSubtype(mkNullableType(mkStringType()), mkStringType())).toBe(false);
    });
    it('Int <: Float? (widening + nullable)', () => {
      expect(isSubtype(mkIntType(), mkNullableType(mkFloatType()))).toBe(true);
    });
    it('Int? <: Float?', () => {
      expect(isSubtype(mkNullableType(mkIntType()), mkNullableType(mkFloatType()))).toBe(true);
    });
    it('Float? is NOT <: Int?', () => {
      expect(isSubtype(mkNullableType(mkFloatType()), mkNullableType(mkIntType()))).toBe(false);
    });
  });

  // -- Entity / sealed ----------------------------------------------------

  describe('entity <: sealed parent', () => {
    const shape = mkSealedType('Shape', ['Circle', 'Rect']);
    const circle = mkEntityType('Circle', [], 'Shape');
    const rect = mkEntityType('Rect', [], 'Shape');
    const unrelated = mkEntityType('Dog', [], undefined);

    it('Circle <: Shape', () => {
      expect(isSubtype(circle, shape)).toBe(true);
    });
    it('Rect <: Shape', () => {
      expect(isSubtype(rect, shape)).toBe(true);
    });
    it('Shape is NOT <: Circle', () => {
      expect(isSubtype(shape, circle)).toBe(false);
    });
    it('Dog is NOT <: Shape', () => {
      expect(isSubtype(unrelated, shape)).toBe(false);
    });
  });

  // -- List covariance ----------------------------------------------------

  describe('list covariance', () => {
    it('List<Int> <: List<Float> (immutable, covariant)', () => {
      expect(isSubtype(mkListType(mkIntType()), mkListType(mkFloatType()))).toBe(true);
    });
    it('List<Float> is NOT <: List<Int>', () => {
      expect(isSubtype(mkListType(mkFloatType()), mkListType(mkIntType()))).toBe(false);
    });
    it('MutableList<Int> is NOT <: MutableList<Float> (invariant)', () => {
      expect(isSubtype(mkListType(mkIntType(), true), mkListType(mkFloatType(), true))).toBe(false);
    });
    it('MutableList<Int> <: MutableList<Int> (same type, mutable)', () => {
      expect(isSubtype(mkListType(mkIntType(), true), mkListType(mkIntType(), true))).toBe(true);
    });
  });

  // -- Map covariance -----------------------------------------------------

  describe('map covariance', () => {
    it('Map<String, Int> <: Map<String, Float>', () => {
      expect(
        isSubtype(
          mkMapType(mkStringType(), mkIntType()),
          mkMapType(mkStringType(), mkFloatType()),
        ),
      ).toBe(true);
    });
    it('MutableMap<String, Int> is NOT <: MutableMap<String, Float>', () => {
      expect(
        isSubtype(
          mkMapType(mkStringType(), mkIntType(), true),
          mkMapType(mkStringType(), mkFloatType(), true),
        ),
      ).toBe(false);
    });
  });

  // -- Set covariance -----------------------------------------------------

  describe('set covariance', () => {
    it('Set<Int> <: Set<Float>', () => {
      expect(isSubtype(mkSetType(mkIntType()), mkSetType(mkFloatType()))).toBe(true);
    });
    it('MutableSet<Int> is NOT <: MutableSet<Float>', () => {
      expect(isSubtype(mkSetType(mkIntType(), true), mkSetType(mkFloatType(), true))).toBe(false);
    });
  });

  // -- Function types (contra / co) ---------------------------------------

  describe('function subtyping', () => {
    // (Float) -> Int  <:  (Int) -> Float
    // params: Int <: Float  (contravariant — supertype param is OK)
    // return: Int <: Float  (covariant)
    it('contravariant params, covariant return', () => {
      const sub = mkFunctionType([param('x', mkFloatType())], mkIntType());
      const sup = mkFunctionType([param('x', mkIntType())], mkFloatType());
      expect(isSubtype(sub, sup)).toBe(true);
    });

    it('covariant params fails', () => {
      // (Int) -> Int  is NOT <:  (Float) -> Int
      const sub = mkFunctionType([param('x', mkIntType())], mkIntType());
      const sup = mkFunctionType([param('x', mkFloatType())], mkIntType());
      expect(isSubtype(sub, sup)).toBe(false);
    });

    it('different arity fails', () => {
      const sub = mkFunctionType([param('x', mkIntType())], mkIntType());
      const sup = mkFunctionType(
        [param('x', mkIntType()), param('y', mkIntType())],
        mkIntType(),
      );
      expect(isSubtype(sub, sup)).toBe(false);
    });
  });

  // -- Tuple --------------------------------------------------------------

  describe('tuple subtyping', () => {
    it('(Int, String) <: (Float, String)', () => {
      expect(
        isSubtype(
          mkTupleType([mkIntType(), mkStringType()]),
          mkTupleType([mkFloatType(), mkStringType()]),
        ),
      ).toBe(true);
    });
    it('different lengths fail', () => {
      expect(
        isSubtype(mkTupleType([mkIntType()]), mkTupleType([mkIntType(), mkStringType()])),
      ).toBe(false);
    });
  });

  // -- Union / intersection -----------------------------------------------

  describe('union', () => {
    const intOrString = mkUnionType([mkIntType(), mkStringType()]);

    it('Int <: Int | String', () => {
      expect(isSubtype(mkIntType(), intOrString)).toBe(true);
    });
    it('String <: Int | String', () => {
      expect(isSubtype(mkStringType(), intOrString)).toBe(true);
    });
    it('Bool is NOT <: Int | String', () => {
      expect(isSubtype(mkBoolType(), intOrString)).toBe(false);
    });
    it('Int | String <: Any', () => {
      expect(isSubtype(intOrString, mkAnyType())).toBe(true);
    });
    it('Int | String is NOT <: Int', () => {
      expect(isSubtype(intOrString, mkIntType())).toBe(false);
    });
  });

  describe('intersection', () => {
    const aAndB = mkIntersectionType([mkIntType(), mkFloatType()]);

    it('Int & Float <: Int', () => {
      expect(isSubtype(aAndB, mkIntType())).toBe(true);
    });
    it('Int & Float <: Float', () => {
      expect(isSubtype(aAndB, mkFloatType())).toBe(true);
    });
    it('Int <: Int & Float requires Int <: Int AND Int <: Float', () => {
      // Int <: Int is true, Int <: Float is true (widening) => true
      expect(isSubtype(mkIntType(), aAndB)).toBe(true);
    });
    it('String is NOT <: Int & Float', () => {
      expect(isSubtype(mkStringType(), aAndB)).toBe(false);
    });
  });

  // -- Confident ----------------------------------------------------------

  describe('confident', () => {
    it('Confident<Int> <: Confident<Float>', () => {
      expect(isSubtype(mkConfidentType(mkIntType()), mkConfidentType(mkFloatType()))).toBe(true);
    });
    it('Confident<Float> is NOT <: Confident<Int>', () => {
      expect(isSubtype(mkConfidentType(mkFloatType()), mkConfidentType(mkIntType()))).toBe(false);
    });
  });

  // -- Type alias ---------------------------------------------------------

  describe('type alias', () => {
    it('resolves alias before comparison', () => {
      const alias = mkTypeAlias('MyInt', mkIntType());
      expect(isSubtype(alias, mkIntType())).toBe(true);
      expect(isSubtype(alias, mkFloatType())).toBe(true);
    });
    it('alias to alias', () => {
      const a1 = mkTypeAlias('A', mkIntType());
      const a2 = mkTypeAlias('B', mkFloatType());
      expect(isSubtype(a1, a2)).toBe(true);
    });
  });

  // -- Negative cases (unrelated types) -----------------------------------

  describe('unrelated types', () => {
    it('Int is NOT <: String', () => {
      expect(isSubtype(mkIntType(), mkStringType())).toBe(false);
    });
    it('Bool is NOT <: Int', () => {
      expect(isSubtype(mkBoolType(), mkIntType())).toBe(false);
    });
    it('String is NOT <: Bool', () => {
      expect(isSubtype(mkStringType(), mkBoolType())).toBe(false);
    });
  });
});
