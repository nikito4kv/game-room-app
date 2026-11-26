/**
 * Узлы на чужой дорожке (через RemoteAudioTrack.setWebAudioPlugins):
 *
 *   приём → [анализатор] → громкость → мягкий лимитер → (громкость LiveKit = 1) → вывод
 *
 *  • анализатор — уровень для «говорит» (до громкости: заглушённый «для себя»
 *    друг всё равно подсвечивается, как в Discord);
 *  • громкость — своя, а не LiveKit: узел создаётся сразу с нужным значением, и
 *    заглушённый друг не «проскакивает» на 100 % при подключении дорожки (у
 *    LiveKit новый узел стартует с 1 и плавно едет к цели — аудит 1-audio, 3.16);
 *  • лимитер — громкость выше 100 % без хрипа: пики не уходят за 0 дБFS (аудит
 *    1-audio, 3.10). Порог у самого верха, поэтому на 100 % и ниже он почти не
 *    работает — голос не «сжимается».
 */
export type RemoteChain = {
  /** Только для голоса; у звука демонстрации анализатора нет. */
  analyser: AnalyserNode | null;
  /** Узлы по порядку — для setWebAudioPlugins (их соединяет LiveKit). */
  nodes: AudioNode[];
  /** Громкость 0…2, плавно (без щелчков при движении ползунка). */
  setVolume: (volume: number) => void;
  dispose: () => void;
};

export function createRemoteChain(ctx: AudioContext, volume: number, withAnalyser: boolean): RemoteChain {
  const analyser = withAnalyser ? ctx.createAnalyser() : null;
  if (analyser) {
    analyser.fftSize = 1024; // ≈21 мс на 48 кГц — хватает на уровень слога
    analyser.smoothingTimeConstant = 0;
  }
  const gain = ctx.createGain();
  gain.gain.value = volume;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 1;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  const nodes: AudioNode[] = [...(analyser ? [analyser] : []), gain, limiter];
  return {
    analyser,
    nodes,
    setVolume(v) {
      gain.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
    },
    dispose() {
      for (const n of nodes) n.disconnect();
    },
  };
}
