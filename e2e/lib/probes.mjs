// Датчики внутри страницы. installProbes встраивается до скриптов сайта
// (context.addInitScript) и даёт тестам window.__e2e:
//
//  • уровни принятого звука по каждой чужой дорожке, раздельно левый и правый
//    канал — так, как их разложат колонки (апмикс моно → оба канала). Владелец
//    дорожки — «PA_…|TR_…» из msid в SDP: по нему тест находит identity;
//  • уровень того, что реально уходит в колонки: ответвление от всех подключений
//    к AudioContext.destination (после громкостей и цепочки сайта);
//  • уровень своего исходящего звука (отправитель);
//  • время нажатия и отпускания клавиш — для замера задержки рации;
//  • по запросу (installInputProbe) — что человек говорит в сам микрофон.
//
// Время везде — performance.timeOrigin + performance.now(): у страниц одного
// браузера часы общие, и моменты из разных вкладок можно сравнивать.

export function installProbes() {
  if (window.__e2e) return;
  const now = () => performance.timeOrigin + performance.now();
  const SAMPLE_MS = 20;
  const HISTORY_MS = 30000;
  const E = { pcs: [], keys: [], silence: 0.003 };
  window.__e2e = E;

  // ── Все RTCPeerConnection страницы (у LiveKit их два: публикация и подписка) ──
  const OrigPC = window.RTCPeerConnection;
  function PatchedPC(...args) {
    const pc = new OrigPC(...args);
    E.pcs.push(pc);
    return pc;
  }
  PatchedPC.prototype = OrigPC.prototype;
  Object.setPrototypeOf(PatchedPC, OrigPC);
  window.RTCPeerConnection = PatchedPC;

  // Нарушения CSP и загрузка модулей AudioWorklet (шумодав): на прод-сборке
  // CSP строгая, и сломанный адрес проявился бы только здесь.
  E.csp = [];
  document.addEventListener("securitypolicyviolation", (e) =>
    E.csp.push(`${e.effectiveDirective} ← ${e.blockedURI || "(inline)"} @ ${e.sourceFile || "?"}:${e.lineNumber}`),
  );
  E.worklets = [];
  if (window.AudioWorklet) {
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url, ...rest) {
      return addModule.call(this, url, ...rest).then(
        (v) => {
          E.worklets.push(`OK ${url}`);
          return v;
        },
        (err) => {
          E.worklets.push(`FAIL ${url}: ${err}`);
          throw err;
        },
      );
    };
  }

  for (const type of ["keydown", "keyup"]) {
    window.addEventListener(
      type,
      (e) => {
        if (!e.repeat) E.keys.push({ type, code: e.code, t: now() });
      },
      true,
    );
  }

  // ── Измеритель: апмикс в стерео → два анализатора ──────────────────────────
  let meterCtx = null;
  function stereoMeter(ctx, input) {
    const up = ctx.createGain();
    up.channelCount = 2;
    up.channelCountMode = "explicit";
    up.channelInterpretation = "speakers";
    const split = ctx.createChannelSplitter(2);
    const l = ctx.createAnalyser();
    const r = ctx.createAnalyser();
    l.fftSize = 1024;
    r.fftSize = 1024;
    if (input) input.connect(up);
    up.connect(split);
    split.connect(l, 0);
    split.connect(r, 1);
    return { input: up, l, r, buf: new Float32Array(1024), hist: [] };
  }
  const rms = (an, buf) => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  };
  function trackMeter(track) {
    meterCtx ??= new AudioContext();
    const src = meterCtx.createMediaStreamSource(new MediaStream([track]));
    return stereoMeter(meterCtx, src);
  }

  // Чужие дорожки: по одному измерителю на приёмник; владелец — из SDP по mid
  // (LiveKit переиспользует приёмники, поэтому владелец перечитывается).
  const inMeters = new Map(); // receiver → meter
  const outMeters = new Map(); // sender → meter
  function ownersByMid(pc) {
    const map = new Map();
    const sdp = pc.remoteDescription?.sdp ?? "";
    for (const section of sdp.split(/\r?\nm=/).slice(1)) {
      const mid = /\na=mid:(\S+)/.exec(section);
      const msid = /\na=msid:(\S+)/.exec(section);
      const inactive = /\na=inactive/.test(section);
      if (mid && msid && !inactive) map.set(mid[1], msid[1]);
    }
    return map;
  }
  function scan() {
    for (const pc of E.pcs) {
      if (pc.connectionState === "closed") continue;
      const owners = ownersByMid(pc);
      for (const tr of pc.getTransceivers()) {
        const track = tr.receiver.track;
        if (track && track.kind === "audio" && tr.mid !== null) {
          let m = inMeters.get(tr.receiver);
          if (!m) inMeters.set(tr.receiver, (m = trackMeter(track)));
          m.owner = owners.get(tr.mid) ?? null;
        }
        const sent = tr.sender.track;
        if (sent && sent.kind === "audio" && sent.readyState === "live") {
          let m = outMeters.get(tr.sender);
          if (!m || m.track !== sent) {
            outMeters.set(tr.sender, (m = trackMeter(sent)));
            m.track = sent;
          }
          m.owner = `local:${sent.label}`;
        }
      }
    }
  }
  E.scan = scan;

  // Ответвление от всего, что подключают к колонкам (у сайта один AudioContext
  // воспроизведения: голоса, звуки интерфейса, «Слышать себя»).
  const taps = new Map(); // AudioContext → meter
  const origConnect = AudioNode.prototype.connect;
  const origDisconnect = AudioNode.prototype.disconnect;
  const tapOf = (ctx) => {
    let tap = taps.get(ctx);
    if (!tap) {
      tap = stereoMeter(ctx, null);
      tap.owner = "out";
      taps.set(ctx, tap);
    }
    return tap;
  };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = origConnect.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode && dest.context !== meterCtx) {
        origConnect.call(this, tapOf(dest.context).input);
      }
    } catch {
      // датчик не должен ломать сайт
    }
    return result;
  };
  AudioNode.prototype.disconnect = function (...args) {
    try {
      const dest = args[0];
      if (dest instanceof AudioDestinationNode && taps.has(dest.context)) {
        origDisconnect.call(this, taps.get(dest.context).input);
      }
    } catch {
      // уже отключён
    }
    return origDisconnect.apply(this, args);
  };

  const push = (m) => {
    const t = now();
    const L = rms(m.l, m.buf);
    const R = rms(m.r, m.buf);
    m.hist.push({ t, L, R, owner: m.owner });
    while (m.hist.length && m.hist[0].t < t - HISTORY_MS) m.hist.shift();
  };
  setInterval(scan, 500);
  setInterval(() => {
    for (const m of inMeters.values()) push(m);
    for (const m of outMeters.values()) push(m);
    for (const m of taps.values()) push(m);
  }, SAMPLE_MS);

  /** Сводка по владельцам за окно: средние L/R по кадрам со звуком, сколько таких кадров, максимум. */
  function summary(meters, sinceMs, untilMs) {
    const to = untilMs ?? now();
    const from = to - sinceMs;
    const by = new Map();
    for (const m of meters) {
      for (const h of m.hist) {
        if (h.t < from || h.t > to || !h.owner) continue;
        let s = by.get(h.owner);
        if (!s) by.set(h.owner, (s = { owner: h.owner, L: 0, R: 0, frames: 0, samples: 0, max: 0 }));
        s.samples++;
        s.max = Math.max(s.max, h.L, h.R);
        if (Math.max(h.L, h.R) > E.silence) {
          s.L += h.L;
          s.R += h.R;
          s.frames++;
        }
      }
    }
    return [...by.values()].map((s) => ({
      ...s,
      L: s.frames ? s.L / s.frames : 0,
      R: s.frames ? s.R / s.frames : 0,
    }));
  }
  E.now = now;
  E.heard = (sinceMs, untilMs) => summary(inMeters.values(), sinceMs, untilMs);
  E.sent = (sinceMs, untilMs) => summary(outMeters.values(), sinceMs, untilMs);
  E.speakers = (sinceMs, untilMs) => summary(taps.values(), sinceMs, untilMs);
  /** Ряд замеров одной дорожки (owner — подстрока владельца) за окно [from, to]. */
  E.series = (ownerPart, from, to) => {
    const out = [];
    for (const m of [...inMeters.values(), ...outMeters.values(), ...taps.values()]) {
      for (const h of m.hist) {
        if (h.owner && h.owner.includes(ownerPart) && h.t >= from && h.t <= to) {
          out.push({ t: h.t, v: Math.max(h.L, h.R) });
        }
      }
    }
    return out.sort((a, b) => a.t - b.t);
  };
}

/**
 * Что человек говорит в микрофон — до рации, шумодава и сети: клон каждого
 * аудиотрека getUserMedia со своим измерителем. Заглушение трека (mute рации)
 * клона не касается — enabled у каждого MediaStreamTrack свой. Нужен, чтобы
 * отличать «звук обрезали» от «человек сам замолчал». Ставится после
 * installProbes и только тем, кому нужен (Person.create(..., { micInput: true })):
 * лишний клон держит устройство, пока жив исходный трек.
 *
 * window.__e2e.input(from, to) → [{ t, v }] — громкость входа (RMS, максимум по
 * живым микрофонам страницы) раз в 20 мс.
 */
export function installInputProbe() {
  const E = window.__e2e;
  const md = navigator.mediaDevices;
  if (!E || E.input || !md?.getUserMedia) return;
  const now = () => performance.timeOrigin + performance.now();
  const mics = []; // { src, clone, an }
  const hist = [];
  const buf = new Float32Array(1024);
  let ctx = null;

  const getUserMedia = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints) => {
    const stream = await getUserMedia(constraints);
    for (const src of stream.getAudioTracks()) {
      try {
        ctx ??= new AudioContext();
        const clone = src.clone();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(new MediaStream([clone])).connect(an);
        mics.push({ src, clone, an });
      } catch {
        // датчик не должен ломать сайт
      }
    }
    return stream;
  };

  setInterval(() => {
    let v = 0;
    let live = 0;
    for (let i = mics.length - 1; i >= 0; i--) {
      const m = mics[i];
      // Сайт закрыл микрофон (сменили устройство, вышли) — отпускаем и клон.
      if (m.src.readyState === "ended") {
        m.clone.stop();
        mics.splice(i, 1);
        continue;
      }
      m.an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let j = 0; j < buf.length; j++) s += buf[j] * buf[j];
      v = Math.max(v, Math.sqrt(s / buf.length));
      live++;
    }
    if (!live) return;
    const t = now();
    hist.push({ t, v });
    while (hist.length && hist[0].t < t - 30000) hist.shift();
  }, 20);

  E.input = (from, to) => hist.filter((h) => h.t >= from && h.t <= to);
}
