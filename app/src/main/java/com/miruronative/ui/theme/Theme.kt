package com.miruronative.ui.theme

import android.content.res.Configuration
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

// The site is dark-first; we commit to a single dark scheme so the app matches it 1:1.
// On Android 12+ (API 31+) the scheme is derived from the wallpaper via Material You dynamic
// color; older devices and Fire OS fall back to the brand palette in Color.kt.
@Composable
fun MiruroTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val configuration = LocalConfiguration.current
    val isTv = configuration.uiMode and Configuration.UI_MODE_TYPE_MASK ==
        Configuration.UI_MODE_TYPE_TELEVISION
    val context = LocalContext.current
    val colorScheme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        dynamicDarkColorScheme(context)
    } else {
        MiruroDarkColors
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = if (isTv) MiruroTvTypography else MiruroTypography,
        shapes = if (isTv) MiruroTvShapes else MiruroShapes,
        content = content,
    )
}
