/**
 * Runtime error types for the Anima interpreter.
 */

export class AnimaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnimaError';
  }
}

export class AnimaRuntimeError extends AnimaError {
  public readonly line: number | undefined;
  public readonly column: number | undefined;

  constructor(message: string, line?: number, column?: number) {
    const loc = line !== undefined ? ` [line ${line}, col ${column ?? 0}]` : '';
    super(`RuntimeError${loc}: ${message}`);
    this.name = 'AnimaRuntimeError';
    this.line = line;
    this.column = column;
  }
}

export class AnimaTypeError extends AnimaError {
  constructor(message: string, line?: number, column?: number) {
    const loc = line !== undefined ? ` [line ${line}, col ${column ?? 0}]` : '';
    super(`TypeError${loc}: ${message}`);
    this.name = 'AnimaTypeError';
  }
}

export class AnimaNameError extends AnimaError {
  constructor(name: string, line?: number, column?: number) {
    const loc = line !== undefined ? ` [line ${line}, col ${column ?? 0}]` : '';
    super(`NameError${loc}: undefined variable '${name}'`);
    this.name = 'AnimaNameError';
  }
}

export class AnimaImmutableError extends AnimaError {
  constructor(name: string, line?: number, column?: number) {
    const loc = line !== undefined ? ` [line ${line}, col ${column ?? 0}]` : '';
    super(`ImmutableError${loc}: cannot reassign val '${name}'`);
    this.name = 'AnimaImmutableError';
  }
}

/**
 * Signal thrown to implement return statements.
 * This is NOT an error -- it's a control flow mechanism.
 */
export class ReturnSignal {
  public readonly value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }
}

/**
 * Signal thrown to implement break statements.
 */
export class BreakSignal {}

/**
 * Signal thrown to implement continue statements.
 */
export class ContinueSignal {}
