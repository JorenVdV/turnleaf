import { describe, expect, it } from 'vitest';
import {
  kavitaXPathToCfi,
  lastPageOffset,
  pageTurnOffset,
  parseKavitaXPath,
  resolveContentXPath,
  SnappedPageViewManager,
  toKavitaXPath,
} from './session';

describe('Kavita EPUB locations', () => {
  it('adds the one-based Kavita spine fragment to an EPUB content path', () => {
    expect(toKavitaXPath('/html/body/section[1]/p[4]', 2)).toBe(
      '//body/DocFragment[3]/body/section[1]/p[4]',
    );
  });

  it('removes indexed HTML and body roots produced by EPUB documents', () => {
    expect(toKavitaXPath('/html[1]/body[1]/div[2]/p[3]', 0)).toBe(
      '//body/DocFragment[1]/body/div[2]/p[3]',
    );
  });

  it('maps a Kavita location back to a zero-based EPUB spine and content path', () => {
    expect(parseKavitaXPath('//body/DocFragment[3]/body/section[1]/p[4]')).toEqual({
      spineIndex: 2,
      contentXPath: '/html/body/section[1]/p[4]',
    });
  });

  it('accepts Kavita chapter-body locations with a trailing slash', () => {
    expect(parseKavitaXPath('//body/DocFragment[2]/body/')).toEqual({
      spineIndex: 1,
      contentXPath: '/html/body',
    });
  });

  it('rejects unscoped and invalid locations instead of opening the wrong chapter', () => {
    expect(parseKavitaXPath('/html/body/p[1]')).toBeNull();
    expect(parseKavitaXPath('//body/DocFragment[0]/body/p[1]')).toBeNull();
  });

  it('resolves Kavita paths through XHTML-style element names', () => {
    const document = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><section><p>one</p><p>two</p></section></body></html>',
      'application/xhtml+xml',
    );
    expect(resolveContentXPath(document, '/html/body/section[1]/p[2]')?.textContent).toBe('two');
    expect(resolveContentXPath(document, '/html/body')?.localName).toBe('body');
  });

  it('converts a Kavita element path directly to an EPUB CFI', () => {
    expect(kavitaXPathToCfi('//body/DocFragment[9]/body/section[1]/p[165]/span[1]', '/6/18')).toBe(
      'epubcfi(/6/18!/4/2/330/2,/1:0,/1:1)',
    );
  });
});

describe('paginated page turns', () => {
  // Measured on a Bigme B6 (devicePixelRatio 1.875): scrollLeft drifts past whole pages.
  it('reaches the last page when scrollLeft is rounded past the page boundary', () => {
    expect(pageTurnOffset(3433.6, 4576, 572, 1)).toBe(4004);
  });

  it('leaves the section only from the last page', () => {
    expect(pageTurnOffset(4004.2, 4576, 572, 1)).toBeNull();
  });

  it('snaps backwards to whole pages and stops at the first page', () => {
    expect(pageTurnOffset(1144.4, 4576, 572, -1)).toBe(572);
    expect(pageTurnOffset(0.27, 4576, 572, -1)).toBeNull();
  });

  it('treats a single-page section as both first and last page', () => {
    expect(pageTurnOffset(0, 572, 572, 1)).toBeNull();
    expect(pageTurnOffset(0, 572, 572, -1)).toBeNull();
  });

  it('finds the last whole page of a section', () => {
    expect(lastPageOffset(6292, 572)).toBe(5720);
    expect(lastPageOffset(6292.4, 572)).toBe(5720);
    expect(lastPageOffset(572, 572)).toBe(0);
    expect(lastPageOffset(0, 572)).toBe(0);
  });
});

describe('paging back into the previous section', () => {
  const pageWidth = 572;

  // Scrolls like a WebView with devicePixelRatio 1.875: clientWidth is fractional and
  // scrollLeft is clamped as soon as the content shrinks.
  class FakeContainer {
    scrollTop = 0;
    private left = 0;
    private width: number;

    constructor(width: number) {
      this.width = width;
    }

    get scrollWidth() {
      return this.width;
    }

    get scrollLeft() {
      return this.left;
    }

    set scrollLeft(value: number) {
      this.left = Math.max(0, Math.min(value, this.width - 571.47));
    }

    resize(width: number) {
      this.width = width;
      this.scrollLeft = this.left;
    }
  }

  // The previous section first measures as `firstWidth` while epub.js prepends it.
  function readerAtSectionStart(firstWidth: number) {
    const container = new FakeContainer(9 * pageWidth);
    const manager = new SnappedPageViewManager({ settings: { axis: 'horizontal' } });
    // epub.js re-measures the view and calls counter() on every resize of a prepended section.
    const reflow = (width: number) => {
      const widthDelta = width - container.scrollWidth;
      container.resize(width);
      manager.counter({ widthDelta, heightDelta: 0 });
    };
    Object.assign(manager, {
      isPaginated: true,
      container,
      layout: { name: 'reflowable', delta: pageWidth, divisor: 1 },
      views: {
        length: 1,
        first: () => ({ section: { prev: () => ({ prev: () => undefined }) } }),
        show: () => undefined,
      },
      clear: () => {
        container.scrollLeft = 0;
        container.resize(0);
      },
      updateLayout: () => undefined,
      prepend: () => {
        reflow(firstWidth);
        return Promise.resolve();
      },
    });
    return { container, manager, reflow };
  }

  // Measured on a Bigme B6: the section grows from 5 to 11 pages, then a late font shrinks it to 9.
  it('stays on the last page while the previous section reflows', async () => {
    const { container, manager, reflow } = readerAtSectionStart(5 * pageWidth);
    await manager.prev();
    expect(container.scrollLeft).toBe(4 * pageWidth);
    reflow(11 * pageWidth);
    expect(container.scrollLeft).toBe(10 * pageWidth);
    reflow(9 * pageWidth);
    expect(container.scrollLeft).toBe(8 * pageWidth);
  });

  it('stops following reflows once the reader turns a page', async () => {
    const { container, manager, reflow } = readerAtSectionStart(9 * pageWidth);
    await manager.prev();
    await manager.prev();
    expect(container.scrollLeft).toBe(7 * pageWidth);
    reflow(11 * pageWidth);
    expect(container.scrollLeft).toBe(9 * pageWidth);
  });
});
