'use strict';
// Coverage for pure/DOM-light helpers in screen.js: section color lookup,
// time formatting, render HTML shape, click/wheel seek math.
// Runs under the org reusable CI as `node tests/screen.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin() {
    global.window = {};
    global.document = { getElementById: () => null };
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

class FakeBar {
    constructor() {
        this.innerHTML = '';
        this.style = {};
        this._listeners = {};
        this.left = 0;
        this.width = 500;
        this.captured = [];
        this.released = [];
        this.removed = false;
    }
    addEventListener(type, fn) { this._listeners[type] = fn; }
    removeEventListener(type) { delete this._listeners[type]; }
    setPointerCapture(id) { this.captured.push(id); }
    releasePointerCapture(id) { this.released.push(id); }
    remove() { this.removed = true; }
    getBoundingClientRect() { return { left: this.left, width: this.width }; }
    querySelectorAll() { return []; }
}

class FakeMarker {
    constructor() {
        this.style = { left: '0%', transition: 'left 0.1s linear' };
    }
}

class FakeTimeLabel {
    constructor(width = 80) {
        this._offsetWidth = width;
        this.measureCount = 0;
        this.textContent = '';
        this.style = { display: 'none', left: '0px' };
    }
    get offsetWidth() {
        this.measureCount++;
        return this._offsetWidth;
    }
}

class FakeAudio {
    constructor() {
        this.currentTime = 0;
        this.paused = true;
        this._listeners = {};
    }
    pause() { this.paused = true; }
    play() { this.paused = false; }
    addEventListener(type, fn) { this._listeners[type] = fn; }
    removeEventListener() {}
}

class FakePlayer {
    constructor() {
        this.children = [];
        this.firstChild = null;
    }
    insertBefore(child) {
        this.children.unshift(child);
        this.firstChild = this.children[0] || null;
    }
}

test('_smGetColor matches by substring, case-insensitively', () => {
    const mod = freshPlugin();
    assert.equal(mod._smGetColor('Verse 1'), '#22c55e');
    assert.equal(mod._smGetColor('CHORUS'), '#eab308');
    assert.equal(mod._smGetColor('Guitar Solo'), '#ef4444');
});

test('_smGetColor falls back to default for an unrecognized section name', () => {
    const mod = freshPlugin();
    assert.equal(mod._smGetColor('Mystery Section'), '#4b5563');
});

test('_smFmt formats seconds as m:ss with zero-padded seconds', () => {
    const mod = freshPlugin();
    assert.equal(mod._smFmt(0), '0:00');
    assert.equal(mod._smFmt(65), '1:05');
    assert.equal(mod._smFmt(600), '10:00');
});

test('_smRender builds one .sm-block-tagged div per section plus a position marker', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    mod._setState({
        bar,
        sections: [{ name: 'Intro', time: 0 }, { name: 'Verse 1', time: 10 }],
        duration: 20,
    });
    mod._smRender();
    assert.equal((bar.innerHTML.match(/sm-block/g) || []).length, 2);
    assert.ok(bar.innerHTML.includes('id="sm-marker"'));
    assert.ok(bar.innerHTML.includes('id="sm-drag-time"'));
    assert.ok(bar.innerHTML.includes('left:0%'));   // Intro starts at 0%
    assert.ok(bar.innerHTML.includes('left:50%'));  // Verse 1 starts at 10/20
});

test('_smRender strips a trailing numeric suffix and capitalizes the label', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    mod._setState({ bar, sections: [{ name: 'verse2', time: 0 }], duration: 10 });
    mod._smRender();
    assert.ok(bar.innerHTML.includes('>Verse<'));
});

test('_smCreate reserves the strip for Section Map touch gestures', () => {
    const mod = freshPlugin();
    const player = new FakePlayer();
    const bar = new FakeBar();
    global.document = {
        getElementById: (id) => (id === 'player' ? player : null),
        createElement: () => bar,
    };

    mod._smCreate();

    assert.equal(mod._getState().bar, bar);
    assert.ok(bar.style.cssText.includes('touch-action:none'));
});

// The seek must go through the host's canonical funnel (window.feedBack.seek),
// NOT raw audio.currentTime — the funnel is what repositions a native/streaming
// backend and emits song:seek so the stem worklet reseeks. Poking the <audio>
// element only moved regions buffered near the playhead (the far-section bug).

test('_smOnClick routes the clicked fraction through the host seek funnel', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    bar.width = 500;
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    const audio = new FakeAudio();
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });
    global.document = { getElementById: (id) => (id === 'audio' ? audio : null) };

    mod._smOnClick({ clientX: 250 }); // 50% across a 500px-wide bar
    assert.deepEqual(seeks, [[50, 'sectionmap-click']]);
    assert.equal(audio.currentTime, 0, 'must not poke the raw element when the funnel exists');
});

test('_smOnClick clamps a right-edge overshoot to the song duration', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    bar.width = 500;
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = { getElementById: () => null };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    mod._smOnClick({ clientX: 505 }); // pct = 1.01 -> would be 101s without the clamp
    assert.deepEqual(seeks, [[100, 'sectionmap-click']]);
});

test('_smNow reads the host clock (getTime) so a wheel nudge starts from real position', () => {
    const mod = freshPlugin();
    global.highway = { getTime: () => 42 };
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = { getElementById: () => null };
    mod._setState({ bar: new FakeBar(), sections: [{ name: 'Intro', time: 0 }], duration: 100 });
    try {
        mod._smOnWheel({ deltaY: -1, ctrlKey: true, preventDefault: () => {} });
        assert.deepEqual(seeks, [[42.1, 'sectionmap-wheel']]); // 42 (host clock) + 0.1 fine step
    } finally {
        delete global.highway;
    }
});

test('_smOnWheel routes the computed delta through the funnel and clamps to [0, duration]', () => {
    const mod = freshPlugin();
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    const audio = new FakeAudio();
    audio.currentTime = 0; // no host clock in test -> falls back to audio position
    global.document = { getElementById: (id) => (id === 'audio' ? audio : null) };
    mod._setState({ bar: new FakeBar(), sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    let prevented = false;
    mod._smOnWheel({ deltaY: 1, ctrlKey: false, preventDefault: () => { prevented = true; } }); // backward from 0
    assert.equal(prevented, true);
    assert.deepEqual(seeks, [[0, 'sectionmap-wheel']]); // clamped at 0, can't go negative
});

// Fallback: a host too old to expose window.feedBack.seek still seeks the raw
// <audio> element, pausing/resuming around it as before.

test('_smOnClick falls back to the raw <audio>, pausing/seeking/resuming while playing', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const audio = new FakeAudio();
    audio.paused = false;
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });
    global.document = { getElementById: (id) => (id === 'audio' ? audio : null) };

    mod._smOnClick({ clientX: 0 }); // no window.feedBack.seek -> fallback path
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.paused, true); // paused before the seek
    audio._listeners.seeked(); // simulate the browser firing 'seeked'
    assert.equal(audio.paused, false); // resumed
});

test('_smOnWheel fallback pokes the raw <audio> when there is no seek API', () => {
    const mod = freshPlugin();
    const audio = new FakeAudio();
    audio.currentTime = 10;
    audio.paused = true;
    mod._setState({ bar: new FakeBar(), sections: [{ name: 'Intro', time: 0 }], duration: 100 });
    global.document = { getElementById: (id) => (id === 'audio' ? audio : null) };

    mod._smOnWheel({ deltaY: -1, ctrlKey: true, preventDefault: () => {} });
    assert.equal(audio.currentTime, 10.1); // scroll up -> forward by 0.1s (ctrl = fine)
});

test('_smOnWheel/_smOnClick are no-ops without a known duration', () => {
    const mod = freshPlugin();
    const audio = new FakeAudio();
    mod._setState({ bar: new FakeBar(), sections: [], duration: 0 });
    global.document = { getElementById: (id) => (id === 'audio' ? audio : null) };

    mod._smOnClick({ clientX: 100 });
    mod._smOnWheel({ deltaY: 1, preventDefault: () => {} });
    assert.equal(audio.currentTime, 0); // untouched
});

test('pointer drag previews the marker and seeks once on release', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const marker = new FakeMarker();
    const timeLabel = new FakeTimeLabel();
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = {
        getElementById: (id) => id === 'sm-marker' ? marker : (id === 'sm-drag-time' ? timeLabel : null),
    };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    mod._smOnPointerDown({ pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 5 });
    mod._smOnPointerMove({ pointerId: 7, clientX: 250, clientY: 5, preventDefault() { this.prevented = true; } });
    assert.equal(marker.style.left, '50%');
    assert.equal(marker.style.transition, 'none');
    assert.deepEqual(seeks, []);
    assert.deepEqual(bar.captured, [7]);
    assert.equal(timeLabel.style.display, 'block');
    assert.equal(timeLabel.textContent, '0:50 / 1:40');
    assert.equal(timeLabel.style.left, '250px');
    assert.equal(timeLabel.measureCount, 1);

    mod._smOnPointerMove({ pointerId: 7, clientX: 251, clientY: 5, preventDefault() {} });
    assert.equal(timeLabel.textContent, '0:50 / 1:40');
    assert.equal(timeLabel.measureCount, 1, 'unchanged label text must reuse its measured width');

    mod._smOnPointerMove({ pointerId: 7, clientX: -20, clientY: 5, preventDefault() {} });
    assert.equal(marker.style.left, '0%');
    assert.equal(timeLabel.textContent, '0:00 / 1:40');
    assert.equal(timeLabel.style.left, '40px', 'left edge keeps the full label visible');

    mod._smOnPointerMove({ pointerId: 7, clientX: 520, clientY: 5, preventDefault() {} });
    assert.equal(marker.style.left, '100%');
    assert.equal(timeLabel.textContent, '1:40 / 1:40');
    assert.equal(timeLabel.style.left, '460px', 'right edge keeps the full label visible');
    assert.deepEqual(seeks, [], 'time preview must not seek while moving');

    let upPrevented = false;
    let upStopped = false;
    mod._smOnPointerUp({
        pointerId: 7,
        clientX: 400,
        preventDefault: () => { upPrevented = true; },
        stopPropagation: () => { upStopped = true; },
    });
    assert.deepEqual(seeks, [[80, 'sectionmap-drag']]);
    assert.equal(marker.style.left, '80%');
    assert.equal(marker.style.transition, 'left 0.1s linear');
    assert.deepEqual(bar.released, [7]);
    assert.equal(timeLabel.style.display, 'none');
    assert.equal(upPrevented, true);
    assert.equal(upStopped, true);

    mod._smOnClick({ clientX: 400, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
    assert.deepEqual(seeks, [[80, 'sectionmap-drag']], 'synthetic click after drag must not seek again');
});

test('pointer press without a drag remains a normal click', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const timeLabel = new FakeTimeLabel();
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = { getElementById: (id) => (id === 'sm-drag-time' ? timeLabel : null) };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    mod._smOnPointerDown({ pointerId: 3, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 100, clientY: 0 });
    assert.equal(timeLabel.style.display, 'none', 'pointer down alone must not show the drag label');
    mod._smOnPointerMove({ pointerId: 3, clientX: 104, clientY: 0, preventDefault() {} });
    assert.equal(timeLabel.style.display, 'none', 'sub-threshold movement must not show the drag label');
    mod._smOnPointerUp({ pointerId: 3, clientX: 104, clientY: 0 });
    mod._smOnClick({ clientX: 250 });

    assert.deepEqual(seeks, [[50, 'sectionmap-click']]);
    assert.deepEqual(bar.captured, []);
    assert.equal(timeLabel.style.display, 'none', 'a tap must not show the drag label');
});

test('vertical pointer movement does not start a horizontal drag', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const marker = new FakeMarker();
    const seeks = [];
    let prevented = false;
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = { getElementById: (id) => (id === 'sm-marker' ? marker : null) };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    mod._smOnPointerDown({ pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 0 });
    mod._smOnPointerMove({
        pointerId: 5,
        clientX: 110,
        clientY: 80,
        preventDefault: () => { prevented = true; },
    });
    mod._smOnPointerUp({ pointerId: 5, clientX: 110, clientY: 80 });

    assert.equal(marker.style.left, '0%');
    assert.equal(marker.style.transition, 'left 0.1s linear');
    assert.equal(prevented, false);
    assert.deepEqual(bar.captured, []);
    assert.deepEqual(seeks, []);
});

test('a real click still works if the post-drag synthetic click is omitted', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const marker = new FakeMarker();
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = { getElementById: (id) => (id === 'sm-marker' ? marker : null) };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    mod._smOnPointerDown({ pointerId: 6, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 0 });
    mod._smOnPointerMove({ pointerId: 6, clientX: 250, clientY: 0, preventDefault() {} });
    mod._smOnPointerUp({ pointerId: 6, clientX: 250, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(seeks, [[50, 'sectionmap-drag']]);
    assert.equal(mod._getState().suppressNextClick, true);

    mod._smOnPointerDown({ pointerId: 8, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 100, clientY: 0 });
    mod._smOnPointerUp({ pointerId: 8, clientX: 100, clientY: 0 });
    mod._smOnClick({ clientX: 300 });

    assert.deepEqual(seeks, [[50, 'sectionmap-drag'], [60, 'sectionmap-click']]);
    assert.equal(mod._getState().suppressNextClick, false);
});

test('cancelling a drag does not seek and live marker updates resume', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const marker = new FakeMarker();
    const timeLabel = new FakeTimeLabel();
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = {
        getElementById: (id) => id === 'sm-marker' ? marker : (id === 'sm-drag-time' ? timeLabel : null),
    };
    global.highway = {
        getSections: () => [{ name: 'Intro', time: 0 }],
        getSongInfo: () => ({ duration: 100 }),
        getTime: () => 20,
    };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    try {
        mod._smOnPointerDown({ pointerId: 9, pointerType: 'pen', isPrimary: true, clientX: 100, clientY: 0 });
        mod._smOnPointerMove({ pointerId: 9, clientX: 250, clientY: 0, preventDefault() {} });
        assert.equal(marker.style.left, '50%');
        assert.equal(timeLabel.style.display, 'block');
        mod._smUpdate();
        assert.equal(marker.style.left, '50%', 'live playback must not overwrite an active drag preview');

        mod._smOnPointerCancel({ pointerId: 9 });
        assert.deepEqual(seeks, []);
        assert.equal(marker.style.transition, 'left 0.1s linear');
        assert.equal(timeLabel.style.display, 'none');
        mod._smUpdate();
        assert.equal(marker.style.left, '20%', 'live playback marker resumes after cancellation');
    } finally {
        delete global.highway;
    }
});

test('descendant capture loss does not cancel a drag, but map capture loss does', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const childBlock = {};
    const marker = new FakeMarker();
    const timeLabel = new FakeTimeLabel();
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = {
        getElementById: (id) => id === 'sm-marker' ? marker : (id === 'sm-drag-time' ? timeLabel : null),
    };
    global.highway = {
        getSections: () => [{ name: 'Intro', time: 0 }],
        getSongInfo: () => ({ duration: 100 }),
        getTime: () => 20,
    };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    try {
        mod._smOnPointerDown({ pointerId: 10, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 0 });
        mod._smOnPointerMove({ pointerId: 10, clientX: 250, clientY: 0, preventDefault() {} });
        assert.equal(marker.style.left, '50%');

        mod._smOnLostPointerCapture({ pointerId: 10, target: childBlock });
        assert.equal(mod._getState().drag.active, true);
        assert.equal(marker.style.transition, 'none');
        assert.equal(timeLabel.style.display, 'block');
        mod._smUpdate();
        assert.equal(marker.style.left, '50%', 'descendant capture loss must not resume live marker updates');

        mod._smOnLostPointerCapture({ pointerId: 10, target: bar });
        assert.equal(mod._getState().drag, null);
        assert.deepEqual(seeks, []);
        assert.equal(marker.style.transition, 'left 0.1s linear');
        assert.equal(timeLabel.style.display, 'none');
        mod._smUpdate();
        assert.equal(marker.style.left, '20%', 'map capture loss clears drag and live marker updates resume');
    } finally {
        delete global.highway;
    }
});

test('leaving Player during a drag removes the map without seeking', () => {
    const mod = freshPlugin();
    const bar = new FakeBar();
    const marker = new FakeMarker();
    const timeLabel = new FakeTimeLabel();
    const seeks = [];
    global.window.feedBack = { seek: (t, reason) => seeks.push([t, reason]) };
    global.document = {
        getElementById: (id) => id === 'sm-marker' ? marker : (id === 'sm-drag-time' ? timeLabel : null),
    };
    mod._setState({ bar, sections: [{ name: 'Intro', time: 0 }], duration: 100 });

    mod._smOnPointerDown({ pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 0 });
    mod._smOnPointerMove({ pointerId: 11, clientX: 250, clientY: 0, preventDefault() {} });
    assert.equal(mod._getState().drag.active, true);
    assert.deepEqual(bar.captured, [11]);

    mod._smOnScreenChanging({ detail: { from: 'player', id: 'player' } });
    mod._smOnScreenChanging({ detail: { from: 'home', id: 'settings' } });
    assert.equal(mod._getState().bar, bar, 'unrelated screen changes must keep the map');

    mod._smOnScreenChanging({ detail: { from: 'player', id: 'v3-songs' } });

    assert.equal(mod._getState().bar, null);
    assert.equal(mod._getState().drag, null);
    assert.equal(bar.removed, true);
    assert.deepEqual(bar.released, [11]);
    assert.deepEqual(seeks, []);
    assert.equal(marker.style.transition, 'left 0.1s linear');
    assert.equal(timeLabel.style.display, 'none');
});
