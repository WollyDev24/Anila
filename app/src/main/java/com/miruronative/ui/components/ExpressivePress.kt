package com.miruronative.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonElevation
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonColors
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import kotlin.math.max

/**
 * M3 Expressive press behaviour for Material buttons: while held, the corner radius contracts
 * (the surface squishes) and the element scales down a touch, then springs back on release.
 *
 * material3 exposes its expressive theme only through internal APIs, so the interaction is
 * reimplemented here from the press [InteractionSource] and a corner-radius animatable.
 */
@Composable
fun Modifier.expressivePress(
    interactionSource: InteractionSource,
    shape: Shape,
    pressScale: Float = 0.98f,
    pressRadiusFraction: Float = 0.5f,
): Modifier {
    val cornerShape = shape as? CornerBasedShape ?: return this
    val density = LocalDensity.current
    val anim = remember(cornerShape, density, pressRadiusFraction) {
        PressAnimShape(cornerShape, pressRadiusFraction, density)
    }
    val pressed by interactionSource.collectIsPressedAsState()
    LaunchedEffect(pressed) {
        if (pressed) anim.animatePress() else anim.animateRelease()
    }
    val scale by animateFloatAsState(
        targetValue = if (pressed) pressScale else 1f,
        animationSpec = spring(
            stiffness = Spring.StiffnessMediumLow,
            dampingRatio = Spring.DampingRatioNoBouncy,
        ),
        label = "expressivePressScale",
    )
    return clip(anim).graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

private class PressAnimShape(
    private val resting: CornerBasedShape,
    private val pressRadiusFraction: Float,
    private val density: Density,
) : Shape {
    private var size: Size = Size.Zero
    private val pressFraction = Animatable(0f)

    suspend fun animatePress() {
        pressFraction.animateTo(
            targetValue = 1f,
            animationSpec = spring(
                stiffness = Spring.StiffnessMediumLow,
                dampingRatio = Spring.DampingRatioNoBouncy,
            ),
        )
    }

    suspend fun animateRelease() {
        pressFraction.animateTo(
            targetValue = 0f,
            animationSpec = spring(
                stiffness = Spring.StiffnessMediumLow,
                dampingRatio = Spring.DampingRatioNoBouncy,
            ),
        )
    }

    private fun pressedRadius(corner: CornerSize): Float {
        val restingPx = corner.toPx(size, density)
        return max(restingPx * pressRadiusFraction, 0f)
    }

    private fun animated(corner: CornerSize, t: Float): Float {
        val restingPx = corner.toPx(size, density)
        val clamped = restingPx.coerceIn(0f, size.minDimension / 2f)
        val target = pressedRadius(corner).coerceIn(0f, size.minDimension / 2f)
        return clamped + (target - clamped) * t
    }

    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Outline {
        this.size = size
        val t = pressFraction.value
        return RoundedCornerShape(
            topStart = animated(resting.topStart, t),
            topEnd = animated(resting.topEnd, t),
            bottomEnd = animated(resting.bottomEnd, t),
            bottomStart = animated(resting.bottomStart, t),
        ).createOutline(size, layoutDirection, density)
    }
}

@Composable
fun ExpressiveButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = MaterialTheme.shapes.extraLarge,
    colors: ButtonColors = ButtonDefaults.buttonColors(),
    elevation: ButtonElevation? = ButtonDefaults.buttonElevation(),
    border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    Button(
        onClick = onClick,
        modifier = modifier.expressivePress(source, shape),
        enabled = enabled,
        shape = shape,
        colors = colors,
        elevation = elevation,
        border = border,
        contentPadding = contentPadding,
        interactionSource = source,
        content = content,
    )
}

@Composable
fun ExpressiveOutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = MaterialTheme.shapes.extraLarge,
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    elevation: ButtonElevation? = null,
    border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.expressivePress(source, shape),
        enabled = enabled,
        shape = shape,
        colors = colors,
        elevation = elevation,
        border = border,
        contentPadding = contentPadding,
        interactionSource = source,
        content = content,
    )
}

@Composable
fun ExpressiveTextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = MaterialTheme.shapes.extraLarge,
    colors: ButtonColors = ButtonDefaults.textButtonColors(),
    elevation: ButtonElevation? = null,
    border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    TextButton(
        onClick = onClick,
        modifier = modifier.expressivePress(source, shape),
        enabled = enabled,
        shape = shape,
        colors = colors,
        elevation = elevation,
        border = border,
        contentPadding = contentPadding,
        interactionSource = source,
        content = content,
    )
}

@Composable
fun ExpressiveIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: IconButtonColors = IconButtonDefaults.iconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    shape: Shape = IconButtonDefaults.standardShape,
    content: @Composable () -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    IconButton(
        onClick = onClick,
        modifier = modifier.expressivePress(source, shape),
        enabled = enabled,
        colors = colors,
        interactionSource = source,
        shape = shape,
        content = content,
    )
}
