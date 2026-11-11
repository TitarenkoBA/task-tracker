import { HybridLogicalClock, formatHlc, parseHlc } from './hlc';

describe('HybridLogicalClock', () => {
  it('выдаёт строго возрастающие метки при одинаковом времени', () => {
    const clock = new HybridLogicalClock('a', () => 1000);
    const first = clock.tick();
    const second = clock.tick();
    const third = clock.tick();
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });

  it('остаётся монотонным, если системное время откатилось назад', () => {
    let now = 5000;
    const clock = new HybridLogicalClock('a', () => now);
    const before = clock.tick();
    now = 1000;
    expect(clock.tick() > before).toBe(true);
  });

  it('после receive() локальные метки больше полученной', () => {
    const clock = new HybridLogicalClock('a', () => 1000);
    const remote = formatHlc(9_000_000, 7, 'b');
    clock.receive(remote);
    expect(clock.tick() > remote).toBe(true);
  });

  it('игнорирует некорректные метки', () => {
    const clock = new HybridLogicalClock('a', () => 1000);
    expect(() => clock.receive('мусор')).not.toThrow();
    expect(parseHlc(clock.tick())?.time).toBe(1000);
  });

  it('format и parse взаимно обратны', () => {
    const hlc = formatHlc(1_700_000_000_000, 42, 'replica');
    expect(parseHlc(hlc)).toEqual({ time: 1_700_000_000_000, counter: 42, replicaId: 'replica' });
  });

  it('метки сравниваются как строки в хронологическом порядке', () => {
    expect(formatHlc(999, 0, 'z') < formatHlc(1000, 0, 'a')).toBe(true);
    expect(formatHlc(1000, 9, 'z') < formatHlc(1000, 10, 'a')).toBe(true);
  });
});
