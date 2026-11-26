/**
 * Переходник «блоки AudioWorklet → кадры обработки → блоки». Браузер зовёт worklet
 * блоками по 128 сэмплов, а RNNoise работает кадрами по 480 (10 мс на 48 кГц).
 * Вход копится, пока не наберётся кадр; обработанный кадр уходит в очередь выхода,
 * из которой каждый вызов забирает свой блок.
 *
 * Чтобы очередь выхода никогда не пустела, она заранее заполнена тишиной на
 * `latency` сэмплов — это минимально возможная задержка переходника. После T
 * полученных сэмплов готово floor(T/F)·F обработанных, а отдать нужно T, значит
 * задержка ≥ T mod F для всех T, кратных блоку. Для 128/480 это 448 сэмплов
 * (9,3 мс) — на 192 меньше, чем у готового worklet RNNoise (640).
 */
export class Reframer {
  readonly latency: number;
  private readonly inFrame: Float32Array;
  private inFill = 0;
  private readonly outFrame: Float32Array;
  private readonly ring: Float32Array;
  private ringRead = 0;
  private ringCount: number;

  constructor(
    readonly frameSize: number,
    blockSize: number,
    private readonly processFrame: (input: Float32Array, output: Float32Array) => void,
  ) {
    this.latency = Reframer.latencyFor(frameSize, blockSize);
    this.inFrame = new Float32Array(frameSize);
    this.outFrame = new Float32Array(frameSize);
    // Запас на кадр и пару блоков сверх задержки — с ним очередь не переполнится.
    this.ring = new Float32Array(this.latency + frameSize + 2 * blockSize);
    this.ringCount = this.latency; // предзаполнение тишиной (буфер уже нулевой)
  }

  /** Минимальная задержка (в сэмплах), при которой выход не опустеет. */
  static latencyFor(frameSize: number, blockSize: number): number {
    let worst = 0;
    // Картина повторяется с периодом НОК(кадр, блок) — его и перебираем.
    for (let t = blockSize; ; t += blockSize) {
      worst = Math.max(worst, t % frameSize);
      if (t % frameSize === 0) break;
    }
    return worst;
  }

  /**
   * Принимает блок входа (undefined — вход не подключён, считаем тишиной) и
   * заполняет блок выхода той же длины.
   */
  push(input: Float32Array | undefined, output: Float32Array): void {
    const n = output.length;
    for (let i = 0; i < n; ) {
      const take = Math.min(n - i, this.frameSize - this.inFill);
      if (input) this.inFrame.set(input.subarray(i, i + take), this.inFill);
      else this.inFrame.fill(0, this.inFill, this.inFill + take);
      this.inFill += take;
      i += take;
      if (this.inFill === this.frameSize) {
        this.processFrame(this.inFrame, this.outFrame);
        this.enqueue(this.outFrame);
        this.inFill = 0;
      }
    }
    this.dequeue(output);
  }

  private enqueue(frame: Float32Array): void {
    const cap = this.ring.length;
    let write = (this.ringRead + this.ringCount) % cap;
    for (let i = 0; i < frame.length; i++) {
      this.ring[write] = frame[i];
      write = write + 1 === cap ? 0 : write + 1;
    }
    this.ringCount = Math.min(this.ringCount + frame.length, cap);
  }

  private dequeue(output: Float32Array): void {
    const cap = this.ring.length;
    const n = Math.min(output.length, this.ringCount);
    let read = this.ringRead;
    for (let i = 0; i < n; i++) {
      output[i] = this.ring[read];
      read = read + 1 === cap ? 0 : read + 1;
    }
    // Нехватка возможна, только если браузер сменит размер блока, — тогда тишина.
    output.fill(0, n);
    this.ringRead = read;
    this.ringCount -= n;
  }
}
