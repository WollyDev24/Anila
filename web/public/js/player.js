// HTML5 + hls.js playback controller with a YouTube-style control bar,
// skip-intro/outro and progress persistence.
import { clock } from "./ui.js";

let hlsPromise = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsPromise) {
    hlsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/hls.min.js";
      script.onload = () => resolve(window.Hls);
      script.onerror = () => reject(new Error("Failed to load hls.js"));
      document.head.appendChild(script);
    });
  }
  return hlsPromise;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  volumeHigh:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a3.5 3.5 0 00-2-3.15v6.3a3.5 3.5 0 002-3.15z"/><path d="M14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-1 7-4.6 7-8.8s-3-7.8-7-8.8z"/></svg>',
  volumeLow:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a3.5 3.5 0 00-2-3.15v6.3a3.5 3.5 0 002-3.15z"/></svg>',
  volumeMute:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M15.5 8.5l6 6M21.5 8.5l-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  cc: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="15.6" text-anchor="middle" font-size="8.5" font-family="Arial, sans-serif" fill="currentColor" font-weight="700">CC</text></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.03 7.03 0 00-1.63-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 00-.61.22L2.72 8.84a.5.5 0 00.12.64l2.03 1.58a7.07 7.07 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.13.23.4.32.61.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.1.48 0 .61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>',
  pip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-8v6h8v-6zm3 8V5H2v14h20zm-2-2H4V7h16v10z"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
  fullExit:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Mount a player into `container`.
 * @returns {{ destroy: () => void, video: HTMLVideoElement, seekTo: (s:number)=>void, currentTime: number }}
 */
export function createPlayer(container, options) {
  const {
    stream,
    subtitles = [],
    skip = null,
    startTime = 0,
    autoplay = true,
    skipIntro = true,
    skipOutro = false,
    subtitleLanguage = "en",
    onProgress = () => {},
    onEnded = () => {},
    onPlay = () => {},
    onPause = () => {},
    onError = () => {},
  } = options;

  container.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "ytp";
  shell.tabIndex = 0;
  shell.innerHTML = `
    <video class="player-video" playsinline preload="auto"></video>
    <div class="ytp-gradient ytp-gradient-top"></div>
    <div class="ytp-gradient ytp-gradient-bottom"></div>
    <button class="ytp-big" type="button" aria-label="Play">${ICONS.play}</button>
    <button class="ytp-skip" type="button" hidden>Skip Intro</button>
    <div class="ytp-tooltip" hidden></div>
    <div class="ytp-controls">
      <div class="ytp-progress" role="slider" tabindex="0" aria-label="Seek">
        <div class="ytp-progress-track">
          <div class="ytp-progress-buffer"></div>
          <div class="ytp-progress-played"></div>
          <div class="ytp-progress-scrubber"></div>
        </div>
      </div>
      <div class="ytp-row">
        <button class="ytp-btn ytp-play" type="button" aria-label="Play">${ICONS.play}</button>
        <div class="ytp-volume">
          <button class="ytp-btn ytp-mute" type="button" aria-label="Mute">${ICONS.volumeHigh}</button>
          <input class="ytp-volume-range" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" />
        </div>
        <span class="ytp-time">0:00 / 0:00</span>
        <span class="ytp-spacer"></span>
        <button class="ytp-btn ytp-cc" type="button" aria-label="Subtitles">${ICONS.cc}</button>
        <button class="ytp-btn ytp-settings" type="button" aria-label="Settings">${ICONS.gear}</button>
        <button class="ytp-btn ytp-pip" type="button" aria-label="Picture in picture">${ICONS.pip}</button>
        <button class="ytp-btn ytp-full" type="button" aria-label="Fullscreen">${ICONS.full}</button>
      </div>
    </div>
    <div class="ytp-menu" hidden></div>
  `;
  container.appendChild(shell);

  const video = shell.querySelector("video");
  const bigBtn = shell.querySelector(".ytp-big");
  const playBtn = shell.querySelector(".ytp-play");
  const muteBtn = shell.querySelector(".ytp-mute");
  const volumeRange = shell.querySelector(".ytp-volume-range");
  const timeEl = shell.querySelector(".ytp-time");
  const ccBtn = shell.querySelector(".ytp-cc");
  const settingsBtn = shell.querySelector(".ytp-settings");
  const pipBtn = shell.querySelector(".ytp-pip");
  const fullBtn = shell.querySelector(".ytp-full");
  const controls = shell.querySelector(".ytp-controls");
  const progress = shell.querySelector(".ytp-progress");
  const playedEl = shell.querySelector(".ytp-progress-played");
  const bufferEl = shell.querySelector(".ytp-progress-buffer");
  const scrubberEl = shell.querySelector(".ytp-progress-scrubber");
  const skipBtn = shell.querySelector(".ytp-skip");
  const tooltip = shell.querySelector(".ytp-tooltip");
  const menu = shell.querySelector(".ytp-menu");

  let hls = null;
  let destroyed = false;
  let lastSaved = 0;
  let failed = false;
  let netRetries = 0;
  let mediaRetries = 0;
  let loadTimer = null;
  let lastError = null;
  let seeking = false;
  let hideTimer = null;
  let clickTimer = null;
  let menuOpen = false;
  let selectedText = -1;
  let skipUsed = false;

  const MAX_NET_RETRIES = 3;
  const MAX_MEDIA_RETRIES = 2;
  const LOAD_TIMEOUT_MS = 30000;
  const HIDE_DELAY = 2800;

  function fail(reason) {
    if (failed || destroyed) return;
    failed = true;
    if (loadTimer) clearTimeout(loadTimer);
    try {
      hls?.stopLoad?.();
    } catch {
      /* ignore */
    }
    console.warn(`playback failed: ${reason}`);
    showControls(true);
    try {
      onError(reason);
    } catch {
      /* ignore */
    }
  }

  function armLoadTimeout() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (video.readyState < 2) {
        let detail = "no data received";
        if (lastError) {
          detail = lastError.details || lastError.type || detail;
          if (lastError.response?.code) detail += ` (HTTP ${lastError.response.code})`;
        }
        fail(`timed out waiting for the stream — ${detail}`);
      }
    }, LOAD_TIMEOUT_MS);
  }

  // ---- controls ----
  function isPlaying() {
    return !video.paused && !video.ended && video.readyState > 2;
  }

  function syncPlayIcon() {
    const icon = isPlaying() ? ICONS.pause : ICONS.play;
    playBtn.innerHTML = icon;
    bigBtn.innerHTML = icon;
    shell.classList.toggle("is-paused", !isPlaying());
    shell.classList.toggle("is-playing", isPlaying());
    playBtn.setAttribute("aria-label", isPlaying() ? "Pause" : "Play");
  }

  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function syncVolumeIcon() {
    let icon = ICONS.volumeHigh;
    if (video.muted || video.volume === 0) icon = ICONS.volumeMute;
    else if (video.volume < 0.5) icon = ICONS.volumeLow;
    muteBtn.innerHTML = icon;
    volumeRange.value = String(video.muted ? 0 : video.volume);
  }

  function showControls(persist = false) {
    shell.classList.remove("ytp--hide");
    if (hideTimer) clearTimeout(hideTimer);
    if (!persist && isPlaying() && !menuOpen && !seeking) {
      hideTimer = setTimeout(() => shell.classList.add("ytp--hide"), HIDE_DELAY);
    }
  }

  function formatTime(seconds) {
    return clock(Number.isFinite(seconds) ? seconds : 0);
  }

  function progressFraction() {
    const d = video.duration;
    return d > 0 ? Math.min(1, video.currentTime / d) : 0;
  }

  function renderProgress() {
    const frac = progressFraction();
    playedEl.style.width = `${frac * 100}%`;
    scrubberEl.style.left = `${frac * 100}%`;
    let buffered = 0;
    try {
      if (video.buffered.length) {
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
            buffered = video.buffered.end(i) / video.duration;
            break;
          }
          buffered = Math.max(buffered, video.buffered.end(i) / video.duration);
        }
      }
    } catch {
      /* ignore */
    }
    bufferEl.style.width = `${Math.min(1, buffered) * 100}%`;
    timeEl.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  }

  function seekToClientX(clientX) {
    const rect = progress.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = frac * video.duration;
      renderProgress();
    }
    return frac;
  }

  // ---- settings menu ----
  function buildMenuItems() {
    const trackList = [];
    subtitles.forEach((sub, i) => {
      trackList.push({
        label: sub.label || sub.language || `Subtitle ${i + 1}`,
        active: selectedText === i,
        action: () => selectTextTrack(i),
      });
    });
    trackList.unshift({
      label: "Off",
      active: selectedText === -1,
      action: () => selectTextTrack(-1),
    });
    const speedLabel = video.playbackRate === 1 ? "Normal" : `${video.playbackRate}x`;
    const subLabel = selectedText === -1 ? "Off" : "On";
    return [
      {
        label: "Playback speed",
        value: speedLabel,
        items: SPEEDS.map((s) => ({
          label: s === 1 ? "Normal" : `${s}x`,
          active: Math.abs(video.playbackRate - s) < 0.01,
          action: () => {
            video.playbackRate = s;
            closeMenu();
          },
        })),
      },
      {
        label: "Subtitles",
        value: subLabel,
        items: trackList,
      },
    ];
  }

  function renderMenu(items, withBack = false) {
    menu.innerHTML = "";
    if (withBack) {
      const back = document.createElement("button");
      back.className = "ytp-menu-item ytp-menu-back";
      back.innerHTML = `${ICONS.back}<span>Back</span>`;
      back.addEventListener("click", () => renderMenu(buildMenuItems()));
      menu.appendChild(back);
    }
    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = `ytp-menu-item${item.active ? " active" : ""}`;
      btn.innerHTML = `<span class="ytp-menu-label">${item.label}</span>${
        item.items ? '<span class="ytp-menu-chevron">›</span>' : item.active ? '<span class="ytp-menu-check">✓</span>' : ""
      }${item.value ? `<span class="ytp-menu-value">${item.value}</span>` : ""}`;
      btn.addEventListener("click", () => {
        if (item.items) renderMenu(item.items, true);
        else if (item.action) {
          item.action();
          renderMenu(buildMenuItems());
        }
      });
      menu.appendChild(btn);
    });
  }

  function openMenu() {
    menuOpen = true;
    renderMenu(buildMenuItems());
    menu.hidden = false;
    showControls(true);
  }

  function closeMenu() {
    menuOpen = false;
    menu.hidden = true;
    showControls();
  }

  function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
  }

  function selectTextTrack(index) {
    selectedText = index;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = i === index ? "showing" : "disabled";
    }
    ccBtn.classList.toggle("active", index !== -1);
    closeMenu();
  }

  function reapplyTextTrack() {
    if (selectedText >= 0) {
      const tracks = video.textTracks;
      if (tracks[selectedText]) tracks[selectedText].mode = "showing";
    }
  }

  // ---- fullscreen / pip ----
  function isFullscreen() {
    return document.fullscreenElement === shell;
  }

  function toggleFullscreen() {
    if (isFullscreen()) document.exitFullscreen?.();
    else shell.requestFullscreen?.().catch(() => {});
  }

  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* not supported */
    }
  }

  // ---- skip intro / outro ----
  function updateSkip() {
    const t = video.currentTime;
    let label = null;
    let target = null;
    if (skipUsed) {
      skipBtn.hidden = true;
      return;
    }
    if (skipIntro && skip && skip.introEnd != null && skip.introEnd > (skip.introStart ?? 0) && t >= (skip.introStart ?? 0) && t < skip.introEnd) {
      label = "Skip Intro";
      target = skip.introEnd;
    } else if (skipOutro && skip && skip.outroStart != null && skip.outroEnd != null && skip.outroEnd > skip.outroStart && t >= skip.outroStart && t < skip.outroEnd) {
      label = "Skip Outro";
      target = skip.outroEnd;
    }
    if (label) {
      skipBtn.textContent = label;
      skipBtn.hidden = false;
      skipBtn.onclick = () => {
        if (target != null) video.currentTime = target;
        skipUsed = true;
        skipBtn.hidden = true;
      };
    } else {
      skipBtn.hidden = true;
    }
  }

  // ---- wiring ----
  playBtn.addEventListener("click", togglePlay);
  bigBtn.addEventListener("click", togglePlay);
  muteBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
    syncVolumeIcon();
  });
  volumeRange.addEventListener("input", () => {
    video.volume = Number(volumeRange.value);
    video.muted = video.volume === 0;
    syncVolumeIcon();
  });
  ccBtn.addEventListener("click", () => {
    selectedText = selectedText === -1 && video.textTracks.length ? 0 : -1;
    selectTextTrack(selectedText);
  });
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  pipBtn.addEventListener("click", togglePip);
  fullBtn.addEventListener("click", toggleFullscreen);

  video.addEventListener("click", () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      togglePlay();
    }, 200);
  });
  shell.addEventListener("dblclick", (e) => {
    if (e.target.closest(".ytp-controls, .ytp-menu, .ytp-skip, .ytp-big")) return;
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    toggleFullscreen();
  });

  progress.addEventListener("pointerdown", (e) => {
    seeking = true;
    progress.setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
    showControls(true);
  });
  progress.addEventListener("pointermove", (e) => {
    if (video.duration > 0) {
      const frac = Math.min(1, Math.max(0, (e.clientX - progress.getBoundingClientRect().left) / progress.getBoundingClientRect().width));
      tooltip.hidden = false;
      tooltip.style.left = `${frac * 100}%`;
      tooltip.textContent = formatTime(frac * video.duration);
    }
    if (seeking) seekToClientX(e.clientX);
  });
  progress.addEventListener("pointerup", (e) => {
    seeking = false;
    try {
      progress.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    showControls();
  });
  progress.addEventListener("pointerleave", () => {
    if (!seeking) tooltip.hidden = true;
  });

  shell.addEventListener("mousemove", () => showControls());
  shell.addEventListener("mouseleave", () => {
    tooltip.hidden = true;
    if (isPlaying() && !menuOpen) shell.classList.add("ytp--hide");
  });
  shell.addEventListener("keydown", (e) => {
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
        break;
      case "ArrowLeft":
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
      case "ArrowUp":
        video.volume = Math.min(1, video.volume + 0.1);
        video.muted = false;
        syncVolumeIcon();
        break;
      case "ArrowDown":
        video.volume = Math.max(0, video.volume - 0.1);
        syncVolumeIcon();
        break;
      case "m":
        video.muted = !video.muted;
        syncVolumeIcon();
        break;
      case "f":
        toggleFullscreen();
        break;
      case "Escape":
        if (menuOpen) closeMenu();
        break;
      default:
        return;
    }
    showControls();
  });

  document.addEventListener("fullscreenchange", onFullscreenChange);
  function onFullscreenChange() {
    const full = isFullscreen();
    fullBtn.innerHTML = full ? ICONS.fullExit : ICONS.full;
    fullBtn.setAttribute("aria-label", full ? "Exit fullscreen" : "Fullscreen");
  }

  // ---- media lifecycle ----
  function armVideoEvents() {
    video.addEventListener("error", () => {
      if (video.error && !video.src.startsWith("blob:")) {
        fail(video.error.message || "the video could not be decoded");
      }
    });

    video.addEventListener("loadedmetadata", () => {
      if (startTime > 1 && startTime < video.duration - 5) video.currentTime = startTime;
      syncVolumeIcon();
      renderProgress();
      if (autoplay) video.play().catch(() => {});
    });

    video.addEventListener("loadeddata", () => {
      if (loadTimer) clearTimeout(loadTimer);
      syncPlayIcon();
    });

    video.addEventListener("play", () => {
      syncPlayIcon();
      showControls();
      onPlay();
    });

    video.addEventListener("pause", () => {
      syncPlayIcon();
      showControls(true);
      onPause();
    });

    video.addEventListener("timeupdate", () => {
      const now = Date.now();
      if (now - lastSaved > 5000) {
        lastSaved = now;
        onProgress(video.currentTime, video.duration);
      }
      renderProgress();
      updateSkip();
    });

    video.addEventListener("progress", renderProgress);

    video.addEventListener("ended", () => {
      onProgress(video.duration, video.duration);
      syncPlayIcon();
      onEnded();
    });

    shell.addEventListener("mousedown", (e) => {
      if (!e.target.closest("button, input, .ytp-menu")) e.preventDefault();
    });
  }

  async function init() {
    const url = stream.proxyUrl || stream.url;
    const isHls = stream.type === "hls" || String(url).includes(".m3u8");
    if (isHls && !video.canPlayType("application/vnd.apple.mpegurl")) {
      const Hls = await loadHls();
      if (destroyed) return;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          lastError = data;
          if (!data.fatal || failed) return;
          console.warn("hls error", data.type, data.details);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (netRetries++ < MAX_NET_RETRIES) {
              hls.startLoad();
              return;
            }
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (mediaRetries++ < MAX_MEDIA_RETRIES) {
              hls.recoverMediaError();
              return;
            }
          }
          const code = data.response?.code ? ` (HTTP ${data.response.code})` : "";
          fail(`${data.details || "the source is unavailable"}${code}`);
        });
      } else {
        video.src = url;
      }
    } else {
      video.src = url;
    }

    armLoadTimeout();

    for (const sub of subtitles) {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = sub.label || sub.language || "Subtitle";
      track.srclang = sub.language || "en";
      track.src = sub.proxyUrl || sub.url;
      if ((sub.language || "").startsWith(subtitleLanguage)) track.default = true;
      video.appendChild(track);
    }
    // If the browser auto-enabled a default track, reflect it in the UI state.
    video.textTracks.addEventListener?.("addtrack", reapplyTextTrack);

    armVideoEvents();
    syncPlayIcon();
    syncVolumeIcon();
    showControls(true);

    // Reflect an auto-selected default subtitle track in the CC button.
    requestAnimationFrame(() => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].mode === "showing") {
          selectedText = i;
          ccBtn.classList.add("active");
          break;
        }
      }
    });
  }

  init().catch((err) => {
    console.error(err);
    video.insertAdjacentHTML(
      "afterend",
      `<div class="player-note">Playback failed to initialize: ${err.message}</div>`,
    );
  });

  return {
    video,
    destroy() {
      destroyed = true;
      if (loadTimer) clearTimeout(loadTimer);
      if (hideTimer) clearTimeout(hideTimer);
      if (clickTimer) clearTimeout(clickTimer);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      try {
        onProgress(video.currentTime, video.duration);
      } catch {
        /* ignore */
      }
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
      container.innerHTML = "";
    },
    seekTo(seconds) {
      video.currentTime = seconds;
    },
    get currentTime() {
      return video.currentTime;
    },
  };
}
