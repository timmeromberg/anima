package com.anima.intellij

import com.intellij.lang.Language

class AnimaLanguage private constructor() : Language("Anima") {
    companion object {
        @JvmField
        val INSTANCE = AnimaLanguage()
    }
}
