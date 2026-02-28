package com.anima.intellij

import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import org.jetbrains.plugins.textmate.api.TextMateBundle

class AnimaTextMateBundleProvider : TextMateBundleProvider {
    override fun getBundles(): List<TextMateBundle> {
        val bundlePath = this::class.java.classLoader.getResource("textmate")
            ?: return emptyList()
        return listOf(TextMateBundle("Anima", bundlePath.toURI().path))
    }
}
