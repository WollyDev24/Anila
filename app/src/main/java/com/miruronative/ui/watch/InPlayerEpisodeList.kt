package com.miruronative.ui.watch

import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.miruronative.ui.components.ExpressiveButton
import com.miruronative.ui.components.ExpressiveIconButton
import com.miruronative.ui.components.ExpressiveOutlinedButton
import com.miruronative.ui.components.ExpressiveTextButton
import com.miruronative.data.model.EpisodeItem
import com.miruronative.data.settings.SettingsStore
import com.miruronative.ui.adaptive.focusHighlight
import com.miruronative.ui.components.EpisodeArtwork
import com.miruronative.ui.components.EpisodeBlockPicker
import com.miruronative.ui.components.EqualizerWaveIndicator
import com.miruronative.ui.components.FastScrollbar
import com.miruronative.ui.components.blockIndexContaining
import com.miruronative.ui.components.episodeArtworkImage
import com.miruronative.ui.components.episodeBlocks

@Composable
internal fun InPlayerEpisodeDrawer(
    episodes: List<EpisodeItem>,
    currentIndex: Int,
    artworkUrl: String?,
    onSelectEpisode: (Int) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BackHandler(onBack = onDismiss)
    val blurEpisodeImages by SettingsStore.blurEpisodeImages.collectAsState()

    var chosenBlockIndex by remember(episodes) { mutableStateOf<Int?>(null) }
    val blocks = remember(episodes) { episodeBlocks(episodes) }
    val currentEpisode = episodes.getOrNull(currentIndex)
    val defaultBlockIndex = remember(blocks, currentEpisode) {
        blockIndexContaining(blocks, currentEpisode?.number).coerceIn(0, (blocks.size - 1).coerceAtLeast(0))
    }
    val activeBlockIndex = chosenBlockIndex ?: defaultBlockIndex

    val indexByPipeId = remember(episodes) {
        episodes.withIndex().associate { (index, episode) -> episode.pipeId to index }
    }

    val listState = rememberLazyListState()
    val initialFocusRequester = remember { FocusRequester() }

    LaunchedEffect(activeBlockIndex, currentIndex) {
        val shownEpisodes = blocks.getOrNull(activeBlockIndex)?.episodes ?: episodes
        val targetInShown = shownEpisodes.indexOfFirst { indexByPipeId[it.pipeId] == currentIndex }
        if (targetInShown >= 0) {
            listState.scrollToItem(targetInShown)
        }
        runCatching { initialFocusRequester.requestFocus() }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.55f))
            .clickable(onClick = onDismiss),
    ) {
        Surface(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .width(360.dp)
                .clickable(enabled = false) {}, // Scrim protection
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
            shape = RoundedCornerShape(
                topStart = MaterialTheme.shapes.large.topStart,
                topEnd = CornerSize(0.dp),
                bottomEnd = CornerSize(0.dp),
                bottomStart = MaterialTheme.shapes.large.bottomStart,
            ),
            tonalElevation = 8.dp,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp, vertical = 16.dp)
                    .focusGroup(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Episodes",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    ExpressiveIconButton(
                        onClick = onDismiss,
                        modifier = Modifier.focusHighlight(MaterialTheme.shapes.extraLarge),
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Close episodes",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                ) {
                    LazyColumn(
                        state = listState,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        if (blocks.size <= 1) {
                            itemsIndexed(episodes) { _, episode ->
                                val globalIndex = indexByPipeId[episode.pipeId] ?: -1
                                val isCurrent = globalIndex == currentIndex
                                val itemFocusRequester = if (isCurrent) initialFocusRequester else remember { FocusRequester() }

                                InPlayerEpisodeItemRow(
                                    episode = episode,
                                    artworkUrl = artworkUrl,
                                    blurred = blurEpisodeImages,
                                    onBlurredChange = SettingsStore::setBlurEpisodeImages,
                                    isCurrent = isCurrent,
                                    focusRequester = itemFocusRequester,
                                    onClick = {
                                        if (globalIndex >= 0) {
                                            onSelectEpisode(globalIndex)
                                            onDismiss()
                                        }
                                    },
                                )
                            }
                        } else {
                            blocks.forEachIndexed { blockIdx, block ->
                                val isExpanded = (blockIdx == activeBlockIndex)
                                item(key = "season_header_$blockIdx") {
                                    SeasonHeaderRow(
                                        seasonNumber = blockIdx + 1,
                                        rangeLabel = block.label,
                                        episodeCount = block.episodes.size,
                                        isExpanded = isExpanded,
                                        onClick = {
                                            chosenBlockIndex = if (isExpanded) -1 else blockIdx
                                        },
                                    )
                                }

                                if (isExpanded) {
                                    itemsIndexed(block.episodes, key = { _, ep -> "ep_${ep.pipeId}" }) { _, episode ->
                                        val globalIndex = indexByPipeId[episode.pipeId] ?: -1
                                        val isCurrent = globalIndex == currentIndex
                                        val itemFocusRequester = if (isCurrent) initialFocusRequester else remember { FocusRequester() }

                                        InPlayerEpisodeItemRow(
                                            episode = episode,
                                            artworkUrl = artworkUrl,
                                            blurred = blurEpisodeImages,
                                            onBlurredChange = SettingsStore::setBlurEpisodeImages,
                                            isCurrent = isCurrent,
                                            focusRequester = itemFocusRequester,
                                            onClick = {
                                                if (globalIndex >= 0) {
                                                    onSelectEpisode(globalIndex)
                                                    onDismiss()
                                                }
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }

                    FastScrollbar(
                        state = listState,
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .padding(end = 2.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SeasonHeaderRow(
    seasonNumber: Int,
    rangeLabel: String,
    episodeCount: Int,
    isExpanded: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .focusHighlight(MaterialTheme.shapes.small)
            .clip(MaterialTheme.shapes.small)
            .clickable(onClick = onClick),
        color = if (isExpanded) MaterialTheme.colorScheme.primaryContainer
        else MaterialTheme.colorScheme.surfaceContainerHighest,
        shape = MaterialTheme.shapes.small,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    text = "Season $seasonNumber ($rangeLabel)",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "$episodeCount episodes",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                imageVector = if (isExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                contentDescription = if (isExpanded) "Collapse season" else "Expand season",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun InPlayerEpisodeItemRow(
    episode: EpisodeItem,
    artworkUrl: String?,
    blurred: Boolean,
    onBlurredChange: (Boolean) -> Unit,
    isCurrent: Boolean,
    focusRequester: FocusRequester,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val backgroundColor = if (isCurrent) {
        MaterialTheme.colorScheme.primaryContainer
    } else {
        MaterialTheme.colorScheme.surfaceContainerHigh
    }
    val borderColor = if (isCurrent) MaterialTheme.colorScheme.primary else Color.Transparent

    Row(
        modifier = modifier
            .fillMaxWidth()
            .focusRequester(focusRequester)
            .onPreviewKeyEvent { event ->
                val keyCode = event.nativeKeyEvent.keyCode
                val activate = keyCode == AndroidKeyEvent.KEYCODE_DPAD_CENTER ||
                    keyCode == AndroidKeyEvent.KEYCODE_ENTER ||
                    keyCode == AndroidKeyEvent.KEYCODE_NUMPAD_ENTER
                if (!activate) {
                    false
                } else {
                    if (event.type == KeyEventType.KeyUp) onClick()
                    true
                }
            }
            .focusHighlight(MaterialTheme.shapes.small, focusedScale = 1.03f)
            .clip(MaterialTheme.shapes.small)
            .background(backgroundColor)
            .border(1.5.dp, borderColor, MaterialTheme.shapes.small)
            .clickable(onClick = onClick)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = episode.displayNumber,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = if (isCurrent) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(28.dp),
        )

        Box(
            modifier = Modifier
                .width(80.dp)
                .aspectRatio(16f / 9f)
                .clip(MaterialTheme.shapes.extraSmall)
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            EpisodeArtwork(
                image = episodeArtworkImage(episode.image, artworkUrl),
                blurred = blurred,
                onBlurredChange = onBlurredChange,
                contentScale = ContentScale.Crop,
                compact = true,
                modifier = Modifier.fillMaxSize(),
            )
            if (isCurrent) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.55f)),
                    contentAlignment = Alignment.Center,
                ) {
                    EqualizerWaveIndicator(
                        color = MaterialTheme.colorScheme.primary,
                        barCount = 4,
                        barWidth = 3.5.dp,
                        maxHeight = 18.dp,
                    )
                }
            }
        }

        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = episode.distinctTitle ?: "Episode ${episode.displayNumber}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Medium,
                    color = if (isCurrent) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (isCurrent) {
                    Spacer(Modifier.width(6.dp))
                    EqualizerWaveIndicator(
                        color = MaterialTheme.colorScheme.primary,
                        barCount = 3,
                        barWidth = 2.5.dp,
                        maxHeight = 12.dp,
                    )
                }
            }
            if (episode.filler) {
                Text(
                    text = "Filler",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.tertiary,
                )
            }
        }
    }
}
