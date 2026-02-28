# Anima IntelliJ Plugin

Syntax highlighting for the Anima programming language in IntelliJ IDEA.

## Quick Setup (TextMate Bundle)

The fastest way to get syntax highlighting without building the plugin:

1. Open IntelliJ IDEA
2. Go to **Settings > Editor > TextMate Bundles**
3. Click **+** and select the `editors/intellij/` directory (the one containing `anima.tmLanguage.json`)
4. Restart IntelliJ

All `.anima` files will now have syntax highlighting.

## Building the Plugin

Requires JDK 17+.

```bash
cd anima-intellij
./gradlew buildPlugin
```

The plugin zip will be in `anima-intellij/build/distributions/`.

Install via **Settings > Plugins > Install Plugin from Disk**.

## What's Highlighted

- All Anima keywords (standard and AI-specific)
- Modifiers (`public`, `private`, `suspend`, etc.)
- Primitive and built-in types (`Int`, `String`, `NL`, `Fuzzy`, etc.)
- Function, agent, entity, and class definitions
- String literals with `$interpolation` and `${expressions}`
- Numbers (int and float)
- Comments (line `//` and block `/* */`)
- Operators including Anima-specific ones (`~=`, `~>`, `<~`, `@`, `?:`, `?.`)
