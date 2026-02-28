package com.anima.intellij

import com.intellij.openapi.fileTypes.LanguageFileType
import com.intellij.openapi.fileTypes.PlainTextLanguage
import javax.swing.Icon

class AnimaFileType private constructor() : LanguageFileType(AnimaLanguage.INSTANCE) {

    override fun getName(): String = "Anima"
    override fun getDescription(): String = "Anima language file"
    override fun getDefaultExtension(): String = "anima"
    override fun getIcon(): Icon? = null

    companion object {
        @JvmField
        val INSTANCE = AnimaFileType()
    }
}
