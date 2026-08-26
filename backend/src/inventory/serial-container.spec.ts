import { BadRequestException } from '@nestjs/common';
import { fitsContainer, normaliseSerial, normaliseSerials, repeatedSerials, serialRoom } from './serial-container';

describe('normaliseSerial', () => {
  it('trims surrounding whitespace from a scanned or pasted value', () => {
    expect(normaliseSerial('  SN-001  ')).toBe('SN-001');
  });

  it('rejects a value that is empty once trimmed', () => {
    expect(() => normaliseSerial('   ')).toThrow(BadRequestException);
  });

  it('rejects a value longer than the label allows', () => {
    expect(() => normaliseSerial('X'.repeat(19))).toThrow(BadRequestException);
    expect(normaliseSerial('X'.repeat(18))).toHaveLength(18);
  });
});

describe('normaliseSerials', () => {
  it('trims a whole batch', () => {
    expect(normaliseSerials([' A ', 'B  ', '  C'])).toEqual(['A', 'B', 'C']);
  });

  it('refuses a batch containing a blank entry rather than inventing a serial for it', () => {
    expect(() => normaliseSerials(['A', '   ', 'B'])).toThrow(BadRequestException);
  });

  it('names every over-long serial in one error, not just the first', () => {
    const long1 = 'X'.repeat(20);
    const long2 = 'Y'.repeat(25);
    expect(() => normaliseSerials(['OK', long1, long2])).toThrow(
      expect.objectContaining({ message: expect.stringContaining(long2) }),
    );
    expect(() => normaliseSerials(['OK', long1, long2])).toThrow(
      expect.objectContaining({ message: expect.stringContaining(long1) }),
    );
  });

  it('accepts a clean batch untouched', () => {
    expect(normaliseSerials(['SN1', 'SN2'])).toEqual(['SN1', 'SN2']);
  });
});

describe('repeatedSerials', () => {
  it('finds nothing in a clean batch', () => {
    expect(repeatedSerials(['A', 'B', 'C'])).toEqual([]);
  });

  it('reports each repeat once, however many times it appears', () => {
    expect(repeatedSerials(['A', 'B', 'A', 'A', 'C', 'B'])).toEqual(['A', 'B']);
  });
});

describe('serialRoom', () => {
  it('is the gap between stock on hand and serials recorded', () => {
    expect(serialRoom(10, 4)).toBe(6);
  });

  it('is zero for a container that is already complete', () => {
    expect(serialRoom(10, 10)).toBe(0);
  });

  it('clamps at zero for data that predates the rule and is overfilled', () => {
    expect(serialRoom(3, 8)).toBe(0);
  });
});

describe('fitsContainer', () => {
  it('accepts a batch that exactly completes the container', () => {
    expect(fitsContainer(10, 7, 3)).toBe(true);
  });

  it('refuses a batch that would exceed stock on hand', () => {
    expect(fitsContainer(10, 7, 4)).toBe(false);
  });

  it('refuses anything at all once the container is full', () => {
    expect(fitsContainer(5, 5, 1)).toBe(false);
  });

  it('refuses anything at all when the container is already overfilled', () => {
    expect(fitsContainer(5, 9, 1)).toBe(false);
  });

  it('accepts an empty batch, which changes nothing either way', () => {
    expect(fitsContainer(5, 5, 0)).toBe(true);
  });
});
