import { Hlc } from '../models/entities';

/**
 * Гибридные логические часы (Hybrid Logical Clock, HLC).
 *
 * Зачем: когда два устройства меняют одно и то же поле, нужно однозначно
 * решить, чьё изменение «позже». Обычные часы устройств могут расходиться,
 * а HLC гарантирует монотонность: каждая новая метка больше предыдущей,
 * даже если системное время откатилось назад.
 *
 * Формат метки: `<время 13 цифр>:<счётчик 5 символов base36>:<id реплики>`.
 * Благодаря фиксированной ширине метки сравниваются как строки.
 */
export class HybridLogicalClock {
  private lastTime = 0;
  private counter = 0;

  constructor(
    /** Уникальный id этого устройства/браузера. Разрешает ничьи. */
    readonly replicaId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Новая метка для локального изменения. */
  tick(): Hlc {
    const time = this.now();
    if (time > this.lastTime) {
      this.lastTime = time;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return formatHlc(this.lastTime, this.counter, this.replicaId);
  }

  /**
   * Учесть метку, пришедшую извне (импорт, другой пир), чтобы следующие
   * локальные метки гарантированно оказались больше неё.
   */
  receive(remote: Hlc): void {
    const parsed = parseHlc(remote);
    if (!parsed) return;
    const time = Math.max(this.now(), this.lastTime, parsed.time);
    if (time === this.lastTime && time === parsed.time) {
      this.counter = Math.max(this.counter, parsed.counter) + 1;
    } else if (time === this.lastTime) {
      this.counter++;
    } else if (time === parsed.time) {
      this.counter = parsed.counter + 1;
    } else {
      this.counter = 0;
    }
    this.lastTime = time;
  }
}

export function formatHlc(time: number, counter: number, replicaId: string): Hlc {
  return `${String(time).padStart(13, '0')}:${counter.toString(36).padStart(5, '0')}:${replicaId}`;
}

export function parseHlc(hlc: Hlc): { time: number; counter: number; replicaId: string } | null {
  const [time, counter, ...rest] = hlc.split(':');
  const replicaId = rest.join(':');
  if (!time || !counter || !replicaId) return null;
  const t = Number(time);
  const c = parseInt(counter, 36);
  if (!Number.isFinite(t) || !Number.isFinite(c)) return null;
  return { time: t, counter: c, replicaId };
}
