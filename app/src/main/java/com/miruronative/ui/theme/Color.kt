package com.miruronative.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color

// Dense, cinema-dark palette inspired by Miruro's catalog UI. The role values below are the
// brand fallback that runs on devices without Material You (API < 31); on Android 12+ the app
// derives its scheme from the wallpaper via dynamicDarkColorScheme().
val MiruroBackground = Color(0xFF050506)
val MiruroSurface = Color(0xFF101012)
val MiruroSurfaceVariant = Color(0xFF18181C)
val MiruroOnSurface = Color(0xFFF1F1F4)
val MiruroOnSurfaceVariant = Color(0xFF98989F)
val MiruroAccent = Color(0xFF8979F2)
val MiruroAccentVariant = Color(0xFFE83A82)
val MiruroOutline = Color(0xFF27272C)

// Expressive surface tiers (used by NavigationBar, sheets, cards and dialogs).
val MiruroSurfaceContainerLow = Color(0xFF0C0C0F)
val MiruroSurfaceContainer = Color(0xFF141418)
val MiruroSurfaceContainerHigh = Color(0xFF1A1A1F)
val MiruroSurfaceContainerHighest = Color(0xFF25252B)
val MiruroSurfaceBright = Color(0xFF2C2C32)
val MiruroSurfaceDim = Color(0xFF050506)

// Container roles for the primary/secondary/tertiary accents.
val MiruroPrimaryContainer = Color(0xFF1E1B3F)
val MiruroOnPrimaryContainer = Color(0xFFE3E0FF)
val MiruroSecondaryContainer = Color(0xFF3A1030)
val MiruroOnSecondaryContainer = Color(0xFFFFD8E9)
val MiruroTertiary = Color(0xFF3AD9A4)
val MiruroTertiaryContainer = Color(0xFF0B3A2E)
val MiruroOnTertiaryContainer = Color(0xFFC8FFE9)

val MiruroOutlineVariant = Color(0xFF2E2E35)
val MiruroError = Color(0xFFF2B8B5)
val MiruroOnError = Color(0xFF601410)
val MiruroErrorContainer = Color(0xFF8C1D18)
val MiruroOnErrorContainer = Color(0xFFFFDAD6)

val MiruroDarkColors = darkColorScheme(
    primary = MiruroAccent,
    onPrimary = MiruroOnSurface,
    primaryContainer = MiruroPrimaryContainer,
    onPrimaryContainer = MiruroOnPrimaryContainer,
    secondary = MiruroAccentVariant,
    onSecondary = MiruroOnSurface,
    secondaryContainer = MiruroSecondaryContainer,
    onSecondaryContainer = MiruroOnSecondaryContainer,
    tertiary = MiruroTertiary,
    onTertiary = MiruroOnSurface,
    tertiaryContainer = MiruroTertiaryContainer,
    onTertiaryContainer = MiruroOnTertiaryContainer,
    error = MiruroError,
    onError = MiruroOnError,
    errorContainer = MiruroErrorContainer,
    onErrorContainer = MiruroOnErrorContainer,
    background = MiruroBackground,
    onBackground = MiruroOnSurface,
    surface = MiruroSurface,
    onSurface = MiruroOnSurface,
    surfaceVariant = MiruroSurfaceVariant,
    onSurfaceVariant = MiruroOnSurfaceVariant,
    outline = MiruroOutline,
    outlineVariant = MiruroOutlineVariant,
    scrim = Color.Black,
    surfaceTint = MiruroAccent,
    inverseSurface = MiruroOnSurface,
    inverseOnSurface = MiruroSurface,
    inversePrimary = Color(0xFF6B5CE0),
    surfaceDim = MiruroSurfaceDim,
    surfaceBright = MiruroSurfaceBright,
    surfaceContainerLowest = Color.Black,
    surfaceContainerLow = MiruroSurfaceContainerLow,
    surfaceContainer = MiruroSurfaceContainer,
    surfaceContainerHigh = MiruroSurfaceContainerHigh,
    surfaceContainerHighest = MiruroSurfaceContainerHighest,
)
