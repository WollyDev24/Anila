package com.miruronative.ui.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.miruronative.BuildConfig
import com.miruronative.R
import com.miruronative.data.ProviderCatalog
import com.miruronative.data.auth.AccountService
import com.miruronative.data.auth.AuthManager
import com.miruronative.data.auth.MalAuthManager
import com.miruronative.data.cache.CacheManager
import com.miruronative.data.library.LibraryStore
import com.miruronative.data.library.MalExportFile
import com.miruronative.data.library.MalImport
import com.miruronative.data.reminder.AutomaticReleaseManager
import com.miruronative.data.reminder.ReleaseSyncScheduler
import com.miruronative.data.settings.DEFAULT_PREFERRED_PROVIDER
import com.miruronative.data.settings.DefaultQuality
import com.miruronative.data.settings.DownloadDestination
import com.miruronative.data.settings.DownloadQuality
import com.miruronative.data.settings.MAX_SERVER_PRIORITY
import com.miruronative.data.settings.MenuLanguage
import com.miruronative.data.settings.SettingsStore
import com.miruronative.data.update.UpdateManager
import com.miruronative.diagnostics.DiagnosticSendResult
import com.miruronative.diagnostics.DiagnosticSubmissionDialog
import com.miruronative.diagnostics.DiagnosticTrigger
import com.miruronative.diagnostics.DiagnosticsLog
import com.miruronative.diagnostics.DiagnosticsUploadManager
import com.miruronative.ui.UiState
import com.miruronative.ui.adaptive.LocalAppDeviceProfile
import com.miruronative.ui.adaptive.focusHighlight
import com.miruronative.ui.adaptive.rememberScreenReaderActive
import com.miruronative.ui.components.CaptionAppearanceDialog
import com.miruronative.ui.components.ExpressiveIconButton
import com.miruronative.ui.components.ExpressiveSwitch
import com.miruronative.ui.components.ExpressiveTextButton
import com.miruronative.ui.components.LocalAppChromeBottomInset
import com.miruronative.ui.components.ScrollAwareTopBar
import com.miruronative.ui.profile.AniListProfile
import com.miruronative.ui.profile.LoginWebView
import com.miruronative.ui.profile.MalImportProgress
import com.miruronative.ui.profile.MalImportStage
import com.miruronative.ui.profile.ProfileViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    vm: ProfileViewModel = viewModel(),
) {
    val context = LocalContext.current
    val device = LocalAppDeviceProfile.current
    val screenReaderActive = rememberScreenReaderActive()
    val token by AuthManager.token.collectAsState()
    val malLoggedIn by MalAuthManager.loggedIn.collectAsState()
    val profileState by vm.profile.collectAsState()
    val history by LibraryStore.history.collectAsState()
    val watchlist by LibraryStore.watchlist.collectAsState()
    val autoplay by SettingsStore.autoplay.collectAsState()
    val autoSkip by SettingsStore.autoSkipIntroOutro.collectAsState()
    val autoSync by SettingsStore.autoSyncAniList.collectAsState()
    val preferDub by SettingsStore.preferDub.collectAsState()
    val defaultQuality by SettingsStore.defaultQuality.collectAsState()
    val playerGestures by SettingsStore.playerGestures.collectAsState()
    val serverPriority by SettingsStore.serverPriority.collectAsState()
    val downloadQuality by SettingsStore.downloadQuality.collectAsState()
    val downloadDestination by SettingsStore.downloadDestination.collectAsState()
    val releaseNotifications by SettingsStore.releaseNotifications.collectAsState()
    val hideAdultContent by SettingsStore.hideAdultContent.collectAsState()
    val blurEpisodeImages by SettingsStore.blurEpisodeImages.collectAsState()
    val subtitlesWithDub by SettingsStore.subtitlesWithDub.collectAsState()
    val updateCheckOnLaunch by SettingsStore.updateCheckOnLaunch.collectAsState()
    val syncSavedToAniList by SettingsStore.syncSavedToAniList.collectAsState()
    val menuLanguage by SettingsStore.menuLanguage.collectAsState()
    val updateState by UpdateManager.state.collectAsState()
    val profile = (profileState as? UiState.Success<AniListProfile>)?.data
    val scope = rememberCoroutineScope()
    var pendingMalExport by remember { mutableStateOf<MalExportFile?>(null) }
    var malExportBusy by remember { mutableStateOf(false) }
    var malExportMessage by remember { mutableStateOf<String?>(null) }
    var malImportBusy by remember { mutableStateOf(false) }
    var malImportMessage by remember { mutableStateOf<String?>(null) }
    var malImportProgress by remember { mutableStateOf<MalImportProgress?>(null) }
    var malImportJob by remember { mutableStateOf<Job?>(null) }
    var loginService by remember { mutableStateOf<AccountService?>(null) }
    var diagnosticsMessage by remember { mutableStateOf<String?>(null) }
    var diagnosticsBusy by remember { mutableStateOf(false) }
    var diagnosticsDialogVisible by remember { mutableStateOf(false) }
    var diagnosticsError by remember { mutableStateOf<String?>(null) }
    var captionAppearanceVisible by remember { mutableStateOf(false) }
    var cacheUsage by remember { mutableStateOf<Long?>(null) }
    var cacheClearing by remember { mutableStateOf(false) }
    var cacheMessage by remember { mutableStateOf<String?>(null) }
    var selectedCategory by rememberSaveable { mutableStateOf<SettingsTab?>(null) }
    var defaultQualityDialog by remember { mutableStateOf(false) }
    var downloadQualityDialog by remember { mutableStateOf(false) }
    var downloadDestinationDialog by remember { mutableStateOf(false) }
    var menuLanguageDialog by remember { mutableStateOf(false) }

    LaunchedEffect(token, malLoggedIn) { vm.loadIfLoggedIn() }
    LaunchedEffect(Unit) {
        cacheUsage = withContext(Dispatchers.IO) { CacheManager.usageBytes(context) }
    }

    if (captionAppearanceVisible) {
        CaptionAppearanceDialog(
            onDismiss = { captionAppearanceVisible = false },
            footnote = "Applies to the built-in player. Servers that play in a web view render " +
                "their own subtitles and may ignore some of these.",
        )
    }
    if (diagnosticsDialogVisible) {
        DiagnosticSubmissionDialog(
            title = "Send diagnostics",
            introduction = "Describe the problem so the report has useful context. This uploads the " +
                "app timeline, device, performance, playback and network diagnostics. Passwords, " +
                "cookies, tokens and sensitive links are removed.",
            descriptionRequired = true,
            sending = diagnosticsBusy,
            errorMessage = diagnosticsError,
            onDismiss = {
                diagnosticsDialogVisible = false
                diagnosticsError = null
            },
            onSend = { submission ->
                diagnosticsBusy = true
                diagnosticsError = null
                diagnosticsMessage = "Preparing the full diagnostic report…"
                scope.launch {
                    try {
                        val result = DiagnosticsUploadManager.send(
                            context,
                            DiagnosticTrigger.MANUAL,
                            submission,
                        )
                        if (result is DiagnosticSendResult.Failed) {
                            diagnosticsError = result.reason
                        } else {
                            diagnosticsMessage = result.userMessage()
                            diagnosticsDialogVisible = false
                        }
                    } finally {
                        diagnosticsBusy = false
                    }
                }
            },
        )
    }

    if (defaultQualityDialog) {
        SettingsRadioDialog(
            title = "Default quality",
            options = DefaultQuality.entries.toList(),
            selected = defaultQuality,
            label = { it.label },
            onSelect = SettingsStore::setDefaultQuality,
            onDismiss = { defaultQualityDialog = false },
        )
    }
    if (downloadQualityDialog) {
        SettingsRadioDialog(
            title = "Default download resolution",
            options = DownloadQuality.entries.toList(),
            selected = downloadQuality,
            label = { it.label },
            onSelect = SettingsStore::setDownloadQuality,
            onDismiss = { downloadQualityDialog = false },
        )
    }
    if (downloadDestinationDialog) {
        SettingsRadioDialog(
            title = "Default download destination",
            options = DownloadDestination.entries.toList(),
            selected = downloadDestination,
            label = { it.label },
            onSelect = SettingsStore::setDownloadDestination,
            onDismiss = { downloadDestinationDialog = false },
        )
    }
    if (menuLanguageDialog) {
        val spanish = menuLanguage.usesSpanish()
        SettingsRadioDialog(
            title = if (spanish) "Idioma del menú" else "Menu language",
            options = MenuLanguage.entries.toList(),
            selected = menuLanguage,
            label = { language ->
                when (language) {
                    MenuLanguage.SYSTEM -> if (spanish) "Sistema" else "System"
                    MenuLanguage.ENGLISH -> if (spanish) "Inglés" else "English"
                    MenuLanguage.SPANISH -> "Español"
                }
            },
            onSelect = SettingsStore::setMenuLanguage,
            onDismiss = { menuLanguageDialog = false },
        )
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        SettingsStore.setReleaseNotifications(granted)
        if (granted) ReleaseSyncScheduler.runNow(context)
    }
    val malExportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/xml"),
    ) { uri ->
        val file = pendingMalExport
        pendingMalExport = null
        if (uri == null || file == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(file.xml.toByteArray(Charsets.UTF_8))
            } ?: error("Couldn't open export file")
        }.onSuccess {
            malExportMessage = buildString {
                append("Exported ${file.exportedCount} anime")
                if (file.skippedCount > 0) append("; skipped ${file.skippedCount} without MAL IDs")
            }
        }.onFailure { error ->
            malExportMessage = error.message ?: "MAL export failed"
        }
    }
    // MAL serves exports as .xml.gz, which file pickers report under assorted mime types, so the
    // filter stays wide open and the parser decides.
    val malImportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) {
            DiagnosticsLog.event("mal_import", "picker.cancelled")
            return@rememberLauncherForActivityResult
        }
        malImportJob = scope.launch {
            malImportBusy = true
            malImportMessage = null
            malImportProgress = MalImportProgress(MalImportStage.READING)
            try {
                val mimeType = runCatching { context.contentResolver.getType(uri) }.getOrNull()
                val reportedBytes = context.malImportReportedSize(uri)
                DiagnosticsLog.event(
                    category = "mal_import",
                    name = "picker.file_selected",
                    attributes = mapOf(
                        "mimeType" to (mimeType ?: "unknown"),
                        "reportedBytes" to (reportedBytes ?: -1L),
                    ),
                )
                if (reportedBytes != null && reportedBytes > MalImport.MAX_SOURCE_BYTES) {
                    error("The MAL export is larger than the 16 MB safety limit.")
                }
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { stream ->
                        MalImport.readSource(stream)
                    }
                        ?: error("Couldn't open that file")
                }
                DiagnosticsLog.event(
                    category = "mal_import",
                    name = "picker.file_read",
                    attributes = mapOf("actualBytes" to bytes.size),
                )
                val summary = vm.importMalXml(bytes) { progress ->
                    malImportProgress = progress
                }
                malImportMessage = buildString {
                    append("Imported ${summary.added} new anime")
                    if (summary.alreadySaved > 0) append("; ${summary.alreadySaved} already saved")
                    if (summary.unmatched > 0) append("; ${summary.unmatched} not found on AniList")
                }
            } catch (error: CancellationException) {
                DiagnosticsLog.event(
                    category = "mal_import",
                    name = "ui.cancelled",
                    attributes = mapOf("stage" to (malImportProgress?.stage?.name?.lowercase() ?: "reading")),
                )
                malImportMessage = "MyAnimeList import cancelled"
                throw error
            } catch (error: Exception) {
                DiagnosticsLog.event(
                    category = "mal_import",
                    name = "ui.failed",
                    attributes = mapOf(
                        "stage" to (malImportProgress?.stage?.name?.lowercase() ?: "reading"),
                        "errorType" to error.javaClass.simpleName,
                        "message" to (error.message ?: "none"),
                    ),
                )
                malImportMessage = error.message ?: "MAL import failed"
            } finally {
                malImportProgress = null
                malImportBusy = false
                malImportJob = null
            }
        }
    }

    when (loginService) {
        AccountService.ANILIST -> {
            LoginWebView(
                authorizeUrl = remember(loginService) { AuthManager.authorizeUrl() },
                isRedirect = AuthManager::isRedirect,
                extractResult = AuthManager::extractToken,
                onResult = { loginService = null; vm.onLoggedIn(it) },
                onCancel = { loginService = null },
            )
            return
        }
        AccountService.MAL -> {
            LoginWebView(
                authorizeUrl = remember(loginService) { MalAuthManager.authorizeUrl() },
                isRedirect = MalAuthManager::isRedirect,
                extractResult = MalAuthManager::extractCode,
                onResult = { loginService = null; vm.onMalCode(it) },
                onCancel = { loginService = null },
            )
            return
        }
        null -> Unit
    }

    fun setReleaseNotifications(enabled: Boolean) {
        if (!enabled) {
            SettingsStore.setReleaseNotifications(false)
            AutomaticReleaseManager.cancelAll()
        } else if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            SettingsStore.setReleaseNotifications(true)
            ReleaseSyncScheduler.runNow(context)
        }
    }

    fun setWatchlistSync(enabled: Boolean) {
        SettingsStore.setSyncSavedToAniList(enabled)
        if (enabled) {
            LibraryStore.syncSavedToRemote()
            vm.loadIfLoggedIn(refresh = true)
        }
    }

    fun exportMal() {
        if (malExportBusy) return
        scope.launch {
            malExportBusy = true
            malExportMessage = null
            runCatching { vm.buildMalExport(profile, watchlist, history) }
                .onSuccess { file ->
                    if (file.exportedCount == 0) {
                        malExportMessage = "No MAL-mapped anime to export"
                    } else {
                        pendingMalExport = file
                        malExportLauncher.launch(file.fileName)
                    }
                }
                .onFailure { error -> malExportMessage = error.message ?: "MAL export failed" }
            malExportBusy = false
        }
    }

    fun clearCache() {
        if (cacheClearing) return
        scope.launch {
            cacheClearing = true
            cacheMessage = null
            val before = cacheUsage ?: withContext(Dispatchers.IO) { CacheManager.usageBytes(context) }
            withContext(Dispatchers.IO) { CacheManager.clear(context) }
            val after = withContext(Dispatchers.IO) { CacheManager.usageBytes(context) }
            cacheUsage = after
            cacheMessage = "Freed ${Formatter.formatShortFileSize(context, (before - after).coerceAtLeast(0))}"
            cacheClearing = false
        }
    }

    val spanish = menuLanguage.usesSpanish()
    val categoryTitles = mapOf(
        SettingsTab.Playback to (if (spanish) "Reproducción" else "Playback"),
        SettingsTab.Servers to (if (spanish) "Servidores" else "Servers"),
        SettingsTab.Downloads to (if (spanish) "Descargas" else "Downloads"),
        SettingsTab.Content to (if (spanish) "Contenido" else "Content"),
        SettingsTab.ListSync to (if (spanish) "Sincronización" else "List sync"),
        SettingsTab.Notifications to (if (spanish) "Notificaciones" else "Notifications"),
        SettingsTab.Data to (if (spanish) "Datos" else "Data"),
        SettingsTab.App to (if (spanish) "Aplicación" else "App"),
        SettingsTab.About to (if (spanish) "Acerca de" else "About"),
        SettingsTab.Accessibility to (if (spanish) "Accesibilidad" else "Accessibility"),
    )
    val categoryOrder = buildList {
        add(SettingsTab.Playback)
        add(SettingsTab.Servers)
        add(SettingsTab.Downloads)
        add(SettingsTab.Content)
        add(SettingsTab.ListSync)
        add(SettingsTab.Notifications)
        add(SettingsTab.Data)
        add(SettingsTab.App)
        add(SettingsTab.About)
        if (device.isTv) add(SettingsTab.Accessibility)
    }
    BackHandler(enabled = selectedCategory != null) { selectedCategory = null }

    Scaffold(
        modifier = modifier,
        topBar = {
            ScrollAwareTopBar {
                TopAppBar(
                    title = {
                        Text(
                            selectedCategory?.let { categoryTitles.getValue(it) }
                                ?: if (spanish) "Ajustes" else "Settings",
                            fontWeight = FontWeight.Black,
                        )
                    },
                    navigationIcon = {
                        if (selectedCategory != null) {
                            ExpressiveIconButton(onClick = { selectedCategory = null }) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = if (spanish) "Volver" else "Back",
                                )
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                )
            }
        },
    ) { padding ->
        val category = selectedCategory
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = device.pagePadding,
                end = device.pagePadding,
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + LocalAppChromeBottomInset.current + 32.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (category == null) {
                items(categoryOrder, key = { it.name }) { tab ->
                    settingsCategory {
                        categoryRow(
                            title = categoryTitles.getValue(tab),
                            icon = { Icon(categoryIcon(tab), contentDescription = null) },
                            onClick = { selectedCategory = tab },
                        )
                    }
                }
            } else {
                when (category) {
                    SettingsTab.Playback -> item {
                        settingsCategory {
                            settingRow(
                                title = "Autoplay next episode",
                                summary = "Continue automatically",
                                onClick = { SettingsStore.setAutoplay(!autoplay) },
                            ) {
                                ExpressiveSwitch(
                                    checked = autoplay,
                                    onCheckedChange = SettingsStore::setAutoplay,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Auto-skip intro and outro",
                                summary = "Use provider skip times when available",
                                onClick = { SettingsStore.setAutoSkipIntroOutro(!autoSkip) },
                            ) {
                                ExpressiveSwitch(
                                    checked = autoSkip,
                                    onCheckedChange = SettingsStore::setAutoSkipIntroOutro,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Default quality",
                                summary = "Picked automatically when an episode starts. Data Saver caps " +
                                    "playback at 360p when possible and otherwise uses the closest " +
                                    "available low resolution.",
                                value = defaultQuality.label,
                                onClick = { defaultQualityDialog = true },
                            )
                            rowDivider()
                            settingRow(
                                title = "Prefer dubbed audio",
                                summary = "Use dub first when available",
                                onClick = { SettingsStore.setPreferDub(!preferDub) },
                            ) {
                                ExpressiveSwitch(
                                    checked = preferDub,
                                    onCheckedChange = SettingsStore::setPreferDub,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Subtitles with dubbed audio",
                                summary = "Show subtitles on dubbed episodes too (applies from the next episode)",
                                onClick = { SettingsStore.setSubtitlesWithDub(!subtitlesWithDub) },
                            ) {
                                ExpressiveSwitch(
                                    checked = subtitlesWithDub,
                                    onCheckedChange = SettingsStore::setSubtitlesWithDub,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Player touch gestures",
                                summary = "Swipe the left half for brightness, the right half for volume, " +
                                    "across for seek. Tap to show the controls either way.",
                                onClick = { SettingsStore.setPlayerGestures(!playerGestures) },
                            ) {
                                ExpressiveSwitch(
                                    checked = playerGestures,
                                    onCheckedChange = SettingsStore::setPlayerGestures,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Caption appearance",
                                icon = { Icon(Icons.Default.ClosedCaption, contentDescription = null) },
                                onClick = { captionAppearanceVisible = true },
                            )
                        }
                    }
                    SettingsTab.Accessibility -> if (device.isTv) item {
                        settingsCategory {
                            settingRow(
                                title = "Spoken feedback",
                                summary = "Off by default. Opens Android TV Accessibility settings for " +
                                    "viewers who want narration.",
                                value = if (screenReaderActive) "On" else "Off",
                                icon = { Icon(Icons.Default.RecordVoiceOver, contentDescription = null) },
                                onClick = { openAccessibilitySettings(context) },
                            )
                        }
                    }
                    SettingsTab.Servers -> item {
                        settingsCategory {
                            ServerPrioritySetting(
                                priority = serverPriority,
                                onChange = SettingsStore::setServerPriority,
                            )
                        }
                    }
                    SettingsTab.Downloads -> item {
                        settingsCategory {
                            settingRow(
                                title = "Default download resolution",
                                summary = "Limits the saved HLS rendition; direct video files keep their " +
                                    "source resolution",
                                value = downloadQuality.label,
                                onClick = { downloadQualityDialog = true },
                            )
                            rowDivider()
                            settingRow(
                                title = "Default download destination",
                                summary = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                    "Device Downloads rewraps each episode into one MP4 under " +
                                        "Downloads/Anilili and drops the cached copy. Both keeps the " +
                                        "cached copy as well, at roughly double the storage."
                                } else {
                                    "Public device downloads require Android 10 or newer, so episodes " +
                                        "stay in Anilili."
                                },
                                value = downloadDestination.label,
                                onClick = { downloadDestinationDialog = true },
                            )
                        }
                    }
                    SettingsTab.Content -> item {
                        settingsCategory {
                            settingRow(
                                title = "Blur episode images",
                                summary = "Hide possible spoilers. You can also tap any episode image to " +
                                    "toggle this everywhere.",
                                onClick = { SettingsStore.setBlurEpisodeImages(!blurEpisodeImages) },
                            ) {
                                ExpressiveSwitch(
                                    checked = blurEpisodeImages,
                                    onCheckedChange = SettingsStore::setBlurEpisodeImages,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Hide adult content",
                                summary = "Keep hentai out of Home, Search, Browse, and Schedule",
                                onClick = { SettingsStore.setHideAdultContent(!hideAdultContent) },
                            ) {
                                ExpressiveSwitch(
                                    checked = hideAdultContent,
                                    onCheckedChange = SettingsStore::setHideAdultContent,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                        }
                    }
                    SettingsTab.ListSync -> item {
                        settingsCategory {
                            settingRow(
                                title = if (token != null) "Reconnect AniList" else "Sign in to AniList",
                                summary = when {
                                    token != null -> "AniList is the active list service"
                                    malLoggedIn -> "Switches list sync to AniList after sign-in succeeds"
                                    else -> "Connect lists, scores, and episode progress"
                                },
                                icon = { Icon(Icons.Default.AccountCircle, contentDescription = null) },
                                onClick = { loginService = AccountService.ANILIST },
                            )
                            rowDivider()
                            settingRow(
                                title = if (malLoggedIn) "Reconnect MyAnimeList" else "Sign in to MyAnimeList",
                                summary = when {
                                    malLoggedIn && token == null -> "MyAnimeList is the active list service"
                                    token != null -> "Switches list sync to MyAnimeList after sign-in succeeds"
                                    else -> "Connect lists, scores, and episode progress"
                                },
                                icon = { Icon(Icons.Default.AccountCircle, contentDescription = null) },
                                onClick = { loginService = AccountService.MAL },
                            )
                            rowDivider()
                            settingRow(
                                title = "Sync episode progress",
                                summary = "Update watched episodes while playing",
                                onClick = { SettingsStore.setAutoSyncAniList(!autoSync) },
                            ) {
                                ExpressiveSwitch(
                                    checked = autoSync,
                                    onCheckedChange = SettingsStore::setAutoSyncAniList,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Sync watchlist with Planning",
                                summary = "Import Planning after login and add new saves without replacing " +
                                    "active progress",
                                onClick = { setWatchlistSync(!syncSavedToAniList) },
                            ) {
                                ExpressiveSwitch(
                                    checked = syncSavedToAniList,
                                    onCheckedChange = ::setWatchlistSync,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                        }
                    }
                    SettingsTab.Notifications -> item {
                        settingsCategory {
                            settingRow(
                                title = "Notification alerts",
                                summary = "Logged in: AniList notifications; logged out: saved anime releases",
                                onClick = { setReleaseNotifications(!releaseNotifications) },
                            ) {
                                ExpressiveSwitch(
                                    checked = releaseNotifications,
                                    onCheckedChange = ::setReleaseNotifications,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                        }
                    }
                    SettingsTab.Data -> item {
                        settingsCategory {
                            settingRow(
                                title = if (malExportBusy) "Preparing MyAnimeList export..." else "Export MyAnimeList XML",
                                icon = { Icon(Icons.Default.Download, contentDescription = null) },
                                enabled = !malExportBusy && ((token == null && !malLoggedIn) || profile != null),
                                onClick = ::exportMal,
                            )
                            malExportMessage?.let { message ->
                                rowDivider()
                                Text(
                                    message,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = if (malImportBusy) "Cancel MyAnimeList XML import" else "Import MyAnimeList XML",
                                summary = malImportProgress?.label,
                                icon = { Icon(if (malImportBusy) Icons.Default.Close else Icons.Default.Upload, contentDescription = null) },
                                onClick = {
                                    if (malImportBusy) {
                                        malImportJob?.cancel()
                                    } else {
                                        malImportLauncher.launch(
                                            arrayOf("text/xml", "application/xml", "application/gzip", "application/octet-stream", "*/*"),
                                        )
                                    }
                                },
                            )
                            malImportMessage?.let { message ->
                                rowDivider()
                                Text(
                                    message,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Clear viewing history",
                                icon = { Icon(Icons.Default.DeleteSweep, contentDescription = null) },
                                enabled = history.isNotEmpty(),
                                onClick = LibraryStore::clearHistory,
                            )
                            rowDivider()
                            settingRow(
                                title = cacheUsage.let { usage ->
                                    when {
                                        cacheClearing -> "Clearing cache..."
                                        usage != null -> "Clear cache (${Formatter.formatShortFileSize(context, usage)})"
                                        else -> "Clear cache"
                                    }
                                },
                                icon = { Icon(Icons.Default.Storage, contentDescription = null) },
                                enabled = !cacheClearing && (cacheUsage ?: 0L) > 0L,
                                onClick = ::clearCache,
                            )
                            Text(
                                cacheMessage
                                    ?: "Streamed video and images kept on this device for faster playback. " +
                                        "The video cache auto-trims at 512 MB.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                    SettingsTab.App -> item {
                        settingsCategory {
                            settingRow(
                                title = if (spanish) "Idioma del menú" else "Menu language",
                                summary = if (spanish) {
                                    "Cambia las etiquetas de navegación principales"
                                } else {
                                    "Changes the main navigation labels"
                                },
                                value = when (menuLanguage) {
                                    MenuLanguage.SYSTEM -> if (spanish) "Sistema" else "System"
                                    MenuLanguage.ENGLISH -> if (spanish) "Inglés" else "English"
                                    MenuLanguage.SPANISH -> "Español"
                                },
                                onClick = { menuLanguageDialog = true },
                            )
                            rowDivider()
                            settingRow(
                                title = "Send diagnostics",
                                summary = if (BuildConfig.DIAGNOSTICS_UPLOAD_URL.isNotBlank()) {
                                    "Uploads a full debugging report. Passwords, cookies, tokens and " +
                                        "sensitive links are removed."
                                } else {
                                    "Temporarily unavailable while the private diagnostics service is " +
                                        "being activated."
                                },
                                icon = { Icon(Icons.Default.Upload, contentDescription = null) },
                                enabled = !diagnosticsBusy && BuildConfig.DIAGNOSTICS_UPLOAD_URL.isNotBlank(),
                                onClick = {
                                    diagnosticsError = null
                                    diagnosticsDialogVisible = true
                                },
                            )
                            diagnosticsMessage?.let { message ->
                                rowDivider()
                                Text(
                                    message,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = "Check for updates on launch",
                                summary = "Prompt when a new version is available each time the app opens",
                                onClick = { SettingsStore.setUpdateCheckOnLaunch(!updateCheckOnLaunch) },
                            ) {
                                ExpressiveSwitch(
                                    checked = updateCheckOnLaunch,
                                    onCheckedChange = SettingsStore::setUpdateCheckOnLaunch,
                                    modifier = Modifier.focusProperties { canFocus = false },
                                )
                            }
                            rowDivider()
                            settingRow(
                                title = when (updateState) {
                                    is UpdateManager.State.Checking -> "Checking for updates..."
                                    is UpdateManager.State.Downloading -> "Downloading update..."
                                    else -> "Check for updates"
                                },
                                icon = { Icon(Icons.Default.SystemUpdate, contentDescription = null) },
                                enabled = updateState !is UpdateManager.State.Checking &&
                                    updateState !is UpdateManager.State.Downloading,
                                onClick = { UpdateManager.check(context, manual = true) },
                            )
                            Text(
                                when (val state = updateState) {
                                    is UpdateManager.State.UpToDate -> {
                                        if (state.latestPublishedVersion == UpdateManager.currentVersion) {
                                            "You're on the latest published version (v${UpdateManager.currentVersion})"
                                        } else {
                                            "Installed v${UpdateManager.currentVersion} · published v${state.latestPublishedVersion}"
                                        }
                                    }
                                    else -> "Version ${UpdateManager.currentVersion}"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                    SettingsTab.About -> item {
                        settingsCategory {
                            settingRow(
                                title = "Share Anilili with friends",
                                icon = { Icon(Icons.Default.Share, contentDescription = null) },
                                onClick = { shareAnilili(context, openWebsite = device.isTv) },
                            )
                            rowDivider()
                            settingRow(
                                title = "Join Telegram Group",
                                icon = { Icon(painterResource(R.drawable.ic_telegram), contentDescription = null) },
                                onClick = {
                                    runCatching {
                                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://t.me/anililiapk"))
                                        context.startActivity(intent)
                                    }
                                },
                            )
                            rowDivider()
                            settingRow(
                                title = "GitHub Repository",
                                icon = { Icon(painterResource(R.drawable.ic_github), contentDescription = null) },
                                onClick = {
                                    runCatching {
                                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://github.com/kompoti121/anilili"))
                                        context.startActivity(intent)
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }

    }
}

private const val ANILILI_WEBSITE = "https://kompoti121.github.io/Anilili/"

private fun openAccessibilitySettings(context: Context) {
    runCatching {
        context.startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }.onFailure {
        runCatching {
            context.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
        }
    }
}

private fun shareAnilili(context: Context, openWebsite: Boolean) {
    val website = Uri.parse(ANILILI_WEBSITE)
    if (openWebsite) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, website)) }
        return
    }
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, "Anilili anime app")
        putExtra(
            Intent.EXTRA_TEXT,
            "Try Anilili for anime on Android and Android TV: $ANILILI_WEBSITE",
        )
    }
    runCatching {
        context.startActivity(Intent.createChooser(send, "Share Anilili"))
    }.onFailure {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, website)) }
    }
}

/**
 * Server priority as a single ranked picker, the way a photo grid numbers its selection.
 *
 * Tapping an unpicked server appends it and it takes the next number; tapping a picked one removes
 * it and everything behind closes the gap. Three separate "preferred / first fallback / second
 * fallback" dropdowns expressed the same thing but let a user leave a hole in the middle, and gave
 * no single place to read the resulting order off.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ServerPrioritySetting(
    priority: List<String>,
    onChange: (List<String>) -> Unit,
) {
    val hideAdult by SettingsStore.hideAdultContent.collectAsState()
    val servers = remember(hideAdult) { ProviderCatalog.selectableProviders(hideAdult) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
        Text(
            "Server priority",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
        Text(
            if (priority.isEmpty()) {
                "Pick up to $MAX_SERVER_PRIORITY servers in the order you want them tried. " +
                    "With none picked, the built-in order is used."
            } else {
                priority.mapIndexed { index, server ->
                    "${index + 1}. ${ProviderCatalog.label(server)}"
                }.joinToString("   ")
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            servers.forEach { server ->
                val rank = priority.indexOf(server)
                val picked = rank >= 0
                val full = priority.size >= MAX_SERVER_PRIORITY
                FilterChip(
                    selected = picked,
                    // A full list still lets you tap a picked chip, so the only way out is not
                    // "clear everything" — you drop the one you no longer want.
                    enabled = picked || !full,
                    onClick = {
                        onChange(
                            if (picked) priority.filterNot { it == server } else priority + server,
                        )
                    },
                    label = { Text(ProviderCatalog.label(server)) },
                    leadingIcon = if (picked) {
                        { Text("${rank + 1}", fontWeight = FontWeight.Bold) }
                    } else {
                        null
                    },
                    modifier = Modifier.focusHighlight(MaterialTheme.shapes.large),
                )
            }
        }
        if (priority.isNotEmpty()) {
            ExpressiveTextButton(
                onClick = { onChange(emptyList()) },
                modifier = Modifier.focusHighlight(MaterialTheme.shapes.large),
            ) {
                Text("Clear")
            }
        }
    }
}

@Composable
private fun settingsCategory(
    shape: Shape = MaterialTheme.shapes.extraLarge,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) { Column(content = content) }
}

/**
 * An AOSP main-settings row: leading icon, category title and a trailing chevron, full width with
 * no card so the divider under each entry runs edge to edge like the stock Settings list.
 */
@Composable
private fun categoryRow(
    title: String,
    icon: (@Composable () -> Unit)?,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .focusHighlight(MaterialTheme.shapes.medium)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke()
        if (icon != null) {
            Spacer(Modifier.width(16.dp))
        }
        Text(
            title,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.Default.ChevronRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun categoryIcon(tab: SettingsTab): ImageVector = when (tab) {
    SettingsTab.Playback -> Icons.Default.PlayArrow
    SettingsTab.Servers -> Icons.Default.Cloud
    SettingsTab.Downloads -> Icons.Default.Download
    SettingsTab.Content -> Icons.Default.Visibility
    SettingsTab.ListSync -> Icons.Default.Sync
    SettingsTab.Notifications -> Icons.Default.Notifications
    SettingsTab.Data -> Icons.Default.Storage
    SettingsTab.App -> Icons.Default.Settings
    SettingsTab.About -> Icons.Default.Info
    SettingsTab.Accessibility -> Icons.Default.RecordVoiceOver
}

/**
 * An AOSP-style setting row: icon, title, optional summary and trailing value, then either the
 * passed [trailing] control or a chevron when the row is a drill-in. The whole row is clickable so
 * D-pad and touch users get the full 48 dp target; switches keep [Modifier.focusProperties] so the
 * row (not the switch) takes focus on TV.
 */
@Composable
private fun settingRow(
    title: String,
    summary: String? = null,
    value: String? = null,
    icon: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier
                        .focusHighlight(MaterialTheme.shapes.large)
                        .clickable(enabled = enabled, onClick = onClick)
                } else {
                    Modifier
                }
            )
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.invoke()
        if (icon != null) {
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurface.copy(alpha = .38f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (summary != null) {
                Text(
                    summary,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        value?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = if (enabled) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface.copy(alpha = .38f)
                },
                maxLines = 1,
                modifier = Modifier.padding(start = 16.dp),
            )
        }
        if (trailing != null) {
            trailing()
        } else if (onClick != null) {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = if (enabled) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface.copy(alpha = .38f)
                },
                modifier = Modifier.padding(start = 16.dp),
            )
        }
    }
}

@Composable
private fun ColumnScope.rowDivider() {
    HorizontalDivider(
        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f),
        modifier = Modifier.padding(horizontal = 16.dp),
    )
}

/**
 * A single-choice setting picker shown as an AOSP radio dialog. The row in the settings list shows
 * the current [selected] value and opens this with a chevron.
 */
@Composable
private fun <T> SettingsRadioDialog(
    title: String,
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                options.forEach { option ->
                    val isSelected = option == selected
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = isSelected,
                                role = Role.RadioButton,
                                onClick = { onSelect(option) },
                            )
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            label(option),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f),
                        )
                        RadioButton(selected = isSelected, onClick = null)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Done") }
        },
    )
}


/** A single top-level settings category, shown as one tab in the AOSP-style tab row. */
private enum class SettingsTab {
    Playback,
    Accessibility,
    Servers,
    Downloads,
    Content,
    ListSync,
    Notifications,
    Data,
    App,
    About,
}


private fun Context.malImportReportedSize(uri: Uri): Long? =
    runCatching {
        contentResolver.query(
            uri,
            arrayOf(OpenableColumns.SIZE),
            null,
            null,
            null,
        )?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val column = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (column < 0 || cursor.isNull(column)) null else cursor.getLong(column).takeIf { it >= 0L }
        }
    }.getOrNull()
