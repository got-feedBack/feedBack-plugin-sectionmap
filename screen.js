// Section Map plugin
// Shows a minimap bar of the full song structure with clickable sections.

let _smBar = null;
let _smSections = [];
let _smDuration = 0;

const SM_COLORS = {
    'intro': '#3b82f6',
    'verse': '#22c55e',
    'chorus': '#eab308',
    'bridge': '#a855f7',
    'solo': '#ef4444',
    'outro': '#6b7280',
    'breakdown': '#f97316',
    'riff': '#06b6d4',
    'pre': '#84cc16',
    'noguitar': '#374151',
    'default': '#4b5563',
};

function _smGetColor(name) {
    const low = name.toLowerCase();
    for (const [key, color] of Object.entries(SM_COLORS)) {
        if (low.includes(key)) return color;
    }
    return SM_COLORS.default;
}

function _smCreate() {
    if (_smBar) return;
    const player = document.getElementById('player');
    if (!player) return;

    _smBar = document.createElement('div');
    _smBar.id = 'section-map';
    _smBar.style.cssText = 'position:absolute;top:0;left:0;right:0;z-index:5;height:20px;background:rgba(8,8,16,0.7);cursor:pointer;';

    // Insert as first child of player (very top)
    player.insertBefore(_smBar, player.firstChild);

    _smBar.addEventListener('click', _smOnClick);
    _smBar.addEventListener('wheel', _smOnWheel, { passive: false });
}

function _smRemove() {
    if (_smBar) {
        _smBar.remove();
        _smBar = null;
    }
}

// The playback clock, across whichever backend is driving audio. getTime() is
// the audio-aligned clock the host exposes to plugins; the raw <audio> element
// is only a fallback (and is stale when a native/streaming backend is playing).
function _smNow() {
    if (typeof highway !== 'undefined' && highway && typeof highway.getTime === 'function') {
        const t = highway.getTime();
        if (Number.isFinite(t)) return t;
    }
    const audio = document.getElementById('audio');
    return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
}

// Reposition through the host's canonical seek funnel (window.feedBack.seek ->
// _audioSeek). It moves whichever backend is ACTUALLY playing — JUCE native
// output, or the bounded-memory stem-streaming worklet, which only reseeks in
// response to the song:seek event the funnel emits — and keeps the highway
// clock in sync. Poking audio.currentTime directly only relocates regions the
// <audio> element has already buffered near the playhead, so once playback
// moved off that element (native routing + stem streaming) far sections stopped
// seeking — they land in an unbuffered/unstreamed region and snap back. The raw
// path stays only as a fallback for a host old enough to lack the seek API.
function _smSeek(time, reason) {
    // Clamp centrally so every caller (click passes a raw pct*duration; a pct
    // just over 1 at the bar's right edge would otherwise seek past the end).
    const max = (typeof _smDuration === 'number' && _smDuration > 0) ? _smDuration : Infinity;
    const t = Math.max(0, Math.min(max, time));
    const host = (typeof window !== 'undefined') && (window.feedBack || window.slopsmith);
    if (host && typeof host.seek === 'function') {
        host.seek(t, reason);
        return;
    }
    const audio = document.getElementById('audio');
    if (!audio) return;
    // Legacy fallback: keep the jump detector from reverting the seek, and
    // pause/seek/resume because seeking during playback fails on unbuffered regions.
    if (typeof lastAudioTime !== 'undefined') lastAudioTime = t;
    const wasPlaying = !audio.paused;
    if (wasPlaying) audio.pause();
    audio.currentTime = t;
    if (wasPlaying) {
        audio.addEventListener('seeked', function resume() {
            audio.removeEventListener('seeked', resume);
            audio.play();
        }, { once: true });
    }
}

function _smOnClick(e) {
    if (!_smDuration) return;
    const rect = _smBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    _smSeek(pct * _smDuration, 'sectionmap-click');
}

function _smOnWheel(e) {
    if (!_smDuration) return;
    e.preventDefault();
    // up (negative deltaY) = forward, down (positive deltaY) = backward
    const increment = e.ctrlKey ? 0.1 : 1; // Fine control with Ctrl modifier
    const deltaTime = -(e.deltaY > 0 ? 1 : -1) * increment;
    const newTime = Math.max(0, Math.min(_smDuration, _smNow() + deltaTime));
    _smSeek(newTime, 'sectionmap-wheel');
}

function _smUpdate() {
    if (!_smBar) return;
    const sections = highway.getSections();
    const info = highway.getSongInfo();
    const t = highway.getTime();

    if (!sections || sections.length === 0 || !info.duration) return;

    _smDuration = info.duration;

    // Only rebuild if sections changed
    if (sections !== _smSections) {
        _smSections = sections;
        _smRender();
    }

    // Update playback position indicator
    const marker = document.getElementById('sm-marker');
    if (marker && _smDuration > 0) {
        const pct = (t / _smDuration) * 100;
        marker.style.left = pct + '%';
    }

    // Highlight active section
    const blocks = _smBar.querySelectorAll('.sm-block');
    let activeIdx = 0;
    for (let i = 0; i < _smSections.length; i++) {
        if (_smSections[i].time <= t) activeIdx = i;
        else break;
    }
    blocks.forEach((block, i) => {
        block.style.opacity = i === activeIdx ? '1' : '0.5';
    });
}

function _smRender() {
    if (!_smBar || !_smSections.length || !_smDuration) return;

    let html = '';

    for (let i = 0; i < _smSections.length; i++) {
        const sec = _smSections[i];
        const nextTime = i < _smSections.length - 1 ? _smSections[i + 1].time : _smDuration;
        const startPct = (sec.time / _smDuration) * 100;
        const widthPct = ((nextTime - sec.time) / _smDuration) * 100;
        const color = _smGetColor(sec.name);

        // Clean up section name for display
        let label = sec.name.replace(/\d+$/, '').trim();
        label = label.charAt(0).toUpperCase() + label.slice(1);

        const safeLabel = _smEscapeHtml(label);
        const safeTitle = _smEscapeHtml(`${label} (${_smFmt(sec.time)})`);
        html += `<div class="sm-block" style="position:absolute;left:${startPct}%;width:${widthPct}%;top:0;bottom:0;background:${color};border-right:1px solid rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity 0.15s;"
            title="${safeTitle}">
            <span style="font-size:9px;color:rgba(255,255,255,0.8);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;padding:0 3px;">${safeLabel}</span>
        </div>`;
    }

    // Playback position marker
    html += '<div id="sm-marker" style="position:absolute;top:0;bottom:0;width:2px;background:white;z-index:1;pointer-events:none;transition:left 0.1s linear;"></div>';

    _smBar.innerHTML = html;
    _smBar.style.position = 'relative';
}

function _smFmt(s) {
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function _smEscapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Node-only export hook for tests; browsers fall through to the side-effect
// IIFE below (poller + playSong/showScreen wrapping).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        _smGetColor, _smFmt, _smCreate, _smRemove, _smUpdate, _smRender,
        _smOnClick, _smOnWheel, _smEscapeHtml,
        _getState: () => ({ bar: _smBar, sections: _smSections, duration: _smDuration }),
        _setState(next) {
            if ('sections' in next) _smSections = next.sections;
            if ('duration' in next) _smDuration = next.duration;
            if ('bar' in next) _smBar = next.bar;
        },
    };
} else {

// Side effects: poller + playSong/showScreen wrappers. Consolidated under
// one idempotency guard so re-evaluation (loader cache miss, hot reload,
// older core builds without the load-side guard) doesn't start a second
// 5Hz poller and doesn't grow either wrapper chain.
(function() {
    const HOOK_KEY = '__slopsmithSectionMapHooksInstalled';
    if (window[HOOK_KEY]) return;
    window[HOOK_KEY] = true;

    // Poll for updates
    setInterval(_smUpdate, 200);

    // Hook into playSong
    const origPlaySong = window.playSong;
    window.playSong = async function(filename, arrangement) {
        _smRemove();
        _smSections = [];
        _smDuration = 0;
        await origPlaySong(filename, arrangement);
        _smCreate();
    };

    // Clean up when leaving player
    const origShowScreen = window.showScreen;
    window.showScreen = function(id) {
        if (id !== 'player') _smRemove();
        origShowScreen(id);
    };
})();

}
