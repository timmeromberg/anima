/**
 * `anima init` command — project scaffolding.
 *
 * Creates a new Anima project with:
 *   - anima.toml (project manifest)
 *   - src/main.anima (entry point)
 *   - .gitignore
 */

import * as fs from 'fs';
import * as path from 'path';

export interface InitOptions {
  /** Project name (defaults to directory name) */
  name?: string;
  /** Target directory (defaults to cwd) */
  directory?: string;
}

/**
 * Initialize a new Anima project.
 */
export function initProject(options?: InitOptions): void {
  const dir = options?.directory ? path.resolve(options.directory) : process.cwd();
  const projectName = options?.name ?? path.basename(dir);

  // Validate project name
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(projectName)) {
    console.error(`Error: Invalid project name '${projectName}'. Use letters, digits, hyphens, and underscores.`);
    process.exit(1);
  }

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Check for existing anima.toml
  const tomlPath = path.join(dir, 'anima.toml');
  if (fs.existsSync(tomlPath)) {
    console.error('Error: anima.toml already exists. This directory is already an Anima project.');
    process.exit(1);
  }

  // Create anima.toml
  const tomlContent = `[project]
name = "${projectName}"
version = "0.1.0"
description = ""
authors = []

[dependencies]
# Add dependencies here:
# example = "1.0.0"

[dev-dependencies]
# Add dev dependencies here:
# anima-test = "0.1.0"

[build]
entry = "src/main.anima"
target = "interpreter"
`;
  fs.writeFileSync(tomlPath, tomlContent, 'utf-8');
  console.log('  Created anima.toml');

  // Create src directory and main.anima
  const srcDir = path.join(dir, 'src');
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }

  const mainPath = path.join(srcDir, 'main.anima');
  if (!fs.existsSync(mainPath)) {
    const mainContent = `// ${projectName} — Main entry point

module ${toPascalCase(projectName)}

fun main() {
    println("Hello from ${projectName}!")
}
`;
    fs.writeFileSync(mainPath, mainContent, 'utf-8');
    console.log('  Created src/main.anima');
  } else {
    console.log('  src/main.anima already exists, skipping');
  }

  // Create .gitignore
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const gitignoreContent = `# Anima build artifacts
dist/
build/
*.js.map

# Dependencies
node_modules/

# IDE files
.idea/
.vscode/
*.swp
*.swo
*~

# OS files
.DS_Store
Thumbs.db

# Anima cache
.anima/
`;
    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
    console.log('  Created .gitignore');
  } else {
    console.log('  .gitignore already exists, skipping');
  }

  // Create tests directory
  const testsDir = path.join(dir, 'tests');
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
    const testPath = path.join(testsDir, 'main_test.anima');
    const testContent = `// Tests for ${projectName}

fun main() {
    // Basic smoke test
    assert(true, "basic assertion works")
    assertEqual(1 + 1, 2, "math works")

    println("All tests passed!")
}
`;
    fs.writeFileSync(testPath, testContent, 'utf-8');
    console.log('  Created tests/main_test.anima');
  }

  console.log('');
  console.log(`Anima project '${projectName}' initialized successfully!`);
  console.log('');
  console.log('To get started:');
  if (options?.directory) {
    console.log(`  cd ${options.directory}`);
  }
  console.log('  anima run src/main.anima');
  console.log('');
}

/**
 * Convert a kebab-case or snake_case name to PascalCase.
 */
function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
